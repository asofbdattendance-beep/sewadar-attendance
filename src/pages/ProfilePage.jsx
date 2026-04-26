import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { ROLES, ROLE_LABELS, ROLE_COLORS } from '../lib/supabase'
import { User, BadgeCheck, Building, Shield, LogOut, Clock } from 'lucide-react'

export default function ProfilePage() {
  const { profile, signOut } = useAuth()
  const [loading, setLoading] = useState(false)

  const handleSignOut = async () => {
    setLoading(true)
    await signOut()
  }

  const roleInfo = {
    label: ROLE_LABELS[profile?.role] || profile?.role || 'Unknown',
    color: ROLE_COLORS[profile?.role] || '#6b7280'
  }

  return (
    <div className="page pb-nav">
      <div className="profile-header">
        <div className="profile-avatar">
          <User size={32} />
        </div>
        <div className="profile-name">{profile?.name || 'User'}</div>
        <div className="profile-email">{profile?.email}</div>
        <span className="profile-role-badge" style={{ background: `${roleInfo.color}15`, color: roleInfo.color }}>
          <Shield size={12} />
          {roleInfo.label}
        </span>
      </div>

      <div className="profile-section">
        <div className="profile-section-title">
          <User size={14} />
          Personal Information
        </div>
        <div className="profile-card">
          <div className="profile-field">
            <span className="field-label">Full Name</span>
            <span className="field-value">{profile?.name}</span>
          </div>
          <div className="profile-field">
            <span className="field-label">Email</span>
            <span className="field-value">{profile?.email}</span>
          </div>
        </div>
      </div>

      <div className="profile-section">
        <div className="profile-section-title">
          <BadgeCheck size={14} />
          Scanner Details
        </div>
        <div className="profile-card">
          <div className="profile-field">
            <span className="field-label">Badge Number</span>
            <span className="field-value badge-value">{profile?.badge_number || '—'}</span>
          </div>
          <div className="profile-field">
            <span className="field-label">Centre</span>
            <span className="field-value">{profile?.centre || '—'}</span>
          </div>
          <div className="profile-field">
            <span className="field-label">Role</span>
            <span className="field-value">{roleInfo.label}</span>
          </div>
        </div>
      </div>

      <div className="profile-section">
        <div className="profile-section-title">
          <Building size={14} />
          Centre Access
        </div>
        <div className="profile-card">
          <div className="profile-field">
            <span className="field-label">Assigned Centre</span>
            <span className="field-value">{profile?.centre || '—'}</span>
          </div>
          {profile?.role === ROLES.SC_SP_USER && (
            <div className="profile-note">
              <span>You can only scan sewadars from your assigned centre</span>
            </div>
          )}
        </div>
      </div>

      <button className="logout-btn" onClick={handleSignOut} disabled={loading}>
        <LogOut size={18} />
        {loading ? 'Signing out...' : 'Sign Out'}
      </button>

      <div className="profile-footer">
        <Clock size={12} />
        <span>Sewadar Attendance v2.0</span>
      </div>
    </div>
  )
}
