// src/pages/SuperAdminPage.jsx
// AREA_SECRETARY ONLY
// KEY FIXES:
//   1. createUser() now calls the Edge Function "create-user" (service-role auth, browser-safe)
//   2. deleteAttRecord / deleteUser now check both error AND count===0 for silent RLS blocks
//   3. All errors are surfaced clearly in the message banner

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, JATHA_TYPE, JATHA_TYPE_LABEL } from '../lib/supabase'
import {
  UserPlus, Trash2, Shield, MapPin, ToggleLeft, ToggleRight,
  RefreshCw, Download, FileSpreadsheet, Calendar,
  ChevronDown, ChevronRight, Users, Building2, Plane,
  Pencil, X, Check, Search, PlusCircle, Eye, EyeOff
} from 'lucide-react'

const PARENT_CENTRES = [
  'ANKHEER','BALLABGARH','DLF CITY GURGAON','FIROZPUR JHIRKA',
  'TAORU','GURGAON','MOHANA','ZAIBABAD KHERLI','NANGLA GUJRAN',
  'NIT - 2','PALWAL','BAROLI','HODAL','RAJENDRA PARK',
  'SECTOR-15-A','PRITHLA','SURAJ KUND','TIGAON'
]

function logAction(profile, action, details) {
  return supabase.from('logs').insert({
    user_badge: profile.badge_number, action, details,
    timestamp: new Date().toISOString()
  })
}

