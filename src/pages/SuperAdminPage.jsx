import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES } from '../lib/supabase'
import { UserPlus, Trash2, Shield, MapPin, ToggleLeft, ToggleRight, RefreshCw, Download, FileSpreadsheet, Calendar, Filter } from 'lucide-react'

const CENTRE_LIST = [
  'ANKHEER','BALLABGARH','DLF CITY GURGAON','FIROZPUR JHIRKA',
  'TAORU','GURGAON','MOHANA','ZAIBABAD KHERLI','NANGLA GUJRAN',
  'NIT - 2','PALWAL','BAROLI','HODAL','RAJENDRA PARK',
  'SECTOR-15-A','PRITHLA','SURAJ KUND','TIGAON'
]

export default function SuperAdminPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [centres, setCentres] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', password: '', name: '', badge_number: '', role: 'centre_user', centre: 'SECTOR-15-A' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [reportData, setReportData] = useState({ users: [], centres: [], logs: [] })
  const [reportLoading, setReportLoading] = useState(false)
  const [dateRange, setDateRange] = useState({ from: '', to: '' })

  if (profile?.role !== ROLES.SUPER_ADMIN) {
    return <div className="page text-center mt-3"><p className="text-muted">Access denied.</p></div>
  }

  useEffect(() => {
    if (tab === 'users') fetchUsers()
    if (tab === 'centres') fetchCentres()
    if (tab === 'reports') fetchReports()
  }, [tab, dateRange])

  async function fetchUsers() {
    setLoading(true)
    const { data } = await supabase.from('users').select('*').order('name')
    setUsers(data || [])
    setLoading(false)
  }

  async function fetchCentres() {
    setLoading(true)
    const { data } = await supabase.from('centres').select('*').order('centre_name')
    setCentres(data || [])
    setLoading(false)
  }

  async function fetchReports() {
    setReportLoading(true)
    const { from, to } = dateRange
    
    let usersData, centresData, logsData
    
    const usersQ = supabase.from('users').select('*').order('name')
    const centresQ = supabase.from('centres').select('*').order('centre_name')
    let logsQ = supabase.from('logs').select('*').order('timestamp', { ascending: false }).limit(500)
    
    if (from) {
      const start = new Date(from)
      start.setHours(0, 0, 0, 0)
      logsQ = logsQ.gte('timestamp', start.toISOString())
    }
    if (to) {
      const end = new Date(to)
      end.setHours(23, 59, 59, 999)
      logsQ = logsQ.lte('timestamp', end.toISOString())
    }
    
    const [uRes, cRes, lRes] = await Promise.all([usersQ, centresQ, logsQ])
    usersData = uRes.data || []
    centresData = cRes.data || []
    logsData = lRes.data || []
    
    setReportData({ users: usersData, centres: centresData, logs: logsData })
    setReportLoading(false)
  }

  function exportUsers() {
    const csv = [
      ['Name', 'Email', 'Badge Number', 'Role', 'Centre', 'Active', 'Created'].join(','),
      ...reportData.users.map(u => [
        `"${u.name}"`,
        u.email,
        u.badge_number,
        u.role,
        u.centre,
        u.is_active ? 'Yes' : 'No',
        new Date(u.created_at).toLocaleDateString('en-IN')
      ].join(','))
    ].join('\n')
    downloadCSV(csv, 'users_export.csv')
  }

  function exportAttendance() {
    const csv = [
      ['Badge', 'Name', 'Centre', 'Dept', 'Type', 'Date/Time', 'Scanner', 'Device'].join(','),
      ...reportData.logs
        .filter(l => l.action === 'MARK_ATTENDANCE')
        .map(l => {
          const details = l.details.match(/Marked (IN|OUT) for (.*)/)
          return [
            details?.[2] || '',
            '',
            '',
            '',
            details?.[1] || '',
            new Date(l.timestamp).toLocaleString('en-IN'),
            l.user_badge,
            ''
          ].join(',')
        })
    ].join('\n')
    downloadCSV(csv, 'attendance_export.csv')
  }

  function exportCentres() {
    const csv = [
      ['Centre Name', 'Latitude', 'Longitude', 'Geo Radius', 'Geo Enabled'].join(','),
      ...reportData.centres.map(c => [
        c.centre_name,
        c.latitude || '',
        c.longitude || '',
        c.geo_radius || '',
        c.geo_enabled ? 'Yes' : 'No'
      ].join(','))
    ].join('\n')
    downloadCSV(csv, 'centres_export.csv')
  }

  function exportLogs() {
    const csv = [
      ['Time', 'User Badge', 'Action', 'Details'].join(','),
      ...reportData.logs.map(l => [
        new Date(l.timestamp).toLocaleString('en-IN'),
        l.user_badge,
        l.action,
        `"${l.details}"`
      ].join(','))
    ].join('\n')
    downloadCSV(csv, 'logs_export.csv')
  }

  function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }

  async function createUser() {
    setSaving(true)
    setMessage('')
    try {
      // Create auth user
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: newUser.email,
        password: newUser.password,
        email_confirm: true
      })
      if (authErr) throw authErr

      // Create profile
      const { error: profileErr } = await supabase.from('users').insert({
        auth_id: authData.user.id,
        email: newUser.email,
        name: newUser.name,
        badge_number: newUser.badge_number.toUpperCase(),
        role: newUser.role,
        centre: newUser.centre,
        is_active: true,
        created_at: new Date().toISOString()
      })
      if (profileErr) throw profileErr

      await supabase.from('logs').insert({
        user_badge: profile.badge_number,
        action: 'CREATE_USER',
        details: `Created user ${newUser.badge_number} (${newUser.role}) for ${newUser.centre}`,
        timestamp: new Date().toISOString()
      })

      setMessage('✓ User created successfully!')
      setNewUser({ email: '', password: '', name: '', badge_number: '', role: 'centre_user', centre: 'SECTOR-15-A' })
      setShowAddUser(false)
      fetchUsers()
    } catch (err) {
      setMessage('✗ ' + (err.message || 'Failed to create user'))
    } finally {
      setSaving(false)
    }
  }

  async function toggleUserActive(userId, current) {
    await supabase.from('users').update({ is_active: !current }).eq('id', userId)
    fetchUsers()
  }

  async function updateCentreGeo(centreId, field, value) {
    await supabase.from('centres').update({ [field]: value }).eq('id', centreId)
    fetchCentres()
  }

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 900 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>
          Super Admin
        </h2>
        <p className="text-muted text-xs mt-1">Full system control</p>
      </div>

      <div className="tab-nav">
        <button className={`tab-btn ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>
          <Shield size={14} /> Users
        </button>
        <button className={`tab-btn ${tab === 'centres' ? 'active' : ''}`} onClick={() => setTab('centres')}>
          <MapPin size={14} /> Centres
        </button>
        <button className={`tab-btn ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>
          <FileSpreadsheet size={14} /> Reports
        </button>
      </div>

      {message && (
        <div style={{
          background: message.startsWith('✓') ? 'rgba(76,175,125,0.1)' : 'rgba(224,92,92,0.1)',
          border: `1px solid ${message.startsWith('✓') ? 'rgba(76,175,125,0.3)' : 'rgba(224,92,92,0.3)'}`,
          borderRadius: 'var(--radius)', padding: '0.75rem 1rem',
          color: message.startsWith('✓') ? 'var(--green)' : 'var(--red)',
          fontSize: '0.875rem', marginBottom: '1rem'
        }}>
          {message}
        </div>
      )}

      {/* Users Tab */}
      {tab === 'users' && (
        <div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-muted text-sm">{users.length} users total</p>
            <button className="btn btn-gold" onClick={() => setShowAddUser(true)} style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
              <UserPlus size={15} /> Add User
            </button>
          </div>

          {loading ? <div className="spinner" style={{ margin: '2rem auto' }} /> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Badge</th>
                    <th>Role</th>
                    <th>Centre</th>
                    <th>Status</th>
                    <th>Toggle</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 500 }}>{u.name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gold)' }}>{u.badge_number}</td>
                      <td>
                        <span className={`badge ${u.role === 'super_admin' ? 'badge-gold' : u.role === 'admin' ? 'badge-blue' : 'badge-muted'}`}>
                          {u.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.85rem' }}>{u.centre}</td>
                      <td>
                        <span className={`badge ${u.is_active ? 'badge-green' : 'badge-red'}`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-ghost" style={{ padding: '0.25rem' }} onClick={() => toggleUserActive(u.id, u.is_active)}>
                          {u.is_active
                            ? <ToggleRight size={22} color="var(--green)" />
                            : <ToggleLeft size={22} color="var(--text-muted)" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Centres Tab */}
      {tab === 'centres' && (
        <div>
          <p className="text-muted text-sm mb-2">Manage geo-fencing per centre</p>
          {loading ? <div className="spinner" style={{ margin: '2rem auto' }} /> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Centre</th>
                    <th>Latitude</th>
                    <th>Longitude</th>
                    <th>Radius (m)</th>
                    <th>Geo ON</th>
                  </tr>
                </thead>
                <tbody>
                  {centres.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 500, fontSize: '0.85rem' }}>{c.centre_name}</td>
                      <td>
                        <input
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', width: 80, fontSize: '0.82rem', outline: 'none' }}
                          defaultValue={c.latitude}
                          onBlur={e => updateCentreGeo(c.id, 'latitude', parseFloat(e.target.value))}
                        />
                      </td>
                      <td>
                        <input
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', width: 80, fontSize: '0.82rem', outline: 'none' }}
                          defaultValue={c.longitude}
                          onBlur={e => updateCentreGeo(c.id, 'longitude', parseFloat(e.target.value))}
                        />
                      </td>
                      <td>
                        <input
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', width: 50, fontSize: '0.82rem', outline: 'none' }}
                          defaultValue={c.geo_radius || 200}
                          onBlur={e => updateCentreGeo(c.id, 'geo_radius', parseInt(e.target.value))}
                        />
                      </td>
                      <td>
                        <button className="btn btn-ghost" style={{ padding: '0.25rem' }} onClick={() => updateCentreGeo(c.id, 'geo_enabled', !c.geo_enabled)}>
                          {c.geo_enabled
                            ? <ToggleRight size={22} color="var(--green)" />
                            : <ToggleLeft size={22} color="var(--text-muted)" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Reports Tab */}
      {tab === 'reports' && (
        <div>
          <div className="reports-header">
            <div className="date-filters">
              <div className="filter-item">
                <Calendar size={14} />
                <input type="date" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })} placeholder="From" />
              </div>
              <div className="filter-item">
                <Calendar size={14} />
                <input type="date" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })} placeholder="To" />
              </div>
              <button className="btn-refresh" onClick={fetchReports}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {reportLoading ? (
            <div className="spinner" style={{ margin: '2rem auto' }} />
          ) : (
            <div className="reports-grid">
              <div className="report-card">
                <div className="report-icon"><UserPlus size={20} /></div>
                <div className="report-info">
                  <div className="report-count">{reportData.users.length}</div>
                  <div className="report-label">Users</div>
                </div>
                <button className="btn-download" onClick={exportUsers}>
                  <Download size={16} />
                </button>
              </div>

              <div className="report-card">
                <div className="report-icon"><FileSpreadsheet size={20} /></div>
                <div className="report-info">
                  <div className="report-count">{reportData.logs.filter(l => l.action === 'MARK_ATTENDANCE').length}</div>
                  <div className="report-label">Attendance</div>
                </div>
                <button className="btn-download" onClick={exportAttendance}>
                  <Download size={16} />
                </button>
              </div>

              <div className="report-card">
                <div className="report-icon"><MapPin size={20} /></div>
                <div className="report-info">
                  <div className="report-count">{reportData.centres.length}</div>
                  <div className="report-label">Centres</div>
                </div>
                <button className="btn-download" onClick={exportCentres}>
                  <Download size={16} />
                </button>
              </div>

              <div className="report-card">
                <div className="report-icon"><Shield size={20} /></div>
                <div className="report-info">
                  <div className="report-count">{reportData.logs.length}</div>
                  <div className="report-label">System Logs</div>
                </div>
                <button className="btn-download" onClick={exportLogs}>
                  <Download size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add User Modal */}
      {showAddUser && (
        <div className="overlay" onClick={() => setShowAddUser(false)}>
          <div className="overlay-sheet" onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', marginBottom: '1.5rem' }}>Add New User</h3>

            <div className="mb-2">
              <label className="label">Full Name</label>
              <input className="input" placeholder="Ravi Kumar" value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} />
            </div>
            <div className="mb-2">
              <label className="label">Badge Number</label>
              <input className="input" placeholder="FB5978GA0001" style={{ textTransform: 'uppercase' }} value={newUser.badge_number} onChange={e => setNewUser({ ...newUser, badge_number: e.target.value })} />
            </div>
            <div className="mb-2">
              <label className="label">Email (for login)</label>
              <input className="input" type="email" placeholder="user@email.com" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} />
            </div>
            <div className="mb-2">
              <label className="label">Password</label>
              <input className="input" type="password" placeholder="Min 8 characters" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} />
            </div>
            <div className="mb-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label className="label">Role</label>
                <select className="input" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                  <option value="centre_user">Centre User</option>
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div>
                <label className="label">Centre</label>
                <select className="input" value={newUser.centre} onChange={e => setNewUser({ ...newUser, centre: e.target.value })}>
                  {CENTRE_LIST.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="btn btn-outline btn-full" onClick={() => setShowAddUser(false)}>Cancel</button>
              <button className="btn btn-gold btn-full" onClick={createUser} disabled={saving}>
                {saving ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
