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

// FIX #3: Batch insert — one DB call for all queued records
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

  // Batch failed — fall back to sequential for partial success
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

// ── Sewadar cache ──
const CACHE_KEY = 'sewadars_cache'
const CACHE_TIME_KEY = 'sewadars_cache_time'
const CACHE_TTL = 1000 * 60 * 60 // FIX #2: 60 min (was 30)

export function getCachedSewadars() {
  try {
    const cacheTime = localStorage.getItem(CACHE_TIME_KEY)
    if (!cacheTime) return null
    if (Date.now() - parseInt(cacheTime) > CACHE_TTL) return null
    return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
  } catch { return null }
}

// FIX #5: Expose cache age in minutes for UI display
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

// FIX #9: Slim select — only columns needed for scanning
export async function populateOfflineCache(supabase) {
  try {
    const { data } = await supabase
      .from('sewadars')
      .select('badge_number,sewadar_name,centre,department,badge_status,gender,geo_required,father_husband_name,age')
    if (data && data.length > 0) setCachedSewadars(data)
  } catch (e) { console.warn('Failed to populate offline cache:', e) }
}

// ── Attendance cache ──
const ATTENDANCE_KEY = 'attendance_cache'

export function getAttendanceCache() {
  try { return JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || '[]') }
  catch { return [] }
}

export function setAttendanceCache(records) {
  try { localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(records.slice(0, 500))) }
  catch {}
}

// FIX #1 #6: Today-only, limit 500 — prevents IN/OUT logic errors from cache overflow
export async function populateAttendanceCache(supabase) {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const { data } = await supabase
      .from('attendance')
      .select('id,badge_number,type,scan_time,centre,sewadar_name,scanner_name')
      .gte('scan_time', today.toISOString())
      .order('scan_time', { ascending: false })
      .limit(500)
    if (data && data.length > 0) setAttendanceCache(data)
  } catch (e) { console.warn('Failed to populate attendance cache:', e) }
}

// FIX #1: Prune by date not just count — old-day records never pollute today's logic
export function addToAttendanceCache(record) {
  try {
    const cache = getAttendanceCache()
    cache.unshift(record)
    const todayStr = new Date().toISOString().split('T')[0]
    const todayOnly = cache.filter(r => r.scan_time && r.scan_time.startsWith(todayStr))
    if (todayOnly.length > 500) todayOnly.splice(500)
    setAttendanceCache(todayOnly)
  } catch (e) { console.warn('Failed to update attendance cache:', e) }
}

export function getLastAttendance(badge) {
  const cache = getAttendanceCache()
  const filtered = cache.filter(r => r.badge_number === badge)
  if (filtered.length === 0) return null
  return filtered.sort((a, b) => new Date(b.scan_time) - new Date(a.scan_time))[0]
}