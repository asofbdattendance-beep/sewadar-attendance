const QUEUE_KEY = 'attendance_offline_queue'
const MAX_QUEUE_SIZE = 1000

export function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') }
  catch { return [] }
}

export function addToOfflineQueue(record) {
  const queue = getOfflineQueue()
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift()
  }
  queue.push({ ...record, offline: true, queued_at: new Date().toISOString() })
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export function clearOfflineQueue() { localStorage.removeItem(QUEUE_KEY) }

export function getOfflineQueueCount() { return getOfflineQueue().length }

export async function syncOfflineQueue(supabase) {
  const queue = getOfflineQueue()
  if (queue.length === 0) return { synced: 0, failed: 0 }

  let synced = 0, failed = 0
  const remaining = []

  for (const record of queue) {
    try {
      const { offline, queued_at, ...data } = record
      const { error } = await supabase.from('attendance').insert(data)
      if (error) {
        remaining.push(record)
        failed++
      } else {
        synced++
      }
    } catch {
      remaining.push(record)
      failed++
    }
  }

  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining))
  return { synced, failed }
}

// ── Helpers ──
function getLocalTodayBoundary() {
  // Use UTC date for consistency with DB timestamps
  const d = new Date()
  return d.toISOString().split('T')[0] + 'T00:00:00Z'
}

export function checkDuplicateInOfflineQueue(badgeNumber, type) {
  const queue = getOfflineQueue()
  const todayBoundary = getLocalTodayBoundary()
  return queue.some(r =>
    r.badge_number === badgeNumber &&
    r.type === type &&
    r.scan_time >= todayBoundary
  )
}

// Check if a record already exists in DB (dedup before sync)
export async function checkDuplicateOffline(supabase, record) {
  if (!record.badge_number || !record.type) return false
  
  // Check local offline queue first (most likely source of duplicates when offline)
  if (checkDuplicateInOfflineQueue(record.badge_number, record.type)) {
    return true
  }
  
  // Then check database if online
  const { data } = await supabase
    .from('attendance')
    .select('id')
    .eq('badge_number', record.badge_number)
    .eq('type', record.type)
    .gte('scan_time', getLocalTodayBoundary())
    .limit(1)
    .maybeSingle()
  return !!data
}

// Check duplicate from local cache (offline-first duplicate prevention)
export function checkDuplicateInCache(badgeNumber, type) {
  const cache = getAttendanceCache()
  const todayBoundary = getLocalTodayBoundary()
  return cache.some(r =>
    r.badge_number === badgeNumber &&
    r.type === type &&
    r.scan_time >= todayBoundary
  )
}

// ── Sewadar cache ──
const CACHE_KEY = 'sewadars_cache'
const CACHE_TIME_KEY = 'sewadars_cache_time'
const CACHE_TTL = 1000 * 60 * 60

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
  } catch (e) { console.warn('Failed to cache sewadars:', e) }
}

export function lookupBadgeOffline(badge) {
  const cache = getCachedSewadars()
  if (!cache) return null
  return cache.find(s => (s.badge_number || '').toUpperCase() === badge.toUpperCase()) || null
}

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
const ATTENDANCE_CACHE_SIZE = 500

export function getAttendanceCache() {
  try { return JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || '[]') }
  catch { return [] }
}

export function setAttendanceCache(records) {
  try {
    // Keep newest 500 (records come in newest-first from DB)
    const trimmed = records.slice(-ATTENDANCE_CACHE_SIZE)
    localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(trimmed))
  } catch (e) { console.warn('Failed to save attendance cache:', e) }
}

export async function populateAttendanceCache(supabase) {
  try {
    // Use UTC start of today for consistency with DB timestamps
    const today = new Date()
    const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0))
    const { data } = await supabase
      .from('attendance')
      .select('id,badge_number,type,scan_time,centre,sewadar_name,department,scanner_name,manual_entry,submitted_by,scanner_badge')
      .gte('scan_time', todayUTC.toISOString())
      .order('scan_time', { ascending: false })
      .limit(ATTENDANCE_CACHE_SIZE)
    if (data && data.length > 0) setAttendanceCache(data)
  } catch (e) { console.warn('Failed to populate attendance cache:', e) }
}

export function addToAttendanceCache(record) {
  try {
    const cache = [...getAttendanceCache()]
    cache.unshift(record)
    // Keep only today's records + cap at 500
    const todayBoundary = getLocalTodayBoundary()
    const filtered = cache
      .filter(r => r.scan_time >= todayBoundary)
      .slice(0, ATTENDANCE_CACHE_SIZE)
    localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(filtered))
  } catch (e) { console.warn('Failed to update attendance cache:', e) }
}

export function getLastAttendance(badge) {
  const cache = [...getAttendanceCache()]
  const filtered = cache.filter(r => r.badge_number === badge)
  if (filtered.length === 0) return null
  return filtered.sort((a, b) => new Date(b.scan_time) - new Date(a.scan_time))[0]
}

export function getTodayEntriesForBadge(badgeNumber) {
  const cache = [...getAttendanceCache()]
  const todayBoundary = getLocalTodayBoundary()
  return cache
    .filter(r => r.badge_number === badgeNumber && r.scan_time >= todayBoundary)
    .sort((a, b) => new Date(a.scan_time) - new Date(b.scan_time))
}
