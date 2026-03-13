import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { syncOfflineQueue, getOfflineQueueCount, setCachedSewadars, getCachedSewadars } from '../lib/offline'
import { supabase } from '../lib/supabase'
import { LogOut, RefreshCw, Wifi, WifiOff, User, Database, Shield, Check, AlertCircle } from 'lucide-react'

export default function ProfilePage({ isOnline }) {
  const { profile, signOut } = useAuth()
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [cacheInfo, setCacheInfo] = useState(null)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => {
    setPendingCount(getOfflineQueueCount())
    const cache = getCachedSewadars()
    if (cache) setCacheInfo({ count: cache.length, note: 'Cached for offline use' })
  }, [])

  async function manualSync() {
    if (!isOnline) return
    setSyncing(true)
    const result = await syncOfflineQueue(supabase)
    setSyncMsg(`Synced ${result.synced} records. ${result.failed > 0 ? result.failed + ' failed.' : ''}`)
    setPendingCount(getOfflineQueueCount())
    setSyncing(false)
  }

  async function refreshCache() {
    setSyncing(true)
    let query = supabase.from('sewadars').select('*')
    if (profile.role === 'centre_user') {
      query = query.eq('centre', profile.centre)
    }
    const { data } = await query
    if (data) {
      setCachedSewadars(data)
      setCacheInfo({ count: data.length, note: 'Just refreshed' })
      setSyncMsg(`✓ Cached ${data.length} sewadars for offline use.`)
    }
    setSyncing(false)
  }

  const roleColor = { 
    super_admin: 'var(--gold)', 
    admin: 'var(--blue)', 
    centre_user: 'var(--green)' 
  }
  const roleName = { 
    super_admin: 'Super Admin', 
    admin: 'Admin', 
    centre_user: 'Centre User' 
  }

  return (
    <div className="page pb-nav">
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--gold)', fontSize: '1.3rem', fontWeight: 700 }}>
          My Profile
        </h2>
      </div>

      <div className="profile-card">
        <div className="flex items-center gap-3 mb-4">
          <div style={{
            width: 64, height: 64,
            background: `${roleColor[profile?.role]}20`,
            border: `2px solid ${roleColor[profile?.role]}40`,
            borderRadius: '16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <User size={28} color={roleColor[profile?.role]} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>{profile?.name || profile?.sewadar_name || 'User'}</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85rem', color: 'var(--gold)' }}>{profile?.badge_number}</div>
          </div>
        </div>
        
        <div className="divider" />
        
        <div className="info-row">
          <span className="info-label">Role</span>
          <span className="badge" style={{ background: `${roleColor[profile?.role]}20`, color: roleColor[profile?.role], border: `1px solid ${roleColor[profile?.role]}40` }}>
            {roleName[profile?.role]}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Centre</span>
          <span className="info-value">{profile?.centre}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Connection</span>
          <span className={`status-bar ${isOnline ? 'status-online' : 'status-offline'}`}>
            {isOnline ? <><Wifi size={14} /> Online</> : <><WifiOff size={14} /> Offline</>}
          </span>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="queue-card">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div style={{ width: 40, height: 40, background: 'var(--red-bg)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertCircle size={20} color="var(--red)" />
              </div>
              <div>
                <p style={{ fontWeight: 600, color: 'var(--red)', fontSize: '0.95rem' }}>{pendingCount} scans pending</p>
                <p className="text-muted text-xs mt-1">Will sync when back online</p>
              </div>
            </div>
            <button 
              className="btn btn-outline" 
              onClick={manualSync} 
              disabled={!isOnline || syncing} 
              style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
            >
              <RefreshCw size={14} /> Sync
            </button>
          </div>
        </div>
      )}

      <div className="cache-card">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <Database size={18} color="var(--text-muted)" />
            <span style={{ fontWeight: 600 }}>Offline Cache</span>
          </div>
          <button 
            className="btn btn-ghost" 
            onClick={refreshCache} 
            disabled={!isOnline || syncing}
            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <p className="text-muted text-sm">
          {cacheInfo ? `${cacheInfo.count} sewadars cached · ${cacheInfo.note}` : 'No cache. Tap Refresh to download for offline use.'}
        </p>
      </div>

      {syncMsg && (
        <div style={{
          background: 'var(--green-bg)', 
          border: '1px solid rgba(16, 185, 129, 0.2)',
          borderRadius: 'var(--radius-md)', 
          padding: '0.85rem 1rem', 
          color: 'var(--green)', 
          fontSize: '0.85rem', 
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <Check size={16} /> {syncMsg}
        </div>
      )}

      <button 
        className="btn btn-outline btn-full" 
        onClick={signOut} 
        style={{ marginTop: '1rem', borderColor: 'var(--red)', color: 'var(--red)' }}
      >
        <LogOut size={16} /> Sign Out
      </button>

      <p className="text-center text-muted text-xs mt-4">Sewadar Attendance System v1.0</p>
    </div>
  )
}
