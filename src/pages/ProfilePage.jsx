import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { syncOfflineQueue, getOfflineQueueCount, setCachedSewadars, getCachedSewadars, getCacheAge, isOfflineQueueFull } from '../lib/offline'
import { supabase } from '../lib/supabase'
import { LogOut, RefreshCw, Wifi, WifiOff, User, Database, Shield } from 'lucide-react'

export default function ProfilePage({ isOnline }) {
  const { profile, signOut } = useAuth()
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [soundOn, setSoundOn] = useState(localStorage.getItem('sa_sound') !== 'false')
  const [cacheInfo, setCacheInfo] = useState(null)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => {
    setPendingCount(getOfflineQueueCount())
    const cache = getCachedSewadars()
    const age = getCacheAge()
    if (cache) setCacheInfo({ count: cache.length, note: age !== null ? `${age === 0 ? 'Just refreshed' : `${age}m ago`}` : 'Age unknown' })
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
    // Always fetch all sewadars — scanner needs full dataset for badge lookup
    const { data } = await supabase.from('sewadars')
      .select('badge_number,sewadar_name,centre,department,badge_status,gender,geo_required,father_husband_name,age')
    if (data) {
      setCachedSewadars(data)
      setCacheInfo({ count: data.length, note: 'Just refreshed' })
      setSyncMsg(`✓ ${data.length} sewadars cached for fast scanning.`)
    }
    setSyncing(false)
  }

  const roleColor = { aso: 'var(--gold)', centre_user: 'var(--blue)', sc_sp_user: 'var(--green)' }
  const roleName = {aso: 'ASO', centre_user: 'CENTRE USER', sc_sp_user: 'SC_SP USER' }

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
            <span style={{ fontWeight: 500 }}>Sewadar Cache</span>
          </div>
          <button className="btn btn-ghost" onClick={refreshCache} disabled={!isOnline || syncing} style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <p className="text-muted text-sm">
          {cacheInfo ? `${cacheInfo.count} sewadars cached · ${cacheInfo.note} · Used for offline scanning only` : 'No sewadar cache. Tap Refresh to enable offline scanning.'}
        </p>
      </div>

      {/* Sound toggle */}
      <div className="card mb-2">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1">
            <span style={{ fontSize: '0.9rem' }}>🔔</span>
            <span style={{ fontWeight: 500 }}>Scan Sound &amp; Vibration</span>
          </div>
          <button
            onClick={() => { const next = !soundOn; setSoundOn(next); localStorage.setItem('sa_sound', next ? 'true' : 'false') }}
            style={{ width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', background: soundOn ? 'var(--green)' : 'var(--border)' }}>
            <span style={{ position: 'absolute', top: 3, left: soundOn ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
          </button>
        </div>
        <p className="text-muted text-sm mt-1">{soundOn ? 'Beep + vibration on each scan' : 'Silent scanning'}</p>
      </div>

      {/* Queue full warning */}
      {isOfflineQueueFull() && (
        <div className="card mb-2" style={{ borderColor: 'rgba(198,40,40,0.4)', background: 'rgba(198,40,40,0.06)' }}>
          <p style={{ fontWeight: 700, color: 'var(--red)', fontSize: '0.88rem' }}>⚠ Offline queue is full (500 records)</p>
          <p className="text-muted text-xs mt-1">Connect to internet and sync immediately. New scans may not be saved.</p>
        </div>
      )}

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
      <button className="btn btn-outline btn-full" onClick={() => { if (confirm('Sign out of Sewadar Attendance?')) signOut() }} style={{ marginTop: '1rem', borderColor: 'rgba(224,92,92,0.3)', color: 'var(--red)' }}>
        <LogOut size={16} /> Sign Out
      </button>

      <p className="text-center text-muted text-xs mt-3">Sewadar Attendance System v1.0</p>
    </div>
  )
}