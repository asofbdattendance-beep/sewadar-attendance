const QUEUE_KEY = 'attendance_offline_queue'
const MAX_QUEUE_SIZE = 1000

// ── IST date helpers ──
// Using Intl.DateTimeFormat for robust timezone handling (handles DST, etc.)
export function todayDateStr() {
  return new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'Asia/Kolkata', 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit' 
  }).format(new Date())
}

// Returns current IST datetime as ISO string
export function nowIST() {
  return new Intl.DateTimeFormat('sv-SE', { 
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date()).replace(' ', 'T')
}

export function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') }
  catch { return [] }
}

export function addToOfflineQueue(record) {
  const queue = getOfflineQueue()
  
  if (queue.length >= MAX_QUEUE_SIZE) {
    let removeIdx = queue.findIndex(r => !r.sync_error)
    if (removeIdx === -1) removeIdx = 0
    queue.splice(removeIdx, 1)
  }
  
  queue.push({ ...record, offline: true, queued_at: new Date().toISOString(), sync_error: null })
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export function clearOfflineQueue() { localStorage.removeItem(QUEUE_KEY) }

export function getOfflineQueueCount() { return getOfflineQueue().length }

export function getOfflineQueueFailedCount() {
  const queue = getOfflineQueue()
  return queue.filter(r => r.sync_error).length
}

export function clearSyncedFromQueue() {
  const queue = getOfflineQueue()
  const remaining = queue.filter(r => r.sync_error)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining))
}

export async function syncOfflineQueue(supabase) {
  const queue = getOfflineQueue()
  if (queue.length === 0) return { synced: 0, failed: 0 }

  let synced = 0, failed = 0
  const remaining = []

  // Try batch insert first for efficiency
  const recordsToInsert = queue.map(r => {
    const { offline, queued_at, sync_error, ...data } = r
    return data
  })

  try {
    const { error: batchError } = await supabase.from('attendance').insert(recordsToInsert)
    
    if (batchError) {
      // Batch failed, try individual inserts with better error handling
      console.warn('Batch insert failed, falling back to individual:', batchError.message)
      
      for (const record of queue) {
        try {
          const { offline, queued_at, sync_error, ...data } = record
          const { error } = await supabase.from('attendance').insert(data)
          
          if (error) {
            console.error('Insert failed:', error.message, 'Record:', data.badge_number)
            remaining.push({ ...record, sync_error: error.message })
            failed++
          } else {
            synced++
          }
        } catch (e) {
          console.error('Insert exception:', e.message)
          remaining.push({ ...record, sync_error: e.message })
          failed++
        }
      }
    } else {
      // Batch success
      synced = recordsToInsert.length
    }
  } catch (e) {
    console.error('Batch insert exception:', e.message)
    
    for (const record of queue) {
      try {
        const { offline, queued_at, sync_error, ...data } = record
        const { error } = await supabase.from('attendance').insert(data)
        
        if (error) {
          console.error('Insert failed:', error.message, 'Record:', data.badge_number)
          remaining.push({ ...record, sync_error: error.message })
          failed++
        } else {
          synced++
        }
      } catch (err) {
        console.error('Insert exception:', err.message)
        remaining.push({ ...record, sync_error: err.message })
        failed++
      }
    }
  }

  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining))
  return { synced, failed }
}

// ── Helpers ──
function getTodayBoundaryISO() {
  return todayDateStr() + 'T00:00:00+05:30'
}

function isToday(scanTime) {
  const scanDate = new Date(scanTime)
  const todayStart = new Date(getTodayBoundaryISO())
  return scanDate >= todayStart
}

export function checkDuplicateInOfflineQueue(badgeNumber, type) {
  const queue = getOfflineQueue()
  return queue.some(r =>
    r.badge_number === badgeNumber &&
    r.type === type &&
    isToday(r.scan_time)
  )
}

// Check if a record already exists in DB (dedup before sync)
export async function checkDuplicateOffline(supabase, record) {
  if (!record.badge_number || !record.type) return false
  
  if (checkDuplicateInOfflineQueue(record.badge_number, record.type)) {
    return true
  }
  
  if (checkDuplicateInCache(record.badge_number, record.type)) {
    return true
  }
  
  const { data } = await supabase
    .from('attendance')
    .select('id')
    .eq('badge_number', record.badge_number)
    .eq('type', record.type)
    .gte('scan_time', getTodayBoundaryISO())
    .limit(1)
    .maybeSingle()
  return !!data
}

// Check duplicate from local cache (offline-first duplicate prevention)
export function checkDuplicateInCache(badgeNumber, type) {
  const cache = getAttendanceCache()
  return cache.some(r =>
    r.badge_number === badgeNumber &&
    r.type === type &&
    isToday(r.scan_time)
  )
}

// ── Sewadar cache ──
const CACHE_KEY = 'sewadars_cache'
const CACHE_TIME_KEY = 'sewadars_cache_time'
const CACHE_TTL = 1000 * 60 * 60 * 24 // 24 hours

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
    const trimmed = records.slice(0, ATTENDANCE_CACHE_SIZE)
    localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(trimmed))
  } catch (e) { console.warn('Failed to save attendance cache:', e) }
}

export async function populateAttendanceCache(supabase) {
  try {
    const todayStart = getTodayBoundaryISO()
    const { data } = await supabase
      .from('attendance')
      .select('id,badge_number,type,scan_time,centre,sewadar_name,department,scanner_name,manual_entry,submitted_by,scanner_badge')
      .gte('scan_time', todayStart)
      .order('scan_time', { ascending: false })
      .limit(ATTENDANCE_CACHE_SIZE)
    if (data && data.length > 0) setAttendanceCache(data)
  } catch (e) { console.warn('Failed to populate attendance cache:', e) }
}

export function addToAttendanceCache(record) {
  try {
    const cache = [...getAttendanceCache()]
    const newCache = [record, ...cache].filter(r => isToday(r.scan_time)).slice(0, ATTENDANCE_CACHE_SIZE)
    localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(newCache))
  } catch (e) { console.warn('Failed to update attendance cache:', e) }
}

export function getLastAttendance(badge) {
  const cache = getAttendanceCache()
  for (const r of cache) {
    if (r.badge_number === badge && isToday(r.scan_time)) {
      return r
    }
  }
  return null
}

export function getTodayEntriesForBadge(badgeNumber) {
  const cache = getAttendanceCache()
  const result = []
  for (const r of cache) {
    if (r.badge_number === badgeNumber && isToday(r.scan_time)) {
      result.push(r)
    }
  }
  return result
}