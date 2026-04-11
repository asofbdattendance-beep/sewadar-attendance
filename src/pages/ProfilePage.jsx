import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { LogOut, Wifi, User, Volume2, VolumeX } from 'lucide-react'
import ConfirmModal from '../components/ConfirmModal'

export default function ProfilePage() {
  const { profile, signOut } = useAuth()
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('sa_sound') !== 'false')
  const [signOutConfirm, setSignOutConfirm] = useState(false)

  useEffect(() => {
    const handler = () => setSoundEnabled(localStorage.getItem('sa_sound') !== 'false')
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  function toggleSound() {
    const next = !soundEnabled
    setSoundEnabled(next)
    localStorage.setItem('sa_sound', next ? 'true' : 'false')
    window.dispatchEvent(new Event('storage'))
  }

  const roleColor = { aso: 'var(--gold)', centre: 'var(--blue)', sc_sp_user: 'var(--purple)' }
  const roleName = {aso: 'ASO', centre: 'CENTRE', sc_sp_user: 'SC/SP'}

  return (
    <div className="page pb-nav">
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>
          My Profile
        </h2>
      </div>

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
          <span className="status-bar status-online" style={{ padding: '0.2rem 0.75rem' }}>
            <Wifi size={12} /> Online
          </span>
        </div>
      </div>

      <div className="card mb-2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="flex items-center gap-1">
          {soundEnabled ? <Volume2 size={16} color="var(--text-muted)" /> : <VolumeX size={16} color="var(--text-muted)" />}
          <span style={{ fontWeight: 500 }}>Scan Sound &amp; Vibration</span>
        </div>
        <button onClick={toggleSound}
          style={{ background: soundEnabled ? 'var(--excel-green)' : 'var(--border)', border: 'none', borderRadius: 999, width: 44, height: 24, cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
          <span style={{ position: 'absolute', top: 2, left: soundEnabled ? 22 : 2, width: 20, height: 20, background: 'white', borderRadius: '50%', transition: 'left 0.2s', display: 'block' }} />
        </button>
      </div>

      <button className="btn btn-outline btn-full" onClick={() => setSignOutConfirm(true)} style={{ marginTop: '1rem', borderColor: 'rgba(224,92,92,0.3)', color: 'var(--red)' }}>
        <LogOut size={16} /> Sign Out
      </button>

      <ConfirmModal
        open={signOutConfirm}
        onConfirm={signOut}
        onCancel={() => setSignOutConfirm(false)}
        title="Sign out?"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign Out"
        danger
      />

      <p className="text-center text-muted text-xs mt-3">Sewadar Attendance System v1.0</p>
    </div>
  )
}
