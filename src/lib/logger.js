import { supabase } from './supabase'

const ALLOWED_ACTIONS = new Set(['RECORD_DELETE', 'ADMIN_DELETE', 'MANUAL_IN', 'MANUAL_OUT'])

export function logAction(userBadge, userName, action, details = {}) {
  if (!ALLOWED_ACTIONS.has(action)) return
  try {
    const payload = {
      user_badge: userBadge || 'unknown',
      user_name: userName || 'Unknown',
      action,
      details: typeof details === 'object' ? JSON.stringify(details) : String(details),
      timestamp: new Date().toISOString()
    }
    supabase.from('logs').insert(payload).then().catch(err => console.error('Log error:', err))
  } catch (err) {
    console.error('Log error:', err)
  }
}
