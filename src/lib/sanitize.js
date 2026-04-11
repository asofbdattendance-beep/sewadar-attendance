// ─── sanitize.js ──────────────────────────────────────────────────────────────
// Input sanitization utilities to prevent XSS and injection attacks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape HTML special characters to prevent XSS attacks
 * @param {string} str - Input string to sanitize
 * @returns {string} Sanitized string safe for HTML rendering
 */
export function sanitizeHTML(str) {
  if (!str || typeof str !== 'string') return ''
  const htmlEntities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#96;',
    '=': '&#x3D;',
  }
  return str.replace(/[&<>"'`/=]/g, char => htmlEntities[char] || char)
}

/**
 * Sanitize input for database insertion - prevents SQL injection
 * Note: Use parameterized queries instead - this is a fallback layer
 * @param {string} str - Input string to sanitize
 * @returns {string} Sanitized string
 */
export function sanitizeSQL(str) {
  if (!str || typeof str !== 'string') return ''
  // Remove or escape potentially dangerous characters
  return str.replace(/['";\\]/g, '')
}

/**
 * Sanitize badge number - only allow alphanumeric and specific pattern
 * @param {string} badge - Badge number to sanitize
 * @returns {string|null} Sanitized badge or null if invalid
 */
export function sanitizeBadgeNumber(badge) {
  if (!badge || typeof badge !== 'string') return null
  // Only allow alphanumeric, max 20 chars
  const sanitized = badge.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return sanitized.length >= 5 && sanitized.length <= 20 ? sanitized : null
}

/**
 * Sanitize name input - allows letters, spaces, hyphens, apostrophes
 * @param {string} name - Name to sanitize
 * @returns {string} Sanitized name
 */
export function sanitizeName(name) {
  if (!name || typeof name !== 'string') return ''
  return name.trim().replace(/[^a-zA-Z\s\-'.]/g, '')
}

/**
 * Sanitize search query - allows alphanumeric, spaces, common punctuation
 * @param {string} query - Search query to sanitize
 * @returns {string} Sanitized query
 */
export function sanitizeSearch(query) {
  if (!query || typeof query !== 'string') return ''
  return query.trim().replace(/[<>'"\\]/g, '').slice(0, 200)
}

/**
 * Sanitize remarks/notes - allows more characters but still safe
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
export function sanitizeRemarks(text) {
  if (!text || typeof text !== 'string') return ''
  // Allow more characters but strip script tags
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .slice(0, 1000)
}

/**
 * Sanitize centre/department names
 * @param {string} str - Input string
 * @returns {string} Sanitized string
 */
export function sanitizeCentreName(str) {
  if (!str || typeof str !== 'string') return ''
  return str.trim().replace(/[^a-zA-Z0-9\s\-_.]/g, '').slice(0, 100)
}

/**
 * Validate and sanitize date string
 * @param {string} dateStr - Date string
 * @returns {string|null} Valid date string or null
 */
export function sanitizeDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return null
  return date.toISOString().split('T')[0]
}

/**
 * Create a safe object by sanitizing all string values
 * @param {Object} obj - Object to sanitize
 * @param {Object} fields - Map of field names to sanitization functions
 * @returns {Object} Sanitized object
 */
export function sanitizeObject(obj, fields = {}) {
  if (!obj || typeof obj !== 'object') return {}
  
  const sanitized = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      sanitized[key] = value
    } else if (typeof value === 'string') {
      sanitized[key] = fields[key] ? fields[key](value) : sanitizeHTML(value)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value
    } else if (Array.isArray(value)) {
      sanitized[key] = value
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

/**
 * Field-specific sanitization mapping for common operations
 */
export const FIELD_SANITIZERS = {
  badge_number: sanitizeBadgeNumber,
  sewadar_name: sanitizeName,
  remarks: sanitizeRemarks,
  notes: sanitizeRemarks,
  description: sanitizeRemarks,
  reason: sanitizeRemarks,
  centre: sanitizeCentreName,
  department: sanitizeCentreName,
  search: sanitizeSearch,
  date_from: sanitizeDate,
  date_to: sanitizeDate,
}