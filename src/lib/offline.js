const QUEUE_KEY = 'attendance_offline_queue'

export function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') }
  catch { return [] }
}

export function addToOfflineQueue(record) {
  const queue = getOfflineQueue()
  queue.push({ ...record, offline: true, queued_at: new Date().toISOString() })
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export function clearOfflineQueue() { localStorage.removeItem(QUEUE_KEY) }

export function getOfflineQueueCount() { return getOfflineQueue().length }

// Batch insert — one DB call for all queued records
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

  // Batch failed — sequential fallback
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

// ── Sewadar cache — ONLY cache kept. Used for badge lookup during scanning. ──
const CACHE_KEY = 'sewadars_cache'
const CACHE_TIME_KEY = 'sewadars_cache_time'
const CACHE_TTL = 1000 * 60 * 60 // 60 min

export function getCachedSewadars() {
  try {
    const cacheTime = localStorage.getItem(CACHE_TIME_KEY)
    if (!cacheTime) return null
    if (Date.now() - parseInt(cacheTime) > CACHE_TTL) return null
    return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
  } catch { return null }
}

export function getCacheAge() {
  try {
    const t = localStorage.getItem(CACHE_TIME_KEY)
    if (!t) return null
    return Math.floor((Date.now() - parseInt(t)) / 60000)
  } catch { return null }
}

export function setCachedSewadars(sewadars) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(sewadars))
    localStorage.setItem(CACHE_TIME_KEY, Date.now().toString())
  } catch {}
}

export function lookupBadgeOffline(badge) {
  const cache = getCachedSewadars()
  if (!cache) return null
  return cache.find(s => s.badge_number.toUpperCase() === badge.toUpperCase()) || null
}

// Slim select — only columns needed for scanning
export async function populateOfflineCache(supabase) {
  try {
    const { data } = await supabase
      .from('sewadars')
      .select('badge_number,sewadar_name,centre,department,badge_status,gender,geo_required,father_husband_name,age')
    if (data && data.length > 0) setCachedSewadars(data)
  } catch (e) { console.warn('Failed to populate sewadar cache:', e) }
}