export default function SuperAdminPage() {
  const { profile } = useAuth()

  // ── ALL HOOKS FIRST ──
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [centres, setCentres] = useState([])
  const [loading, setLoading] = useState(false)
  const [showAddUser, setShowAddUser] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [newUser, setNewUser] = useState({ email:'', password:'', name:'', badge_number:'', role:'sc_sp_user', centre: PARENT_CENTRES[0] })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [reportData, setReportData] = useState({ users:[], centres:[], logs:[] })
  const [reportLoading, setReportLoading] = useState(false)
  const [dateRange, setDateRange] = useState({ from:'', to:'' })
  const [expandedParent, setExpandedParent] = useState(null)
  const [expandedChild, setExpandedChild] = useState(null)
  const [sewadars, setSewadars] = useState([])
  const [sewadarSearch, setSewadarSearch] = useState('')
  const [sewadarCentreFilter, setSewadarCentreFilter] = useState('')
  const [sewadarLoading, setSewadarLoading] = useState(false)
  const [editingSewadar, setEditingSewadar] = useState(null)
  const [sewadarForm, setSewadarForm] = useState({})
  const [showAddSewadar, setShowAddSewadar] = useState(false)
  const [newSewadar, setNewSewadar] = useState({ sewadar_name:'', badge_number:'', centre: PARENT_CENTRES[0], department:'', gender:'Male', age:'', father_husband_name:'' })
  const [attSearch, setAttSearch] = useState('')
  const [attDate, setAttDate] = useState(new Date().toISOString().split('T')[0])
  const [attRecords, setAttRecords] = useState([])
  const [attLoading, setAttLoading] = useState(false)
  const [editingAtt, setEditingAtt] = useState(null)
  const [editAttTime, setEditAttTime] = useState('')
  const [editAttType, setEditAttType] = useState('')
  // Jatha Centres
  const [jathaCentres, setJathaCentres] = useState([])
  const [jathaCentresLoading, setJathaCentresLoading] = useState(false)
  const [showAddJatha, setShowAddJatha] = useState(false)
  const [newJatha, setNewJatha] = useState({ jatha_type: JATHA_TYPE.MAJOR_CENTRE, centre_name:'', department:'', is_active: true })
  const [editingJatha, setEditingJatha] = useState(null)
  const [editJathaForm, setEditJathaForm] = useState({})
  const [jathaTypeFilter, setJathaTypeFilter] = useState('')

  useEffect(() => {
    if (tab === 'users') fetchUsers()
    else if (tab === 'centres') fetchCentres()
    else if (tab === 'reports') fetchReports()
    else if (tab === 'sewadars') fetchSewadars()
    else if (tab === 'attendance') fetchAttendance()
    else if (tab === 'jatha_centres') fetchJathaCentres()
  }, [tab, dateRange])

  useEffect(() => { if (tab === 'sewadars') fetchSewadars() }, [sewadarSearch, sewadarCentreFilter])
  useEffect(() => { if (tab === 'attendance') fetchAttendance() }, [attDate, attSearch])
  useEffect(() => { if (tab === 'jatha_centres') fetchJathaCentres() }, [jathaTypeFilter])

  // ── Guard ──
  if (profile?.role !== ROLES.AREA_SECRETARY) return (
    <div className="page text-center mt-3"><p className="text-muted">Access denied.</p></div>
  )

  function showMsg(msg) {
    setMessage(msg)
    // Auto-clear success messages after 4s
    if (msg.startsWith('✓')) setTimeout(() => setMessage(m => m === msg ? '' : m), 4000)
  }

  // ── Users ──
  async function fetchUsers() {
    setLoading(true)
    const { data, error } = await supabase.from('users').select('*').order('name')
    if (error) showMsg('✗ Failed to load users: ' + error.message)
    setUsers(data || []); setLoading(false)
  }

  async function toggleUserActive(u) {
    const { error } = await supabase.from('users').update({ is_active: !u.is_active }).eq('id', u.id)
    if (error) { showMsg('✗ ' + error.message); return }
    await logAction(profile, 'TOGGLE_USER', `is_active=${!u.is_active} for ${u.badge_number}`)
    fetchUsers()
  }

  async function deleteUser(u) {
    if (!confirm(`Delete user ${u.name}?\n\nThis removes their login access. Attendance records are preserved.`)) return
    const { error, count } = await supabase.from('users').delete({ count: 'exact' }).eq('id', u.id)
    if (error) { showMsg('✗ Delete failed: ' + error.message); return }
    if (count === 0) { showMsg('✗ Delete blocked — check Supabase RLS policy for the users table (area_secretary must have DELETE permission)'); return }
    await logAction(profile, 'DELETE_USER', `Deleted ${u.badge_number} ${u.name}`)
    showMsg('✓ User deleted')
    fetchUsers()
  }

  // ── CREATE USER via Edge Function (service-role, browser-safe) ──
  async function createUser() {
    const { email, password, name, badge_number, role, centre } = newUser
    if (!email || !password || !name || !badge_number) {
      showMsg('✗ All fields are required'); return
    }
    if (password.length < 8) { showMsg('✗ Password must be at least 8 characters'); return }

    setSaving(true); setMessage('')
    try {
      // Get the current session token to pass to the Edge Function
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No active session — please sign in again')

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ email, password, name, badge_number, role, centre }),
        }
      )

      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)

      await logAction(profile, 'CREATE_USER', `Created ${role} ${badge_number.toUpperCase()} via edge function`)
      showMsg('✓ User created successfully!')
      setShowAddUser(false)
      setNewUser({ email:'', password:'', name:'', badge_number:'', role:'sc_sp_user', centre: PARENT_CENTRES[0] })
      fetchUsers()
    } catch (err) {
      showMsg('✗ ' + (err.message || 'Failed to create user'))
    } finally {
      setSaving(false)
    }
  }

  // ── Centres ──
  async function fetchCentres() {
    setLoading(true)
    const { data } = await supabase.from('centres').select('*').order('centre_name')
    setCentres(data || []); setLoading(false)
  }
  async function updateCentreGeo(centreId, field, value, centreName) {
    const { error } = await supabase.from('centres').update({ [field]: value }).eq('id', centreId)
    if (error) { showMsg('✗ ' + error.message); return }
    if (field === 'geo_enabled' && centreName) {
      const { data: ch } = await supabase.from('centres').select('id').eq('parent_centre', centreName)
      if (ch?.length) await supabase.from('centres').update({ geo_enabled: value }).in('id', ch.map(c => c.id))
      await logAction(profile, 'GEO_TOGGLE_CASCADE', `geo_enabled=${value} for ${centreName} + ${ch?.length||0} sub-centres`)
    }
    fetchCentres()
  }

  // ── Reports ──
  async function fetchReports() {
    setReportLoading(true)
    const { from, to } = dateRange
    let lq = supabase.from('logs').select('*').order('timestamp', { ascending: false }).limit(500)
    if (from) lq = lq.gte('timestamp', new Date(from + 'T00:00:00').toISOString())
    if (to) lq = lq.lte('timestamp', new Date(to + 'T23:59:59.999').toISOString())
    const [ur, cr, lr] = await Promise.all([
      supabase.from('users').select('*').order('name'),
      supabase.from('centres').select('*').order('centre_name'),
      lq
    ])
    setReportData({ users: ur.data||[], centres: cr.data||[], logs: lr.data||[] })
    setReportLoading(false)
  }
  function dlCSV(csv, fn) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = fn; a.click()
  }
  const exportUsers = () => dlCSV(['Name,Email,Badge,Role,Centre,Active,Created', ...reportData.users.map(u => [`"${u.name}"`, u.email, u.badge_number, u.role, u.centre, u.is_active?'Yes':'No', new Date(u.created_at).toLocaleDateString('en-IN')].join(','))].join('\n'), 'users_export.csv')
  const exportCentres = () => dlCSV(['Centre,Parent,Geo,Radius,Lat,Lng', ...reportData.centres.map(c => [c.centre_name, c.parent_centre||'', c.geo_enabled?'Y':'N', c.geo_radius||'', c.latitude||'', c.longitude||''].join(','))].join('\n'), 'centres_export.csv')
  const exportLogs = () => dlCSV(['Time,Badge,Action,Details', ...reportData.logs.map(l => [new Date(l.timestamp).toLocaleString('en-IN'), l.user_badge, l.action, `"${l.details||''}"`].join(','))].join('\n'), 'logs_export.csv')

  // ── Sewadars ──
  async function fetchSewadars() {
    setSewadarLoading(true)
    let q = supabase.from('sewadars').select('*').order('sewadar_name').limit(200)
    if (sewadarSearch.length >= 2) q = q.or(`sewadar_name.ilike.%${sewadarSearch}%,badge_number.ilike.%${sewadarSearch.toUpperCase()}%,department.ilike.%${sewadarSearch}%`)
    if (sewadarCentreFilter) q = q.eq('centre', sewadarCentreFilter)
    const { data } = await q; setSewadars(data || []); setSewadarLoading(false)
  }
  async function saveSewadar() {
    const clean = {}
    Object.entries(sewadarForm).forEach(([k,v]) => { clean[k] = v === '' ? null : v })
    if (clean.age !== undefined) clean.age = parseInt(clean.age) || null
    const { error } = await supabase.from('sewadars').update(clean).eq('id', editingSewadar)
    if (error) { showMsg('✗ ' + error.message); return }
    await logAction(profile, 'EDIT_SEWADAR', `Updated id=${editingSewadar} fields: ${Object.keys(clean).join(',')}`)
    showMsg('✓ Sewadar updated!'); setEditingSewadar(null); setSewadarForm({}); fetchSewadars()
  }
  async function deleteSewadar(s) {
    if (!confirm(`Delete ${s.sewadar_name} (${s.badge_number})?\n\nAttendance history is preserved.`)) return
    const { error, count } = await supabase.from('sewadars').delete({ count: 'exact' }).eq('id', s.id)
    if (error) { showMsg('✗ Delete failed: ' + error.message); return }
    if (count === 0) { showMsg('✗ Delete blocked by RLS — ensure area_secretary has DELETE on sewadars table'); return }
    await logAction(profile, 'DELETE_SEWADAR', `Deleted sewadar ${s.badge_number} ${s.sewadar_name}`)
    showMsg('✓ Sewadar deleted'); fetchSewadars()
  }
  async function createSewadar() {
    if (!newSewadar.sewadar_name || !newSewadar.badge_number) { showMsg('✗ Name and badge required'); return }
    setSaving(true)
    const { error } = await supabase.from('sewadars').insert({
      ...newSewadar,
      badge_number: newSewadar.badge_number.toUpperCase(),
      age: parseInt(newSewadar.age)||null
    })
    if (error) { showMsg('✗ ' + error.message); setSaving(false); return }
    await logAction(profile, 'CREATE_SEWADAR', `Created ${newSewadar.badge_number.toUpperCase()} ${newSewadar.sewadar_name}`)
    showMsg('✓ Sewadar created!')
    setShowAddSewadar(false)
    setNewSewadar({ sewadar_name:'', badge_number:'', centre: PARENT_CENTRES[0], department:'', gender:'Male', age:'', father_husband_name:'' })
    fetchSewadars(); setSaving(false)
  }

  // ── Attendance correction ──
  async function fetchAttendance() {
    setAttLoading(true)
    let q = supabase.from('attendance').select('*')
      .gte('scan_time', new Date(attDate + 'T00:00:00').toISOString())
      .lte('scan_time', new Date(attDate + 'T23:59:59.999').toISOString())
      .order('scan_time', { ascending: false }).limit(300)
    if (attSearch.length >= 2) q = q.or(`sewadar_name.ilike.%${attSearch}%,badge_number.ilike.%${attSearch.toUpperCase()}%`)
    const { data, error } = await q
    if (error) showMsg('✗ Failed to load: ' + error.message)
    setAttRecords(data || []); setAttLoading(false)
  }

  async function deleteAttRecord(r) {
    if (!confirm(`Delete ${r.type} record for ${r.badge_number} at ${new Date(r.scan_time).toLocaleTimeString('en-IN')}?\n\nThis cannot be undone.`)) return

    const { error, count } = await supabase
      .from('attendance')
      .delete({ count: 'exact' })
      .eq('id', r.id)

    if (error) {
      showMsg(`✗ Delete failed: ${error.message}`)
      console.error('deleteAttRecord error:', error)
      return
    }
    if (count === 0) {
      showMsg('✗ Delete was blocked. Check Supabase RLS: the "attendance" table needs a DELETE policy allowing area_secretary role. See fix instructions below.')
      return
    }

    await logAction(profile, 'DELETE_ATTENDANCE', `Deleted ${r.type} id=${r.id} badge=${r.badge_number}`)
    showMsg('✓ Record deleted')
    fetchAttendance()
  }

  async function saveAttEdit() {
    const updates = {}
    if (editAttTime) updates.scan_time = new Date(attDate + 'T' + editAttTime).toISOString()
    if (editAttType && editAttType !== editingAtt.type) updates.type = editAttType
    if (!Object.keys(updates).length) { setEditingAtt(null); return }
    const { error } = await supabase.from('attendance').update(updates).eq('id', editingAtt.id)
    if (error) { showMsg('✗ Update failed: ' + error.message); return }
    await logAction(profile, 'EDIT_ATTENDANCE', `Edited id=${editingAtt.id} badge=${editingAtt.badge_number}: ${JSON.stringify(updates)}`)
    showMsg('✓ Record updated'); setEditingAtt(null); fetchAttendance()
  }

  // ── Jatha Centres ──
  async function fetchJathaCentres() {
    setJathaCentresLoading(true)
    let q = supabase.from('jatha_centres').select('*').order('jatha_type').order('centre_name').order('department')
    if (jathaTypeFilter) q = q.eq('jatha_type', jathaTypeFilter)
    const { data } = await q; setJathaCentres(data || []); setJathaCentresLoading(false)
  }
  async function createJathaCentre() {
    if (!newJatha.centre_name.trim() || !newJatha.department.trim()) { showMsg('✗ Centre name and department are required'); return }
    setSaving(true)
    const { error } = await supabase.from('jatha_centres').insert({
      jatha_type: newJatha.jatha_type, centre_name: newJatha.centre_name.trim(),
      department: newJatha.department.trim(), is_active: true, created_at: new Date().toISOString()
    })
    if (error) { showMsg('✗ ' + error.message); setSaving(false); return }
    await logAction(profile, 'CREATE_JATHA_CENTRE', `Added ${newJatha.centre_name} (${newJatha.jatha_type})`)
    showMsg('✓ Jatha centre added!'); setShowAddJatha(false)
    setNewJatha({ jatha_type: JATHA_TYPE.MAJOR_CENTRE, centre_name:'', department:'', is_active: true })
    fetchJathaCentres(); setSaving(false)
  }
  async function saveJathaCentre(jc) {
    const { error } = await supabase.from('jatha_centres').update(editJathaForm).eq('id', jc.id)
    if (error) { showMsg('✗ ' + error.message); return }
    await logAction(profile, 'EDIT_JATHA_CENTRE', `Updated jatha_centre id=${jc.id}`)
    showMsg('✓ Updated!'); setEditingJatha(null); setEditJathaForm({}); fetchJathaCentres()
  }
  async function toggleJathaCentreActive(jc) {
    await supabase.from('jatha_centres').update({ is_active: !jc.is_active }).eq('id', jc.id)
    fetchJathaCentres()
  }
  async function deleteJathaCentre(jc) {
    if (!confirm(`Delete "${jc.centre_name} — ${jc.department}"? Existing jatha records are unaffected.`)) return
    const { error, count } = await supabase.from('jatha_centres').delete({ count: 'exact' }).eq('id', jc.id)
    if (error) { showMsg('✗ ' + error.message); return }
    if (count === 0) { showMsg('✗ Delete blocked by RLS'); return }
    await logAction(profile, 'DELETE_JATHA_CENTRE', `Deleted ${jc.centre_name}`)
    showMsg('✓ Deleted'); fetchJathaCentres()
  }

  // ── Render helpers ──
  const centreTree = PARENT_CENTRES.map(p => ({
    parent: p,
    children: centres.filter(c => c.parent_centre === p),
    config: centres.find(c => c.centre_name === p)
  }))
  const roleColor = { area_secretary: 'var(--gold)', centre_user: 'var(--blue)', sc_sp_user: 'var(--green)' }
  const roleName  = { area_secretary: 'AREA SECRETARY', centre_user: 'CENTRE USER', sc_sp_user: 'SC_SP USER' }

  const TAB_BTN = (key, label, Icon) => (
    <button key={key} onClick={() => setTab(key)}
      style={{
        display:'inline-flex', alignItems:'center', gap:5, padding:'0.55rem 0.9rem',
        borderRadius:'var(--radius)', fontFamily:'Inter,sans-serif', fontSize:'0.82rem',
        fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', transition:'all 0.15s',
        background: tab===key ? 'var(--excel-green)' : 'white',
        color: tab===key ? 'white' : 'var(--text-muted)',
        border: tab===key ? 'none' : '1.5px solid var(--border)'
      }}>
      <Icon size={13} /> {label}
    </button>
  )

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 960 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily:'Cinzel,serif', color:'var(--gold)', fontSize:'1.2rem' }}>Control Panel</h2>
        <p className="text-muted text-xs mt-1">Area Secretary · Write access only</p>
      </div>

      {message && (
        <div className={`super-admin-msg ${message.startsWith('✓') ? 'msg-success' : 'msg-error'}`}
          onClick={() => setMessage('')} style={{ cursor:'pointer', marginBottom:'1rem' }}>
          {message}
          {message.includes('RLS') && (
            <div style={{ marginTop:'0.5rem', fontSize:'0.78rem', opacity:0.9, lineHeight:1.5 }}>
              <strong>To fix in Supabase dashboard:</strong> Go to Authentication → Policies → find the table → add a policy:<br />
              <code style={{ background:'rgba(0,0,0,0.15)', padding:'2px 6px', borderRadius:3 }}>
                CREATE POLICY "area_secretary_delete" ON public.attendance FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id = auth.uid() AND role = 'area_secretary'));
              </code>
            </div>
          )}
          <span style={{ float:'right', opacity:0.5, marginLeft:'1rem' }}>✕ dismiss</span>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ overflowX:'auto', marginBottom:'1.25rem', paddingBottom:4 }}>
        <div style={{ display:'flex', gap:4, minWidth:'max-content' }}>
          {TAB_BTN('users',         'Users',       Users)}
          {TAB_BTN('sewadars',      'Sewadars',    Shield)}
          {TAB_BTN('centres',       'Centres',     Building2)}
          {TAB_BTN('jatha_centres', 'Jatha Centres', Plane)}
          {TAB_BTN('attendance',    'Correct Att', Pencil)}
          {TAB_BTN('reports',       'Reports',     FileSpreadsheet)}
        </div>
      </div>

      {/* ── USERS ── */}
      {tab === 'users' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
            <p className="text-muted text-xs">
              New users are created via a secure server-side Edge Function.
            </p>
            <button className="btn btn-gold" onClick={() => setShowAddUser(true)}>
              <UserPlus size={15} /> Add User
            </button>
          </div>
          {loading ? <div className="spinner" style={{ margin:'2rem auto' }} /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Badge</th><th>Role</th><th>Centre</th><th>Status</th><th>Active</th><th></th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight:500 }}>{u.name}</td>
                    <td style={{ fontFamily:'monospace', fontSize:'0.82rem', color:'var(--gold)' }}>{u.badge_number}</td>
                    <td><span className="badge" style={{ background:`${roleColor[u.role]}18`, color:roleColor[u.role], border:`1px solid ${roleColor[u.role]}30` }}>{roleName[u.role]}</span></td>
                    <td style={{ fontSize:'0.82rem' }}>{u.centre}</td>
                    <td><span className={`badge ${u.is_active ? 'badge-green' : 'badge-red'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td><button className="btn btn-ghost" style={{ padding:'0.25rem' }} onClick={() => toggleUserActive(u)}>
                      {u.is_active ? <ToggleRight size={22} color="var(--green)" /> : <ToggleLeft size={22} color="var(--text-muted)" />}
                    </button></td>
                    <td>
                      {u.role !== ROLES.AREA_SECRETARY && (
                        <button className="btn btn-ghost" style={{ padding:'0.25rem', color:'var(--red)' }} onClick={() => deleteUser(u)}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!users.length && !loading && <tr><td colSpan={7} style={{ textAlign:'center', color:'var(--text-muted)', padding:'2rem' }}>No users.</td></tr>}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {/* ── SEWADARS ── */}
      {tab === 'sewadars' && (
        <div>
          <div style={{ display:'flex', gap:'0.75rem', marginBottom:'0.75rem', flexWrap:'wrap', alignItems:'center' }}>
            <div className="search-box" style={{ flex:1, minWidth:200 }}>
              <Search size={15} />
              <input type="text" placeholder="Search name, badge or dept…" value={sewadarSearch} onChange={e => setSewadarSearch(e.target.value)} />
            </div>
            <select className="input" style={{ width:180 }} value={sewadarCentreFilter} onChange={e => setSewadarCentreFilter(e.target.value)}>
              <option value="">All Centres</option>
              {PARENT_CENTRES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn btn-gold" onClick={() => setShowAddSewadar(true)}><PlusCircle size={15} /> Add</button>
          </div>
          <p className="text-muted text-xs mb-2">{sewadars.length > 0 ? `${sewadars.length} results` : 'Type ≥2 chars or choose a centre to search'}</p>
          {sewadarLoading ? <div className="spinner" style={{ margin:'2rem auto' }} /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Badge</th><th>Centre</th><th>Dept</th><th>Gender</th><th>Age</th><th></th></tr></thead>
              <tbody>
                {sewadars.map(s => (
                  <tr key={s.id}>
                    {editingSewadar === s.id ? (
                      <>
                        <td><input className="input" style={{ padding:'0.3rem 0.5rem', fontSize:'0.82rem' }} value={sewadarForm.sewadar_name ?? s.sewadar_name} onChange={e => setSewadarForm(f => ({...f, sewadar_name: e.target.value}))} /></td>
                        <td><input className="input" style={{ padding:'0.3rem 0.5rem', fontSize:'0.82rem', fontFamily:'monospace', textTransform:'uppercase' }} value={sewadarForm.badge_number ?? s.badge_number} onChange={e => setSewadarForm(f => ({...f, badge_number: e.target.value.toUpperCase()}))} /></td>
                        <td><select className="input" style={{ padding:'0.3rem', fontSize:'0.82rem' }} value={sewadarForm.centre ?? s.centre} onChange={e => setSewadarForm(f => ({...f, centre: e.target.value}))}>{PARENT_CENTRES.map(c => <option key={c}>{c}</option>)}{centres.filter(c => c.parent_centre).map(c => <option key={c.centre_name}>{c.centre_name}</option>)}</select></td>
                        <td><input className="input" style={{ padding:'0.3rem 0.5rem', fontSize:'0.82rem' }} value={sewadarForm.department ?? (s.department??'')} onChange={e => setSewadarForm(f => ({...f, department: e.target.value}))} /></td>
                        <td><select className="input" style={{ padding:'0.3rem', fontSize:'0.82rem' }} value={sewadarForm.gender ?? s.gender} onChange={e => setSewadarForm(f => ({...f, gender: e.target.value}))}><option>Male</option><option>Female</option></select></td>
                        <td><input className="input" type="number" style={{ padding:'0.3rem', fontSize:'0.82rem', width:60 }} value={sewadarForm.age ?? (s.age??'')} onChange={e => setSewadarForm(f => ({...f, age: e.target.value}))} /></td>
                        <td style={{ display:'flex', gap:4 }}>
                          <button className="btn btn-ghost" style={{ color:'var(--green)', padding:'0.2rem' }} onClick={saveSewadar}><Check size={15} /></button>
                          <button className="btn btn-ghost" style={{ color:'var(--text-muted)', padding:'0.2rem' }} onClick={() => { setEditingSewadar(null); setSewadarForm({}) }}><X size={15} /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ fontWeight:500 }}>{s.sewadar_name}</td>
                        <td style={{ fontFamily:'monospace', fontSize:'0.82rem', color:'var(--gold)' }}>{s.badge_number}</td>
                        <td style={{ fontSize:'0.82rem' }}>{s.centre}</td>
                        <td style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>{s.department||'—'}</td>
                        <td style={{ fontSize:'0.82rem' }}>{s.gender||'—'}</td>
                        <td style={{ fontSize:'0.82rem' }}>{s.age||'—'}</td>
                        <td style={{ display:'flex', gap:4 }}>
                          <button className="btn btn-ghost" style={{ padding:'0.2rem', color:'var(--blue)' }} onClick={() => { setEditingSewadar(s.id); setSewadarForm({}) }}><Pencil size={14} /></button>
                          <button className="btn btn-ghost" style={{ padding:'0.2rem', color:'var(--red)' }} onClick={() => deleteSewadar(s)}><Trash2 size={14} /></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {!sewadars.length && !sewadarLoading && <tr><td colSpan={7} style={{ textAlign:'center', color:'var(--text-muted)', padding:'2rem' }}>No results.</td></tr>}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {/* ── CENTRES ── */}
      {tab === 'centres' && (
        <div>
          <p className="text-muted text-sm mb-3">Toggling geo on a parent cascades to all sub-centres.</p>
          {loading ? <div className="spinner" style={{ margin:'2rem auto' }} /> : (
            <div className="centres-tree">
              {centreTree.map(({ parent, children, config }) => (
                <div key={parent} className="centre-parent-block">
                  <div className="centre-parent-row">
                    <button className="centre-expand-btn" onClick={() => setExpandedParent(expandedParent === parent ? null : parent)}>
                      {expandedParent===parent ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                    </button>
                    <Building2 size={15} color="var(--gold)" />
                    <span className="centre-parent-name">{parent}</span>
                    {children.length > 0 && <span className="centre-child-count">{children.length} sub-centres</span>}
                    <div className="centre-parent-geo">
                      {config && (<>
                        <span className="centre-geo-label">Geo</span>
                        <button className="btn btn-ghost" style={{ padding:'0.15rem' }} onClick={() => updateCentreGeo(config.id, 'geo_enabled', !config.geo_enabled, parent)}>
                          {config.geo_enabled ? <ToggleRight size={22} color="var(--green)"/> : <ToggleLeft size={22} color="var(--text-muted)"/>}
                        </button>
                        {config.geo_enabled && <span className="badge badge-green" style={{ fontSize:'0.7rem' }}>ON</span>}
                      </>)}
                    </div>
                  </div>
                  {expandedParent===parent && config && (
                    <div className="centre-geo-config"><div className="centre-geo-fields">
                      <div className="geo-field"><label>Latitude</label><input defaultValue={config.latitude||''} placeholder="28.4595" onBlur={e => updateCentreGeo(config.id,'latitude',parseFloat(e.target.value)||null,null)}/></div>
                      <div className="geo-field"><label>Longitude</label><input defaultValue={config.longitude||''} placeholder="77.0266" onBlur={e => updateCentreGeo(config.id,'longitude',parseFloat(e.target.value)||null,null)}/></div>
                      <div className="geo-field"><label>Radius (m)</label><input defaultValue={config.geo_radius||200} onBlur={e => updateCentreGeo(config.id,'geo_radius',parseInt(e.target.value)||200,null)}/></div>
                    </div></div>
                  )}
                  {expandedParent===parent && children.map(child => (
                    <div key={child.id}>
                      <div className="centre-child-row">
                        <span className="centre-child-indent">└</span>
                        <button className="centre-expand-btn" style={{ marginLeft:2 }} onClick={() => setExpandedChild(expandedChild===child.id ? null : child.id)}>
                          {expandedChild===child.id ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                        </button>
                        <span className="centre-child-name">{child.centre_name}</span>
                        {(child.latitude||child.longitude) && <span className="centre-coords-pill">{child.latitude?.toFixed(4)}, {child.longitude?.toFixed(4)}</span>}
                        <div className="centre-parent-geo">
                          <span className="centre-geo-label">Geo</span>
                          <button className="btn btn-ghost" style={{ padding:'0.15rem' }} onClick={() => updateCentreGeo(child.id,'geo_enabled',!child.geo_enabled,null)}>
                            {child.geo_enabled ? <ToggleRight size={20} color="var(--green)"/> : <ToggleLeft size={20} color="var(--text-muted)"/>}
                          </button>
                        </div>
                      </div>
                      {expandedChild===child.id && (
                        <div className="centre-geo-config centre-child-geo-config"><div className="centre-geo-fields">
                          <div className="geo-field"><label>Latitude</label><input key={`lat-${child.id}`} defaultValue={child.latitude||''} onBlur={e => updateCentreGeo(child.id,'latitude',parseFloat(e.target.value)||null,null)}/></div>
                          <div className="geo-field"><label>Longitude</label><input key={`lng-${child.id}`} defaultValue={child.longitude||''} onBlur={e => updateCentreGeo(child.id,'longitude',parseFloat(e.target.value)||null,null)}/></div>
                          <div className="geo-field"><label>Radius (m)</label><input key={`rad-${child.id}`} defaultValue={child.geo_radius||200} onBlur={e => updateCentreGeo(child.id,'geo_radius',parseInt(e.target.value)||200,null)}/></div>
                        </div></div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── JATHA CENTRES ── */}
      {tab === 'jatha_centres' && (
        <div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.75rem', gap:'0.75rem', flexWrap:'wrap' }}>
            <div style={{ display:'flex', gap:'0.5rem' }}>
              {['', JATHA_TYPE.MAJOR_CENTRE, JATHA_TYPE.BEAS].map(t => (
                <button key={t} onClick={() => setJathaTypeFilter(t)}
                  style={{ padding:'0.35rem 0.85rem', borderRadius:'var(--radius)', fontSize:'0.8rem', fontWeight:600, cursor:'pointer', fontFamily:'Inter,sans-serif',
                    background: jathaTypeFilter===t ? 'var(--excel-green)' : 'var(--bg)',
                    color: jathaTypeFilter===t ? 'white' : 'var(--text-muted)',
                    border: jathaTypeFilter===t ? 'none' : '1.5px solid var(--border)' }}>
                  {t === '' ? 'All' : JATHA_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <button className="btn btn-gold" onClick={() => setShowAddJatha(true)}><PlusCircle size={15} /> Add Entry</button>
          </div>
          <p className="text-muted text-sm mb-2">These centre + department combos appear in the Jatha attendance form.</p>
          {jathaCentresLoading ? <div className="spinner" style={{ margin:'2rem auto' }} /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Type</th><th>Centre Name</th><th>Department</th><th>Active</th><th></th></tr></thead>
              <tbody>
                {jathaCentres.map(jc => (
                  <tr key={jc.id}>
                    {editingJatha === jc.id ? (
                      <>
                        <td>
                          <select className="input" style={{ padding:'0.3rem', fontSize:'0.82rem', width:130 }}
                            value={editJathaForm.jatha_type ?? jc.jatha_type}
                            onChange={e => setEditJathaForm(f => ({...f, jatha_type: e.target.value}))}>
                            <option value={JATHA_TYPE.MAJOR_CENTRE}>{JATHA_TYPE_LABEL[JATHA_TYPE.MAJOR_CENTRE]}</option>
                            <option value={JATHA_TYPE.BEAS}>{JATHA_TYPE_LABEL[JATHA_TYPE.BEAS]}</option>
                          </select>
                        </td>
                        <td><input className="input" style={{ padding:'0.3rem 0.5rem', fontSize:'0.82rem' }} value={editJathaForm.centre_name ?? jc.centre_name} onChange={e => setEditJathaForm(f => ({...f, centre_name: e.target.value}))} /></td>
                        <td><input className="input" style={{ padding:'0.3rem 0.5rem', fontSize:'0.82rem' }} value={editJathaForm.department ?? jc.department} onChange={e => setEditJathaForm(f => ({...f, department: e.target.value}))} /></td>
                        <td>—</td>
                        <td style={{ display:'flex', gap:4 }}>
                          <button className="btn btn-ghost" style={{ color:'var(--green)', padding:'0.2rem' }} onClick={() => saveJathaCentre(jc)}><Check size={15}/></button>
                          <button className="btn btn-ghost" style={{ color:'var(--text-muted)', padding:'0.2rem' }} onClick={() => { setEditingJatha(null); setEditJathaForm({}) }}><X size={15}/></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td><span className="badge" style={{ background:'var(--gold-bg)', color:'var(--gold)', border:'1px solid rgba(201,168,76,0.25)', fontSize:'0.78rem' }}>{JATHA_TYPE_LABEL[jc.jatha_type]||jc.jatha_type}</span></td>
                        <td style={{ fontWeight:500 }}>{jc.centre_name}</td>
                        <td style={{ fontSize:'0.82rem', color:'var(--text-secondary)' }}>{jc.department}</td>
                        <td><button className="btn btn-ghost" style={{ padding:'0.2rem' }} onClick={() => toggleJathaCentreActive(jc)}>
                          {jc.is_active ? <ToggleRight size={22} color="var(--green)"/> : <ToggleLeft size={22} color="var(--text-muted)"/>}
                        </button></td>
                        <td style={{ display:'flex', gap:4 }}>
                          <button className="btn btn-ghost" style={{ padding:'0.2rem', color:'var(--blue)' }} onClick={() => { setEditingJatha(jc.id); setEditJathaForm({}) }}><Pencil size={14}/></button>
                          <button className="btn btn-ghost" style={{ padding:'0.2rem', color:'var(--red)' }} onClick={() => deleteJathaCentre(jc)}><Trash2 size={14}/></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {!jathaCentres.length && !jathaCentresLoading && (
                  <tr><td colSpan={5} style={{ textAlign:'center', color:'var(--text-muted)', padding:'2rem' }}>No jatha centres configured. Add the first entry.</td></tr>
                )}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {/* ── ATTENDANCE CORRECTION ── */}
      {tab === 'attendance' && (
        <div>
          <div className="super-admin-note" style={{ marginBottom:'1rem' }}>
            Super Admin only. Edit scan time, change IN↔OUT, or delete records. All changes are permanently logged.
          </div>
          <div style={{ display:'flex', gap:'0.75rem', marginBottom:'1rem', flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', background:'white', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'0.4rem 0.75rem' }}>
              <Calendar size={14} color="var(--text-muted)"/>
              <input type="date" value={attDate} onChange={e => setAttDate(e.target.value)} style={{ border:'none', background:'none', color:'var(--text-primary)', fontSize:'0.875rem', outline:'none' }}/>
            </div>
            <div className="search-box" style={{ flex:1, minWidth:200 }}>
              <Search size={15}/>
              <input type="text" placeholder="Filter by name or badge…" value={attSearch} onChange={e => setAttSearch(e.target.value)}/>
            </div>
            <button className="btn btn-ghost" onClick={fetchAttendance} style={{ padding:'0.4rem 0.75rem' }}><RefreshCw size={14}/></button>
          </div>
          <p className="text-muted text-xs mb-2">{attRecords.length} records{attSearch ? ` matching "${attSearch}"` : ''} for {attDate}</p>
          {attLoading ? <div className="spinner" style={{ margin:'2rem auto' }}/> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Time</th><th>Type</th><th>Name</th><th>Badge</th><th>Centre</th><th>Scanned By</th><th></th></tr></thead>
              <tbody>
                {attRecords.map(r => (
                  <tr key={r.id} style={editingAtt?.id===r.id ? { background:'#fffbeb' } : {}}>
                    <td style={{ fontSize:'0.82rem', whiteSpace:'nowrap' }}>
                      {editingAtt?.id===r.id
                        ? <input type="time" value={editAttTime} onChange={e => setEditAttTime(e.target.value)} style={{ border:'1px solid var(--border)', borderRadius:4, padding:'0.2rem 0.4rem', fontSize:'0.82rem', background:'white', color:'var(--text-primary)' }}/>
                        : new Date(r.scan_time).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })}
                    </td>
                    <td>
                      {editingAtt?.id===r.id
                        ? <select value={editAttType} onChange={e => setEditAttType(e.target.value)} style={{ border:'1px solid var(--border)', borderRadius:4, padding:'0.2rem 0.4rem', fontSize:'0.82rem', background:'white', color:'var(--text-primary)' }}><option value="IN">IN</option><option value="OUT">OUT</option></select>
                        : <span className={`badge ${r.type==='IN' ? 'badge-green' : 'badge-red'}`}>{r.type}</span>}
                    </td>
                    <td style={{ fontWeight:500 }}>{r.sewadar_name}</td>
                    <td style={{ fontFamily:'monospace', fontSize:'0.82rem', color:'var(--gold)' }}>{r.badge_number}</td>
                    <td style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>{r.centre}</td>
                    <td style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{r.scanner_name||'—'}</td>
                    <td>
                      <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                        {editingAtt?.id===r.id ? (
                          <>
                            <button className="btn btn-ghost" style={{ color:'var(--green)', padding:'0.2rem' }} onClick={saveAttEdit}><Check size={14}/></button>
                            <button className="btn btn-ghost" style={{ color:'var(--text-muted)', padding:'0.2rem' }} onClick={() => setEditingAtt(null)}><X size={14}/></button>
                          </>
                        ) : (
                          <>
                            <button className="btn btn-ghost" style={{ color:'var(--blue)', padding:'0.2rem' }} title="Edit"
                              onClick={() => { setEditingAtt(r); setEditAttTime(new Date(r.scan_time).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})); setEditAttType(r.type) }}>
                              <Pencil size={13}/>
                            </button>
                            <button className="btn btn-ghost" style={{ color:'var(--red)', padding:'0.2rem' }} title="Delete"
                              onClick={() => deleteAttRecord(r)}>
                              <Trash2 size={13}/>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!attRecords.length && !attLoading && <tr><td colSpan={7} style={{ textAlign:'center', color:'var(--text-muted)', padding:'2rem' }}>No records for this date/filter.</td></tr>}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {/* ── REPORTS ── */}
      {tab === 'reports' && (
        <div>
          <div className="reports-header">
            <div className="date-filters">
              <div className="filter-item"><Calendar size={14}/><input type="date" value={dateRange.from} onChange={e => setDateRange({...dateRange, from:e.target.value})}/></div>
              <span style={{ color:'var(--text-muted)', fontSize:'0.82rem' }}>→</span>
              <div className="filter-item"><Calendar size={14}/><input type="date" value={dateRange.to} onChange={e => setDateRange({...dateRange, to:e.target.value})}/></div>
              <button className="btn-refresh" onClick={fetchReports}><RefreshCw size={14}/> Refresh</button>
            </div>
          </div>
          {reportLoading ? <div className="spinner" style={{ margin:'2rem auto' }}/> : (
            <div className="reports-grid">
              <div className="report-card"><div className="report-icon"><Users size={20}/></div><div className="report-info"><div className="report-count">{reportData.users.length}</div><div className="report-label">Users</div></div><button className="btn-download" onClick={exportUsers}><Download size={16}/></button></div>
              <div className="report-card"><div className="report-icon"><MapPin size={20}/></div><div className="report-info"><div className="report-count">{reportData.centres.length}</div><div className="report-label">Centres</div></div><button className="btn-download" onClick={exportCentres}><Download size={16}/></button></div>
              <div className="report-card"><div className="report-icon"><Shield size={20}/></div><div className="report-info"><div className="report-count">{reportData.logs.length}</div><div className="report-label">System Logs</div></div><button className="btn-download" onClick={exportLogs}><Download size={16}/></button></div>
            </div>
          )}
        </div>
      )}

      {/* ── ADD USER MODAL ── */}
      {showAddUser && (
        <div className="overlay" onClick={() => setShowAddUser(false)}>
          <div className="overlay-sheet" style={{ maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily:'Cinzel,serif', color:'var(--gold)', marginBottom:'0.5rem' }}>Add New User</h3>
            <p className="text-muted text-xs mb-3">Runs via a secure server-side function with the service role key.</p>
            <div className="mb-2"><label className="label">Full Name</label><input className="input" placeholder="Ravi Kumar" value={newUser.name} onChange={e => setNewUser({...newUser, name:e.target.value})}/></div>
            <div className="mb-2"><label className="label">Badge Number</label><input className="input" placeholder="FB5978GA0001" style={{ textTransform:'uppercase' }} value={newUser.badge_number} onChange={e => setNewUser({...newUser, badge_number:e.target.value})}/></div>
            <div className="mb-2"><label className="label">Email</label><input className="input" type="email" value={newUser.email} onChange={e => setNewUser({...newUser, email:e.target.value})}/></div>
            <div className="mb-2">
              <label className="label">Password</label>
              <div style={{ position:'relative' }}>
                <input className="input" type={showPw?'text':'password'} placeholder="Min 8 characters" value={newUser.password} onChange={e => setNewUser({...newUser, password:e.target.value})} style={{ paddingRight:'2.5rem' }}/>
                <button type="button" onClick={() => setShowPw(v => !v)} style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}>
                  {showPw ? <EyeOff size={16}/> : <Eye size={16}/>}
                </button>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginBottom:'1rem' }}>
              <div><label className="label">Role</label>
                <select className="input" value={newUser.role} onChange={e => setNewUser({...newUser, role:e.target.value})}>
                  <option value="area_secretary">AREA SECRETARY</option>
                  <option value="centre_user">CENTRE USER</option>
                  <option value="sc_sp_user">SC_SP USER</option>
                </select>
              </div>
              <div><label className="label">Centre</label>
                <select className="input" value={newUser.centre} onChange={e => setNewUser({...newUser, centre:e.target.value})}>
                  {PARENT_CENTRES.map(c => <option key={c} value={c}>{c}</option>)}
                  {centres.filter(c => c.parent_centre).map(c => <option key={c.centre_name} value={c.centre_name}>{c.centre_name}</option>)}
                </select>
              </div>
            </div>
            {newUser.role === ROLES.AREA_SECRETARY && (
              <div className="super-admin-note mb-2">Area Secretary has access to ALL centres and full system control.</div>
            )}
            {newUser.role === ROLES.CENTRE_USER && (
              <div className="super-admin-note mb-2">Centre User governs <strong>{newUser.centre}</strong> and all its sub-centres.</div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginTop:'1.5rem' }}>
              <button className="btn btn-outline btn-full" onClick={() => setShowAddUser(false)}>Cancel</button>
              <button className="btn btn-gold btn-full" onClick={createUser} disabled={saving}>
                {saving ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD SEWADAR MODAL ── */}
      {showAddSewadar && (
        <div className="overlay" onClick={() => setShowAddSewadar(false)}>
          <div className="overlay-sheet" style={{ maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily:'Cinzel,serif', color:'var(--gold)', marginBottom:'1.5rem' }}>Add New Sewadar</h3>
            <div className="mb-2"><label className="label">Full Name *</label><input className="input" placeholder="Ravi Kumar" value={newSewadar.sewadar_name} onChange={e => setNewSewadar({...newSewadar, sewadar_name:e.target.value})}/></div>
            <div className="mb-2"><label className="label">Badge Number *</label><input className="input" placeholder="FB5978GA0001" style={{ textTransform:'uppercase' }} value={newSewadar.badge_number} onChange={e => setNewSewadar({...newSewadar, badge_number:e.target.value})}/></div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginBottom:'1rem' }}>
              <div><label className="label">Centre</label><select className="input" value={newSewadar.centre} onChange={e => setNewSewadar({...newSewadar, centre:e.target.value})}>{PARENT_CENTRES.map(c => <option key={c}>{c}</option>)}{centres.filter(c => c.parent_centre).map(c => <option key={c.centre_name}>{c.centre_name}</option>)}</select></div>
              <div><label className="label">Department</label><input className="input" placeholder="e.g. Pathis" value={newSewadar.department} onChange={e => setNewSewadar({...newSewadar, department:e.target.value})}/></div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem', marginBottom:'1rem' }}>
              <div><label className="label">Gender</label><select className="input" value={newSewadar.gender} onChange={e => setNewSewadar({...newSewadar, gender:e.target.value})}><option>Male</option><option>Female</option></select></div>
              <div><label className="label">Age</label><input className="input" type="number" min="1" max="120" value={newSewadar.age} onChange={e => setNewSewadar({...newSewadar, age:e.target.value})}/></div>
              <div><label className="label">Father/Husband</label><input className="input" value={newSewadar.father_husband_name} onChange={e => setNewSewadar({...newSewadar, father_husband_name:e.target.value})}/></div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginTop:'1rem' }}>
              <button className="btn btn-outline btn-full" onClick={() => setShowAddSewadar(false)}>Cancel</button>
              <button className="btn btn-gold btn-full" onClick={createSewadar} disabled={saving}>{saving?'Creating…':'Create Sewadar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD JATHA CENTRE MODAL ── */}
      {showAddJatha && (
        <div className="overlay" onClick={() => setShowAddJatha(false)}>
          <div className="overlay-sheet" onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily:'Cinzel,serif', color:'var(--gold)', marginBottom:'1.5rem' }}>Add Jatha Centre Entry</h3>
            <div className="mb-2">
              <label className="label">Jatha Type</label>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem' }}>
                {[JATHA_TYPE.MAJOR_CENTRE, JATHA_TYPE.BEAS].map(t => (
                  <button key={t} onClick={() => setNewJatha({...newJatha, jatha_type:t})}
                    style={{ padding:'0.6rem', border:`2px solid ${newJatha.jatha_type===t ? 'var(--gold)' : 'var(--border)'}`, borderRadius:8, background: newJatha.jatha_type===t ? 'var(--gold-bg)' : 'var(--bg)', color: newJatha.jatha_type===t ? 'var(--gold)' : 'var(--text-secondary)', fontWeight:700, fontSize:'0.85rem', cursor:'pointer', fontFamily:'Inter,sans-serif' }}>
                    {JATHA_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-2"><label className="label">Centre Name *</label><input className="input" placeholder={newJatha.jatha_type === JATHA_TYPE.BEAS ? 'Beas' : 'e.g. Delhi'} value={newJatha.centre_name} onChange={e => setNewJatha({...newJatha, centre_name:e.target.value})}/></div>
            <div className="mb-2"><label className="label">Department *</label><input className="input" placeholder="e.g. Langar Sewa" value={newJatha.department} onChange={e => setNewJatha({...newJatha, department:e.target.value})}/></div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginTop:'1.25rem' }}>
              <button className="btn btn-outline btn-full" onClick={() => setShowAddJatha(false)}>Cancel</button>
              <button className="btn btn-gold btn-full" onClick={createJathaCentre} disabled={saving}>{saving?'Adding…':'Add Entry'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}