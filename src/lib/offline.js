const QUEUE_KEY = 'attendance_offline_queue'

export function getOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  } catch { return [] }
}

export function addToOfflineQueue(record) {
  const queue = getOfflineQueue()
  queue.push({ ...record, offline: true, queued_at: new Date().toISOString() })
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export function clearOfflineQueue() {
  localStorage.removeItem(QUEUE_KEY)
}

export function getOfflineQueueCount() {
  return getOfflineQueue().length
}

export async function syncOfflineQueue(supabase) {
  const queue = getOfflineQueue()
  if (queue.length === 0) return { synced: 0, failed: 0 }

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

// Local sewadar cache for offline lookups
const CACHE_KEY = 'sewadars_cache'
const CACHE_TIME_KEY = 'sewadars_cache_time'
const CACHE_TTL = 1000 * 60 * 30 // 30 minutes

export function getCachedSewadars() {
  try {
    const cacheTime = localStorage.getItem(CACHE_TIME_KEY)
    if (!cacheTime) return null
    if (Date.now() - parseInt(cacheTime) > CACHE_TTL) return null
    return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
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
  const found = cache.find(s => s.badge_number === badge)
  if (found) return found
  return cache.find(s => s.badge_number.toUpperCase() === badge.toUpperCase()) || null
}

export async function populateOfflineCache(supabase) {
  try {
    const { data } = await supabase.from('sewadars').select('*')
    if (data && data.length > 0) {
      setCachedSewadars(data)
    }
  } catch (e) {
    console.warn('Failed to populate offline cache:', e)
  }
}

// Attendance cache for offline lookups
const ATTENDANCE_KEY = 'attendance_cache'

export function getAttendanceCache() {
  try {
    return JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || '[]')
  } catch { return [] }
}

export function setAttendanceCache(records) {
  try {
    localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(records.slice(0, 100)))
  } catch {}
}

export function getLastAttendance(badge) {
  const cache = getAttendanceCache()
  const filtered = cache.filter(r => r.badge_number === badge)
  if (filtered.length === 0) return null
  return filtered.sort((a, b) => new Date(b.scan_time) - new Date(a.scan_time))[0]
}

export async function populateAttendanceCache(supabase) {
  try {
    const { data } = await supabase
      .from('attendance')
      .select('*')
      .order('scan_time', { ascending: false })
      .limit(100)
    if (data && data.length > 0) {
      setAttendanceCache(data)
    }
  } catch (e) {
    console.warn('Failed to populate attendance cache:', e)
  }
}

// Add new attendance to cache immediately (for recent scan feature)
export function addToAttendanceCache(record) {
  try {
    const cache = getAttendanceCache()
    cache.unshift(record)
    // Keep only last 100 records
    if (cache.length > 100) {
      cache.splice(100)
    }
    setAttendanceCache(cache)
  } catch (e) {
    console.warn('Failed to update attendance cache:', e)
  }
}
