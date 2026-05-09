import { supabase } from './supabase'

export async function logAction(userBadge, userName, action, details = {}) {
  try {
    const payload = {
      user_badge: userBadge || 'unknown',
      user_name: userName || 'Unknown',
      action,
      details: typeof details === 'object' ? JSON.stringify(details) : String(details),
      timestamp: new Date().toISOString()
    }
    await supabase.from('logs').insert(payload)
  } catch (err) {
    console.error('Log error:', err)
  }
}
