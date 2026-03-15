// offline.js — Offline queue only. No attendance cache. No sewadar cache.
// Cache was removed: all live operations hit the DB directly.
// Offline queue: stores scans when internet is down, syncs when back online.
// Max 500 records — warns user if full to prevent localStorage overflow.

const QUEUE_KEY = 'attendance_offline_queue'
const QUEUE_MAX = 500

export function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') }
  catch { return [] }
}

export function addToOfflineQueue(record) {
  const queue = getOfflineQueue()
  if (queue.length >= QUEUE_MAX) {
    console.warn(`Offline queue full (${QUEUE_MAX} records). Dropping oldest record.`)
    queue.shift() // drop oldest to make room
  }
  queue.push({ ...record, offline: true, queued_at: new Date().toISOString() })
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export function clearOfflineQueue() { localStorage.removeItem(QUEUE_KEY) }

export function getOfflineQueueCount() { return getOfflineQueue().length }

export function isOfflineQueueFull() { return getOfflineQueue().length >= QUEUE_MAX }

// Batch insert — one DB call, sequential fallback
export async function syncOfflineQueue(supabase) {
  const queue = getOfflineQueue()
  if (queue.length === 0) return { synced: 0, failed: 0 }

  const records = queue.map(({ offline, queued_at, ...data }) => data)
  try {
    const { error } = await supabase.from('attendance').insert(records)
    if (!error) {
      localStorage.setItem(QUEUE_KEY, JSON.stringify([]))
      return { synced: records.length, failed: 0 }
    }
  } catch {}

  // Batch failed — try one by one
  let synced = 0, failed = 0
  const remaining = []
  for (const record of queue) {
    try {
      const { offline, queued_at, ...data } = record
      const { error } = await supabase.from('attendance').insert(data)
      if (error) { remaining.push(record); failed++ }
      else synced++
    } catch { remaining.push(record); failed++ }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining))
  return { synced, failed }
}

// Offline sewadar lookup — only used when isOnline=false
// No TTL, no auto-refresh. User explicitly refreshes via Profile → Sewadar Cache.
const SW_KEY = 'sewadars_cache'
const SW_TIME_KEY = 'sewadars_cache_time'

export function getCachedSewadars() {
  try { return JSON.parse(localStorage.getItem(SW_KEY) || 'null') }
  catch { return null }
}

export function getCacheAge() {
  try {
    const t = localStorage.getItem(SW_TIME_KEY)
    if (!t) return null
    return Math.floor((Date.now() - parseInt(t)) / 60000)
  } catch { return null }
}

export function setCachedSewadars(sewadars) {
  try {
    localStorage.setItem(SW_KEY, JSON.stringify(sewadars))
    localStorage.setItem(SW_TIME_KEY, Date.now().toString())
  } catch {}
}

export function lookupBadgeOffline(badge) {
  const cache = getCachedSewadars()
  if (!cache) return null
  return cache.find(s => s.badge_number.toUpperCase() === badge.toUpperCase()) || null
}

export async function populateOfflineCache(supabase) {
  try {
    const { data } = await supabase.from('sewadars')
      .select('badge_number,sewadar_name,centre,department,badge_status,gender,geo_required')
    if (data?.length > 0) setCachedSewadars(data)
  } catch (e) { console.warn('Sewadar cache populate failed:', e) }
}