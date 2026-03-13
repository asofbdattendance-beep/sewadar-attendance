import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES } from '../lib/supabase'
import {
  UserPlus, Trash2, Shield, MapPin, ToggleLeft, ToggleRight,
  RefreshCw, Download, FileSpreadsheet, Calendar, Filter,
  ChevronDown, ChevronRight, Users, Building2
} from 'lucide-react'

const PARENT_CENTRES = [
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
  const [newUser, setNewUser] = useState({
    email: '', password: '', name: '', badge_number: '',
    role: 'centre_user', centre: PARENT_CENTRES[0], parent_centre: ''
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [reportData, setReportData] = useState({ users: [], centres: [], logs: [] })
  const [reportLoading, setReportLoading] = useState(false)
  const [dateRange, setDateRange] = useState({ from: '', to: '' })
  const [expandedParent, setExpandedParent] = useState(null)

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
    let logsQ = supabase.from('logs').select('*').order('timestamp', { ascending: false }).limit(500)
    if (from) { const s = new Date(from); s.setHours(0,0,0,0); logsQ = logsQ.gte('timestamp', s.toISOString()) }
    if (to) { const e = new Date(to); e.setHours(23,59,59,999); logsQ = logsQ.lte('timestamp', e.toISOString()) }
    const [uRes, cRes, lRes] = await Promise.all([
      supabase.from('users').select('*').order('name'),
      supabase.from('centres').select('*').order('centre_name'),
      logsQ
    ])
    setReportData({ users: uRes.data || [], centres: cRes.data || [], logs: lRes.data || [] })
    setReportLoading(false)
  }

  // ── Geo toggle with cascade to children ──
  async function updateCentreGeo(centreId, field, value, centreName) {
    await supabase.from('centres').update({ [field]: value }).eq('id', centreId)

    // If toggling geo_enabled on a parent, cascade to all children
    if (field === 'geo_enabled' && centreName) {
      const { data: children } = await supabase
        .from('centres')
        .select('id')
        .eq('parent_centre', centreName)
      if (children?.length) {
        await supabase.from('centres')
          .update({ geo_enabled: value })
          .in('id', children.map(c => c.id))
      }
      await supabase.from('logs').insert({
        user_badge: profile.badge_number,
        action: 'GEO_TOGGLE_CASCADE',
        details: `Set geo_enabled=${value} for ${centreName} and ${children?.length || 0} sub-centres`,
        timestamp: new Date().toISOString()
      })
    }

    fetchCentres()
  }

  async function createUser() {
    setSaving(true); setMessage('')
    try {
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: newUser.email, password: newUser.password, email_confirm: true
      })
      if (authErr) throw authErr

      // For admin role: parent_centre IS their centre (they govern it)
      // For centre_user at a SP: parent_centre = the SP's parent centre
      const parentCentre = newUser.role === ROLES.ADMIN
        ? newUser.centre
        : newUser.parent_centre || null

      const { error: profileErr } = await supabase.from('users').insert({
        auth_id: authData.user.id,
        email: newUser.email,
        name: newUser.name,
        badge_number: newUser.badge_number.toUpperCase(),
        role: newUser.role,
        centre: newUser.centre,
        parent_centre: parentCentre,
        is_active: true,
        created_at: new Date().toISOString()
      })
      if (profileErr) throw profileErr

      await supabase.from('logs').insert({
        user_badge: profile.badge_number,
        action: 'CREATE_USER',
        details: `Created ${newUser.role} ${newUser.badge_number} for ${newUser.centre}`,
        timestamp: new Date().toISOString()
      })

      setMessage('✓ User created successfully!')
      setNewUser({ email:'', password:'', name:'', badge_number:'', role:'centre_user', centre: PARENT_CENTRES[0], parent_centre:'' })
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

  async function deleteUser(userId) {
    if (!confirm('Delete this user? This cannot be undone.')) return
    await supabase.from('users').delete().eq('id', userId)
    fetchUsers()
  }

  function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
  }

  function exportUsers() {
    const csv = [
      ['Name','Email','Badge','Role','Centre','Parent Centre','Active','Created'].join(','),
      ...reportData.users.map(u => [
        `"${u.name}"`, u.email, u.badge_number, u.role, u.centre,
        u.parent_centre || '', u.is_active ? 'Yes':'No',
        new Date(u.created_at).toLocaleDateString('en-IN')
      ].join(','))
    ].join('\n')
    downloadCSV(csv, 'users_export.csv')
  }

  function exportCentres() {
    const csv = [
      ['Centre Name','Parent Centre','Geo Enabled','Radius (m)','Latitude','Longitude'].join(','),
      ...reportData.centres.map(c => [
        c.centre_name, c.parent_centre||'',
        c.geo_enabled?'Yes':'No', c.geo_radius||'',
        c.latitude||'', c.longitude||''
      ].join(','))
    ].join('\n')
    downloadCSV(csv, 'centres_export.csv')
  }

  function exportLogs() {
    const csv = [
      ['Time','User Badge','Action','Details'].join(','),
      ...reportData.logs.map(l => [
        new Date(l.timestamp).toLocaleString('en-IN'),
        l.user_badge, l.action, `"${l.details}"`
      ].join(','))
    ].join('\n')
    downloadCSV(csv, 'logs_export.csv')
  }

  // Group centres by parent
  const centreTree = PARENT_CENTRES.map(parent => ({
    parent,
    children: centres.filter(c => c.parent_centre === parent),
    config: centres.find(c => c.centre_name === parent)
  }))

  const roleColor = { super_admin: 'var(--gold)', admin: 'var(--blue)', centre_user: 'var(--green)' }
  const roleName = { super_admin: 'Super Admin', admin: 'Admin', centre_user: 'Centre User' }

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 900 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>Control Panel</h2>
        <p className="text-muted text-xs mt-1">Super Admin</p>
      </div>

      {message && (
        <div className={`super-admin-msg ${message.startsWith('✓') ? 'msg-success' : 'msg-error'}`}>
          {message}
        </div>
      )}

      {/* Tabs */}
      <div className="tab-nav mb-3">
        {[
          { key: 'users', label: 'Users', Icon: Users },
          { key: 'centres', label: 'Centres & Geo', Icon: MapPin },
          { key: 'reports', label: 'Reports', Icon: FileSpreadsheet },
        ].map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`tab-btn ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── USERS TAB ── */}
      {tab === 'users' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button className="btn btn-gold" onClick={() => setShowAddUser(true)}>
              <UserPlus size={16} /> Add User
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
                    <th>Active</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 500 }}>{u.name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--gold)' }}>{u.badge_number}</td>
                      <td>
                        <span className="badge" style={{ background: `${roleColor[u.role]}18`, color: roleColor[u.role], border: `1px solid ${roleColor[u.role]}30` }}>
                          {roleName[u.role]}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>
                        <div>{u.centre}</div>
                        {u.parent_centre && u.parent_centre !== u.centre && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>↑ {u.parent_centre}</div>
                        )}
                      </td>
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
                      <td>
                        {u.role !== ROLES.SUPER_ADMIN && (
                          <button className="btn btn-ghost" style={{ padding: '0.25rem', color: 'var(--red)' }} onClick={() => deleteUser(u.id)}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── CENTRES & GEO TAB ── */}
      {tab === 'centres' && (
        <div>
          <p className="text-muted text-sm mb-3">
            Toggling geo on/off for a parent centre automatically cascades to all its sub-centres.
          </p>

          {loading ? <div className="spinner" style={{ margin: '2rem auto' }} /> : (
            <div className="centres-tree">
              {centreTree.map(({ parent, children, config }) => (
                <div key={parent} className="centre-parent-block">
                  {/* Parent row */}
                  <div className="centre-parent-row">
                    <button
                      className="centre-expand-btn"
                      onClick={() => setExpandedParent(expandedParent === parent ? null : parent)}
                    >
                      {expandedParent === parent ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <Building2 size={15} color="var(--gold)" />
                    <span className="centre-parent-name">{parent}</span>
                    {children.length > 0 && (
                      <span className="centre-child-count">{children.length} sub-centres</span>
                    )}
                    <div className="centre-parent-geo">
                      {config && (
                        <>
                          <span className="centre-geo-label">Geo</span>
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '0.15rem' }}
                            onClick={() => updateCentreGeo(config.id, 'geo_enabled', !config.geo_enabled, parent)}
                            title={config.geo_enabled ? 'Disable geo (will cascade to sub-centres)' : 'Enable geo'}
                          >
                            {config.geo_enabled
                              ? <ToggleRight size={22} color="var(--green)" />
                              : <ToggleLeft size={22} color="var(--text-muted)" />}
                          </button>
                          {config.geo_enabled && (
                            <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>ON</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Parent geo config row */}
                  {expandedParent === parent && config && (
                    <div className="centre-geo-config">
                      <div className="centre-geo-fields">
                        <div className="geo-field">
                          <label>Latitude</label>
                          <input
                            defaultValue={config.latitude || ''}
                            placeholder="e.g. 28.4595"
                            onBlur={e => updateCentreGeo(config.id, 'latitude', parseFloat(e.target.value), null)}
                          />
                        </div>
                        <div className="geo-field">
                          <label>Longitude</label>
                          <input
                            defaultValue={config.longitude || ''}
                            placeholder="e.g. 77.0266"
                            onBlur={e => updateCentreGeo(config.id, 'longitude', parseFloat(e.target.value), null)}
                          />
                        </div>
                        <div className="geo-field">
                          <label>Radius (m)</label>
                          <input
                            defaultValue={config.geo_radius || 200}
                            onBlur={e => updateCentreGeo(config.id, 'geo_radius', parseInt(e.target.value), null)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Child rows */}
                  {expandedParent === parent && children.map(child => (
                    <div key={child.id} className="centre-child-row">
                      <span className="centre-child-indent">└</span>
                      <span className="centre-child-name">{child.centre_name}</span>
                      <div className="centre-parent-geo">
                        <span className="centre-geo-label">Geo</span>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '0.15rem' }}
                          onClick={() => updateCentreGeo(child.id, 'geo_enabled', !child.geo_enabled, null)}
                        >
                          {child.geo_enabled
                            ? <ToggleRight size={20} color="var(--green)" />
                            : <ToggleLeft size={20} color="var(--text-muted)" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {/* Centres not assigned to any parent */}
              {centres.filter(c => !c.parent_centre && !PARENT_CENTRES.includes(c.centre_name)).length > 0 && (
                <div className="centre-parent-block">
                  <div className="centre-parent-row">
                    <Building2 size={15} color="var(--text-muted)" />
                    <span className="centre-parent-name" style={{ color: 'var(--text-muted)' }}>Unassigned centres</span>
                  </div>
                  {centres.filter(c => !c.parent_centre && !PARENT_CENTRES.includes(c.centre_name)).map(c => (
                    <div key={c.id} className="centre-child-row">
                      <span className="centre-child-indent">└</span>
                      <span className="centre-child-name">{c.centre_name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── REPORTS TAB ── */}
      {tab === 'reports' && (
        <div>
          <div className="reports-header">
            <div className="date-filters">
              <div className="filter-item">
                <Calendar size={14} />
                <input type="date" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })} />
              </div>
              <div className="filter-item">
                <Calendar size={14} />
                <input type="date" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })} />
              </div>
              <button className="btn-refresh" onClick={fetchReports}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {reportLoading ? <div className="spinner" style={{ margin: '2rem auto' }} /> : (
            <div className="reports-grid">
              <div className="report-card">
                <div className="report-icon"><Users size={20} /></div>
                <div className="report-info">
                  <div className="report-count">{reportData.users.length}</div>
                  <div className="report-label">Users</div>
                </div>
                <button className="btn-download" onClick={exportUsers}><Download size={16} /></button>
              </div>
              <div className="report-card">
                <div className="report-icon"><MapPin size={20} /></div>
                <div className="report-info">
                  <div className="report-count">{reportData.centres.length}</div>
                  <div className="report-label">Centres</div>
                </div>
                <button className="btn-download" onClick={exportCentres}><Download size={16} /></button>
              </div>
              <div className="report-card">
                <div className="report-icon"><Shield size={20} /></div>
                <div className="report-info">
                  <div className="report-count">{reportData.logs.length}</div>
                  <div className="report-label">System Logs</div>
                </div>
                <button className="btn-download" onClick={exportLogs}><Download size={16} /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ADD USER MODAL ── */}
      {showAddUser && (
        <div className="overlay" onClick={() => setShowAddUser(false)}>
          <div className="overlay-sheet" style={{ maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
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
              <label className="label">Email</label>
              <input className="input" type="email" placeholder="user@email.com" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} />
            </div>
            <div className="mb-2">
              <label className="label">Password</label>
              <input className="input" type="password" placeholder="Min 8 characters" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label className="label">Role</label>
                <select className="input" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                  <option value="centre_user">Centre User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="label">
                  {newUser.role === ROLES.ADMIN ? 'Parent Centre (governs)' : 'Centre'}
                </label>
                <select className="input" value={newUser.centre} onChange={e => setNewUser({ ...newUser, centre: e.target.value, parent_centre: newUser.role === ROLES.ADMIN ? e.target.value : newUser.parent_centre })}>
                  {/* For admins: only parent centres. For centre_users: all centres from DB */}
                  {newUser.role === ROLES.ADMIN
                    ? PARENT_CENTRES.map(c => <option key={c} value={c}>{c}</option>)
                    : centres.map(c => <option key={c.centre_name} value={c.centre_name}>{c.centre_name}</option>)
                  }
                </select>
              </div>
            </div>

            {/* Parent centre picker for SP centre_users */}
            {newUser.role === ROLES.CENTRE_USER && (
              <div className="mb-2">
                <label className="label">Parent Centre <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>(if this is a sub-centre/SP)</span></label>
                <select className="input" value={newUser.parent_centre} onChange={e => setNewUser({ ...newUser, parent_centre: e.target.value })}>
                  <option value="">— None (is a parent centre) —</option>
                  {PARENT_CENTRES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            {newUser.role === ROLES.ADMIN && (
              <div className="super-admin-note">
                This admin will automatically see data for <strong>{newUser.centre}</strong> and all its sub-centres.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="btn btn-outline btn-full" onClick={() => setShowAddUser(false)}>Cancel</button>
              <button className="btn btn-gold btn-full" onClick={createUser} disabled={saving}>
                {saving ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
