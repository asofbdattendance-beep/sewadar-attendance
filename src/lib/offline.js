// Sewadar cache for offline lookups (performance optimization)
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
  } catch {}
}

export function lookupBadgeOffline(badge) {
  const cache = getCachedSewadars()
  if (!cache) return null
  const searchBadge = badge.toUpperCase()
  return cache.find(s => s.badge_number.toUpperCase() === searchBadge) || null
}

export async function populateOfflineCache(supabase) {
  try {
    const { data } = await supabase
      .from('sewadars')
      .select('badge_number,sewadar_name,centre,department,badge_status,gender')
    if (data && data.length > 0) setCachedSewadars(data)
  } catch (e) { console.warn('Failed to populate cache:', e) }
}

export function clearSewadarCache() {
  localStorage.removeItem(CACHE_KEY)
  localStorage.removeItem(CACHE_TIME_KEY)
}
