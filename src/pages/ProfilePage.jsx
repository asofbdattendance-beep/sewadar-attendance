import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { syncOfflineQueue, getOfflineQueueCount, setCachedSewadars, getCachedSewadars } from '../lib/offline'
import { supabase } from '../lib/supabase'
import { LogOut, RefreshCw, Wifi, WifiOff, User, Database, Shield } from 'lucide-react'

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
    if (profile.role === 'sc_sp_user') {
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

  const roleColor = { area_secretary: 'var(--gold)', centre_user: 'var(--blue)', sc_sp_user: 'var(--green)' }
  const roleName = { area_secretary: 'AREA SECRETARY', centre_user: 'CENTRE USER', sc_sp_user: 'SC_SP USER' }

  return (
    <div className="page pb-nav">
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>
          My Profile
        </h2>
      </div>

      {/* Profile card */}
      <div className="card mb-2" style={{ borderColor: roleColor[profile?.role] + '40' }}>
        <div className="flex items-center gap-2 mb-2">
          <div style={{
            width: 52, height: 52,
            background: `${roleColor[profile?.role]}20`,
            border: `1px solid ${roleColor[profile?.role]}40`,
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <User size={24} color={roleColor[profile?.role]} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>{profile?.name}</div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--gold)' }}>{profile?.badge_number}</div>
          </div>
        </div>
        <div className="divider" style={{ margin: '0.75rem 0' }} />
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
          <span className={`status-bar ${isOnline ? 'status-online' : 'status-offline'}`} style={{ padding: '0.2rem 0.75rem' }}>
            {isOnline ? <><Wifi size={12} /> Online</> : <><WifiOff size={12} /> Offline</>}
          </span>
        </div>
      </div>

      {/* Offline queue */}
      {pendingCount > 0 && (
        <div className="card mb-2" style={{ borderColor: 'rgba(224,92,92,0.3)', background: 'rgba(224,92,92,0.05)' }}>
          <div className="flex justify-between items-center">
            <div>
              <p style={{ fontWeight: 600, color: 'var(--red)' }}>{pendingCount} scans pending sync</p>
              <p className="text-muted text-xs mt-1">These will sync when you're back online</p>
            </div>
            <button className="btn btn-outline" onClick={manualSync} disabled={!isOnline || syncing} style={{ fontSize: '0.82rem', padding: '0.5rem 1rem', borderColor: 'rgba(224,92,92,0.4)', color: 'var(--red)' }}>
              {syncing ? '...' : 'Sync Now'}
            </button>
          </div>
        </div>
      )}

      {/* Cache management */}
      <div className="card mb-2">
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-center gap-1">
            <Database size={16} color="var(--text-muted)" />
            <span style={{ fontWeight: 500 }}>Offline Cache</span>
          </div>
          <button className="btn btn-ghost" onClick={refreshCache} disabled={!isOnline || syncing} style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <p className="text-muted text-sm">
          {cacheInfo ? `${cacheInfo.count} sewadars cached · ${cacheInfo.note}` : 'No cache yet. Tap Refresh to download sewadar data for offline use.'}
        </p>
      </div>

      {syncMsg && (
        <div style={{
          background: 'rgba(76,175,125,0.1)', border: '1px solid rgba(76,175,125,0.2)',
          borderRadius: 'var(--radius)', padding: '0.75rem 1rem',
          color: 'var(--green)', fontSize: '0.85rem', marginBottom: '1rem'
        }}>
          {syncMsg}
        </div>
      )}

      {/* Sign out */}
      <button className="btn btn-outline btn-full" onClick={signOut} style={{ marginTop: '1rem', borderColor: 'rgba(224,92,92,0.3)', color: 'var(--red)' }}>
        <LogOut size={16} /> Sign Out
      </button>

      <p className="text-center text-muted text-xs mt-3">Sewadar Attendance System v1.0</p>
    </div>
  )
}
