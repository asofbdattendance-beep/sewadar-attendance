import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES } from '../lib/supabase'
import {
  UserPlus, Trash2, Shield, MapPin, ToggleLeft, ToggleRight,
  RefreshCw, Download, FileSpreadsheet, Calendar, Filter,
  ChevronDown, ChevronRight, Users, Building2, Search, Edit2, Check, X, Clock, CalendarDays, Plus, Save
} from 'lucide-react'

const PARENT_CENTRES = [
  'ANKHEER','BALLABGARH','DLF CITY GURGAON','FIROZPUR JHIRKA',
  'TAORU','GURGAON','MOHANA','ZAIBABAD KHERLI','NANGLA GUJRAN',
  'NIT - 2','PALWAL','BAROLI','HODAL','RAJENDRA PARK',
  'SECTOR-15-A','PRITHLA','SURAJ KUND','TIGAON'
]

export default function SuperAdminPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('sewadars')
  const [sewadars, setSewadars] = useState([])
  const [centres, setCentres] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  const [showAddSewadar, setShowAddSewadar] = useState(false)
  const [newSewadar, setNewSewadar] = useState({
    badge_number: '', sewadar_name: '', father_husband_name: '', gender: 'Male',
    centre: PARENT_CENTRES[0], department: '', age: null, geo_required: false
  })

  const [showAddSession, setShowAddSession] = useState(false)
  const [newSession, setNewSession] = useState({ name: '', session_date: new Date().toISOString().split('T')[0] })

  const [correctDate, setCorrectDate] = useState(new Date().toISOString().split('T')[0])
  const [correctRecords, setCorrectRecords] = useState([])
  const [editingRecord, setEditingRecord] = useState(null)
  const [editTime, setEditTime] = useState('')

  if (profile?.role !== ROLES.SUPER_ADMIN) {
    return (
      <div className="page text-center mt-3">
        <div className="empty-state">
          <div className="empty-icon"><Shield size={28} /></div>
          <div className="empty-text">Access denied</div>
        </div>
      </div>
    )
  }

  useEffect(() => {
    if (tab === 'sewadars') fetchSewadars()
    if (tab === 'centres') fetchCentres()
    if (tab === 'sessions') fetchSessions()
    if (tab === 'correct') fetchCorrectAttendance()
  }, [tab, searchTerm, correctDate])

  async function fetchSewadars() {
    setLoading(true)
    let query = supabase.from('sewadars').select('*').order('sewadar_name')
    if (searchTerm) {
      query = query.or(`sewadar_name.ilike.%${searchTerm}%,badge_number.ilike.%${searchTerm.toUpperCase()}%`)
    }
    const { data } = await query
    setSewadars(data || [])
    setLoading(false)
  }

  async function fetchCentres() {
    setLoading(true)
    const { data } = await supabase.from('centres').select('*').order('centre_name')
    setCentres(data || [])
    setLoading(false)
  }

  async function fetchSessions() {
    setLoading(true)
    const { data } = await supabase.from('sessions').select('*').order('session_date', { ascending: false })
    setSessions(data || [])
    setLoading(false)
  }

  async function fetchCorrectAttendance() {
    setLoading(true)
    const start = new Date(correctDate)
    start.setHours(0, 0, 0, 0)
    const end = new Date(correctDate)
    end.setHours(23, 59, 59, 999)

    const { data } = await supabase
      .from('attendance')
      .select('*')
      .gte('scan_time', start.toISOString())
      .lte('scan_time', end.toISOString())
      .order('scan_time', { ascending: false })

    setCorrectRecords(data || [])
    setLoading(false)
  }

  async function addSewadar() {
    const { error } = await supabase.from('sewadars').insert({
      ...newSewadar,
      badge_number: newSewadar.badge_number.toUpperCase(),
      geo_required: newSewadar.geo_required || false
    })
    if (!error) {
      await supabase.from('logs').insert({
        user_badge: profile.badge_number,
        action: 'ADD_SEWADAR',
        details: `Added sewadar ${newSewadar.badge_number}`,
        timestamp: new Date().toISOString()
      })
      setShowAddSewadar(false)
      setNewSewadar({ badge_number: '', sewadar_name: '', father_husband_name: '', gender: 'Male', centre: PARENT_CENTRES[0], department: '', age: null, geo_required: false })
      fetchSewadars()
    }
  }

  async function updateSewadar(id, field, value) {
    await supabase.from('sewadars').update({ [field]: value }).eq('id', id)
  }

  async function deleteSewadar(id, badge) {
    if (!confirm(`Delete sewadar ${badge}?`)) return
    await supabase.from('sewadars').delete().eq('id', id)
    await supabase.from('logs').insert({
      user_badge: profile.badge_number,
      action: 'DELETE_SEWADAR',
      details: `Deleted sewadar ${badge}`,
      timestamp: new Date().toISOString()
    })
    fetchSewadars()
  }

  async function addSession() {
    const { error } = await supabase.from('sessions').insert({
      name: newSession.name,
      session_date: newSession.session_date,
      created_by: profile.badge_number
    })
    if (!error) {
      await supabase.from('logs').insert({
        user_badge: profile.badge_number,
        action: 'CREATE_SESSION',
        details: `Created session ${newSession.name}`,
        timestamp: new Date().toISOString()
      })
      setShowAddSession(false)
      setNewSession({ name: '', session_date: new Date().toISOString().split('T')[0] })
      fetchSessions()
    }
  }

  async function toggleSession(id, current) {
    await supabase.from('sessions').update({ is_active: !current }).eq('id', id)
    await supabase.from('logs').insert({
      user_badge: profile.badge_number,
      action: 'TOGGLE_SESSION',
      details: `Set session active=${!current}`,
      timestamp: new Date().toISOString()
    })
    fetchSessions()
  }

  async function deleteSession(id, name) {
    if (!confirm(`Delete session "${name}"?`)) return
    await supabase.from('sessions').delete().eq('id', id)
    await supabase.from('logs').insert({
      user_badge: profile.badge_number,
      action: 'DELETE_SESSION',
      details: `Deleted session ${name}`,
      timestamp: new Date().toISOString()
    })
    fetchSessions()
  }

  async function saveEditTime(record) {
    if (!editTime) return
    const newTime = new Date(`${correctDate}T${editTime}`).toISOString()
    await supabase.from('attendance').update({ scan_time: newTime }).eq('id', record.id)
    await supabase.from('logs').insert({
      user_badge: profile.badge_number,
      action: 'CORRECT_ATTENDANCE',
      details: `Changed time for ${record.badge_number} (${record.type}) to ${editTime}`,
      timestamp: new Date().toISOString()
    })
    setEditingRecord(null)
    setEditTime('')
    fetchCorrectAttendance()
  }

  async function deleteAttendanceRecord(id, badge, type) {
    if (!confirm(`Delete ${type} record for ${badge}?`)) return
    await supabase.from('attendance').delete().eq('id', id)
    await supabase.from('logs').insert({
      user_badge: profile.badge_number,
      action: 'DELETE_ATTENDANCE',
      details: `Deleted ${type} record for ${badge}`,
      timestamp: new Date().toISOString()
    })
    fetchCorrectAttendance()
  }

  function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
  }

  function exportSewadars() {
    const csv = [
      ['Badge', 'Name', 'Father/Husband', 'Gender', 'Centre', 'Dept', 'Age', 'Geo Required'].join(','),
      ...sewadars.map(s => [
        s.badge_number, `"${s.sewadar_name}"`, `"${s.father_husband_name || ''}"`, s.gender,
        s.centre, s.department || '', s.age || '', s.geo_required ? 'Yes' : 'No'
      ].join(','))
    ].join('\n')
    downloadCSV(csv, 'sewadars_export.csv')
  }

  function exportAttendance() {
    const csv = [
      ['Time', 'Badge', 'Name', 'Type', 'Scanner', 'Session'].join(','),
      ...correctRecords.map(r => [
        new Date(r.scan_time).toLocaleString('en-IN'),
        r.badge_number, `"${r.sewadar_name}"`, r.type, r.scanner_name, r.session_id || ''
      ].join(','))
    ].join('\n')
    downloadCSV(csv, `attendance_${correctDate}.csv`)
  }

  const tabs = [
    { key: 'sewadars', label: 'Sewadars', Icon: Users },
    { key: 'sessions', label: 'Sessions', Icon: CalendarDays },
    { key: 'correct', label: 'Attendance', Icon: Edit2 },
    { key: 'centres', label: 'Centres', Icon: MapPin },
    { key: 'reports', label: 'Reports', Icon: FileSpreadsheet },
  ]

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 1000 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--gold)', fontSize: '1.4rem', fontWeight: 800 }}>
          Control Panel
        </h2>
        <p className="text-muted text-xs mt-1">Super Admin Dashboard</p>
      </div>

      <div className="tab-nav">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`tab-btn ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'sewadars' && (
        <SewadarsTab 
          sewadars={sewadars} 
          loading={loading} 
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          onRefresh={fetchSewadars}
          onAdd={() => setShowAddSewadar(true)}
          onExport={exportSewadars}
          onUpdate={updateSewadar}
          onDelete={deleteSewadar}
        />
      )}

      {tab === 'sessions' && (
        <SessionsTab 
          sessions={sessions}
          loading={loading}
          onRefresh={fetchSessions}
          onAdd={() => setShowAddSession(true)}
          onToggle={toggleSession}
          onDelete={deleteSession}
        />
      )}

      {tab === 'correct' && (
        <CorrectAttendanceTab 
          records={correctRecords}
          loading={loading}
          date={correctDate}
          setDate={setCorrectDate}
          onRefresh={fetchCorrectAttendance}
          onExport={exportAttendance}
          editingRecord={editingRecord}
          setEditingRecord={setEditingRecord}
          editTime={editTime}
          setEditTime={setEditTime}
          onSaveTime={saveEditTime}
          onDelete={deleteAttendanceRecord}
        />
      )}

      {tab === 'centres' && (
        <CentresTab 
          centres={centres}
          loading={loading}
          onRefresh={fetchCentres}
          profile={profile}
        />
      )}

      {tab === 'reports' && (
        <ReportsTab 
          sewadarsCount={sewadars.length}
          sessionsCount={sessions.length}
          onExportSewadars={exportSewadars}
        />
      )}

      {showAddSewadar && (
        <AddSewadarModal 
          newSewadar={newSewadar}
          setNewSewadar={setNewSewadar}
          onClose={() => setShowAddSewadar(false)}
          onSave={addSewadar}
        />
      )}

      {showAddSession && (
        <AddSessionModal 
          newSession={newSession}
          setNewSession={setNewSession}
          onClose={() => setShowAddSession(false)}
          onSave={addSession}
        />
      )}
    </div>
  )
}

function SewadarsTab({ sewadars, loading, searchTerm, setSearchTerm, onRefresh, onAdd, onExport, onUpdate, onDelete }) {
  return (
    <div className="animate-fade-in">
      <div className="flex justify-between items-center mb-3">
        <div className="search-box" style={{ maxWidth: 320 }}>
          <Search size={17} />
          <input
            type="text"
            placeholder="Search sewadars..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button className="btn btn-outline" onClick={onExport}>
            <Download size={16} /> Export
          </button>
          <button className="btn btn-gold" onClick={onAdd}>
            <Plus size={16} /> Add
          </button>
        </div>
      </div>

      {loading ? (
        <div className="spinner" style={{ margin: '3rem auto' }} />
      ) : sewadars.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Users size={28} /></div>
          <div className="empty-text">No sewadars found</div>
          <div className="empty-hint">Add your first sewadar to get started</div>
        </div>
      ) : (
        <div className="sewadars-list stagger-children">
          {sewadars.map(s => (
            <div key={s.id} className="sewadar-row">
              <span className="sewadar-badge">{s.badge_number}</span>
              <div className="sewadar-name">
                <input
                  defaultValue={s.sewadar_name}
                  onBlur={e => onUpdate(s.id, 'sewadar_name', e.target.value)}
                />
              </div>
              <div className="sewadar-centre">
                <select
                  defaultValue={s.centre}
                  onChange={e => onUpdate(s.id, 'centre', e.target.value)}
                >
                  {PARENT_CENTRES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="sewadar-dept">
                <input
                  defaultValue={s.department || ''}
                  placeholder="Dept"
                  onBlur={e => onUpdate(s.id, 'department', e.target.value)}
                />
              </div>
              <div className="sewadar-geo">
                <button
                  className="btn-icon"
                  onClick={() => onUpdate(s.id, 'geo_required', !s.geo_required)}
                  title={s.geo_required ? 'Geo required' : 'Geo not required'}
                >
                  {s.geo_required 
                    ? <ToggleRight size={20} color="var(--green)" />
                    : <ToggleLeft size={20} color="var(--text-muted)" />
                  }
                </button>
              </div>
              <div className="sewadar-actions">
                <button
                  className="btn-icon danger"
                  onClick={() => onDelete(s.id, s.badge_number)}
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SessionsTab({ sessions, loading, onRefresh, onAdd, onToggle, onDelete }) {
  return (
    <div className="animate-fade-in">
      <div className="flex justify-between items-center mb-3">
        <p className="text-muted text-sm">Manage attendance sessions</p>
        <button className="btn btn-gold" onClick={onAdd}>
          <Plus size={16} /> New Session
        </button>
      </div>

      {loading ? (
        <div className="spinner" style={{ margin: '3rem auto' }} />
      ) : sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><CalendarDays size={28} /></div>
          <div className="empty-text">No sessions created</div>
          <div className="empty-hint">Create a session to start tracking attendance</div>
        </div>
      ) : (
        <div className="sessions-list stagger-children">
          {sessions.map(s => (
            <div key={s.id} className="session-row">
              <span className={`session-status ${s.is_active ? 'active' : 'inactive'}`}>
                {s.is_active ? 'Active' : 'Inactive'}
              </span>
              <span className="session-name">{s.name}</span>
              <span className="session-date">
                {new Date(s.session_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
              <button
                className="btn-icon"
                onClick={() => onToggle(s.id, s.is_active)}
                title={s.is_active ? 'Deactivate' : 'Activate'}
              >
                {s.is_active 
                  ? <ToggleRight size={20} color="var(--green)" />
                  : <ToggleLeft size={20} color="var(--text-muted)" />
                }
              </button>
              <button
                className="btn-icon danger"
                onClick={() => onDelete(s.id, s.name)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CorrectAttendanceTab({ records, loading, date, setDate, onRefresh, onExport, editingRecord, setEditingRecord, editTime, setEditTime, onSaveTime, onDelete }) {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <div className="filter-group">
          <Calendar size={16} />
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>
        <button className="btn btn-outline" onClick={onExport}>
          <Download size={16} /> Export
        </button>
      </div>

      {loading ? (
        <div className="spinner" style={{ margin: '3rem auto' }} />
      ) : records.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Edit2 size={28} /></div>
          <div className="empty-text">No records for this date</div>
        </div>
      ) : (
        <div className="attendance-list stagger-children">
          {records.map(r => (
            <div key={r.id} className="attendance-row">
              {editingRecord?.id === r.id ? (
                <input
                  type="time"
                  value={editTime}
                  onChange={e => setEditTime(e.target.value)}
                  onBlur={() => onSaveTime(r)}
                  onKeyDown={e => e.key === 'Enter' && onSaveTime(r)}
                  autoFocus
                  className="attendance-time"
                />
              ) : (
                <span 
                  className="attendance-time editable"
                  onClick={() => {
                    setEditingRecord(r)
                    const time = new Date(r.scan_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
                    setEditTime(time)
                  }}
                >
                  {new Date(r.scan_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <span className="attendance-badge">{r.badge_number}</span>
              <span className="attendance-name">{r.sewadar_name}</span>
              <span className={`attendance-type badge ${r.type === 'IN' ? 'badge-green' : 'badge-red'}`}>
                {r.type}
              </span>
              <span className="text-muted text-sm" style={{ minWidth: 100 }}>{r.scanner_name}</span>
              <button
                className="btn-icon danger"
                onClick={() => onDelete(r.id, r.badge_number, r.type)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CentresTab({ centres, loading, onRefresh, profile }) {
  const [expandedParents, setExpandedParents] = useState([])
  const [showAddCentre, setShowAddCentre] = useState(false)
  const [newCentre, setNewCentre] = useState({ centre_name: '', latitude: '', longitude: '', geo_radius: 200, geo_enabled: false, parent_centre: '' })
  const [saving, setSaving] = useState(false)
  const [editingChild, setEditingChild] = useState(null)
  const [childData, setChildData] = useState({})

  const parentCentres = centres.filter(c => !c.parent_centre)
  const childCentresMap = centres.reduce((acc, c) => {
    if (c.parent_centre) {
      if (!acc[c.parent_centre]) acc[c.parent_centre] = []
      acc[c.parent_centre].push(c)
    }
    return acc
  }, {})

  const toggleParent = (name) => {
    setExpandedParents(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
  }

  const toggleGeo = async (centre, current) => {
    setSaving(true)
    await supabase.from('centres').update({ geo_enabled: !current }).eq('id', centre.id)
    await supabase.from('logs').insert({
      user_badge: profile.badge_number,
      action: 'TOGGLE_GEO',
      details: `Geo ${!current ? 'enabled' : 'disabled'} for ${centre.centre_name}`,
      timestamp: new Date().toISOString()
    })
    onRefresh()
    setSaving(false)
  }

  const updateCentreField = async (centreId, field, value) => {
    setSaving(true)
    await supabase.from('centres').update({ [field]: value }).eq('id', centreId)
    onRefresh()
    setSaving(false)
  }

  const saveCentre = async () => {
    if (!newCentre.centre_name.trim()) return
    setSaving(true)
    const payload = {
      centre_name: newCentre.centre_name.toUpperCase(),
      latitude: newCentre.latitude ? parseFloat(newCentre.latitude) : null,
      longitude: newCentre.longitude ? parseFloat(newCentre.longitude) : null,
      geo_radius: newCentre.geo_radius || 200,
      geo_enabled: newCentre.geo_enabled,
      parent_centre: newCentre.parent_centre || null
    }
    await supabase.from('centres').insert(payload)
    await supabase.from('logs').insert({
      user_badge: profile.badge_number,
      action: 'ADD_CENTRE',
      details: `Added centre ${payload.centre_name}`,
      timestamp: new Date().toISOString()
    })
    setShowAddCentre(false)
    setNewCentre({ centre_name: '', latitude: '', longitude: '', geo_radius: 200, geo_enabled: false, parent_centre: '' })
    onRefresh()
    setSaving(false)
  }

  const saveChildEdit = async (childId) => {
    const data = childData[childId]
    if (!data) return
    setSaving(true)
    await supabase.from('centres').update({
      latitude: data.latitude ? parseFloat(data.latitude) : null,
      longitude: data.longitude ? parseFloat(data.longitude) : null,
      geo_radius: data.geo_radius || 200,
      geo_enabled: data.geo_enabled
    }).eq('id', childId)
    setEditingChild(null)
    setChildData({})
    onRefresh()
    setSaving(false)
  }

  if (loading) {
    return <div className="spinner" style={{ margin: '3rem auto' }} />
  }

  return (
    <div className="animate-fade-in">
      <div className="flex justify-between items-center mb-3">
        <p className="text-muted text-sm">Manage centres, GPS coordinates & geo-fencing</p>
        <button className="btn btn-gold" onClick={() => setShowAddCentre(true)}>
          <Plus size={16} /> Add Centre
        </button>
      </div>

      {centres.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><MapPin size={28} /></div>
          <div className="empty-text">No centres configured</div>
        </div>
      ) : (
        <div className="centres-list stagger-children">
          {parentCentres.map(parent => {
            const children = childCentresMap[parent.centre_name] || []
            const isExpanded = expandedParents.includes(parent.centre_name)
            
            return (
              <div key={parent.id} className="centre-parent-card">
                <div className="centre-parent-header" onClick={() => toggleParent(parent.centre_name)}>
                  <div className="centre-parent-info">
                    <span className="centre-name">{parent.centre_name}</span>
                    {children.length > 0 && (
                      <span className="centre-child-badge">{children.length} sub-centres</span>
                    )}
                  </div>
                  <div className="centre-parent-actions">
                    <button
                      className={`geo-toggle ${parent.geo_enabled ? 'enabled' : ''}`}
                      onClick={(e) => { e.stopPropagation(); toggleGeo(parent, parent.geo_enabled) }}
                      disabled={saving}
                    >
                      {parent.geo_enabled ? <><span className="toggle-dot" /> GPS ON</> : 'GPS OFF'}
                    </button>
                    <ChevronDown size={20} className={`expand-icon ${isExpanded ? 'rotated' : ''}`} />
                  </div>
                </div>
                
                {isExpanded && (
                  <div className="centre-parent-details">
                    <div className="geo-fields">
                      <div className="geo-field">
                        <label>Latitude</label>
                        <input
                          type="number"
                          step="any"
                          placeholder="28.xxxx"
                          value={parent.latitude || ''}
                          onChange={(e) => updateCentreField(parent.id, 'latitude', parseFloat(e.target.value) || null)}
                          disabled={saving}
                        />
                      </div>
                      <div className="geo-field">
                        <label>Longitude</label>
                        <input
                          type="number"
                          step="any"
                          placeholder="77.xxxx"
                          value={parent.longitude || ''}
                          onChange={(e) => updateCentreField(parent.id, 'longitude', parseFloat(e.target.value) || null)}
                          disabled={saving}
                        />
                      </div>
                      <div className="geo-field">
                        <label>Radius (m)</label>
                        <input
                          type="number"
                          value={parent.geo_radius || 200}
                          onChange={(e) => updateCentreField(parent.id, 'geo_radius', parseInt(e.target.value) || 200)}
                          disabled={saving}
                        />
                      </div>
                    </div>
                    
                    {children.length > 0 && (
                      <div className="children-list">
                        <div className="children-header">Sub-centres</div>
                        {children.map(child => (
                          <div key={child.id} className="child-centre-row">
                            {editingChild === child.id ? (
                              <>
                                <input
                                  className="input"
                                  style={{ width: '80px', padding: '6px 8px', fontSize: '0.8rem' }}
                                  placeholder="Lat"
                                  value={childData[child.id]?.latitude ?? child.latitude ?? ''}
                                  onChange={e => setChildData({ ...childData, [child.id]: { ...childData[child.id], latitude: e.target.value } })}
                                />
                                <input
                                  className="input"
                                  style={{ width: '80px', padding: '6px 8px', fontSize: '0.8rem' }}
                                  placeholder="Lng"
                                  value={childData[child.id]?.longitude ?? child.longitude ?? ''}
                                  onChange={e => setChildData({ ...childData, [child.id]: { ...childData[child.id], longitude: e.target.value } })}
                                />
                                <input
                                  className="input"
                                  style={{ width: '60px', padding: '6px 8px', fontSize: '0.8rem' }}
                                  placeholder="R"
                                  value={childData[child.id]?.geo_radius ?? child.geo_radius ?? ''}
                                  onChange={e => setChildData({ ...childData, [child.id]: { ...childData[child.id], geo_radius: e.target.value } })}
                                />
                                <button className="btn btn-sm btn-primary" onClick={() => saveChildEdit(child.id)} disabled={saving}>
                                  <Save size={14} />
                                </button>
                                <button className="btn btn-sm btn-outline" onClick={() => { setEditingChild(null); setChildData({}) }}>
                                  <X size={14} />
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="child-name" style={{ flex: 1 }}>{child.centre_name}</span>
                                <span className="child-geo" style={{ fontSize: '0.7rem' }}>
                                  {child.latitude?.toFixed(4) || '—'}, {child.longitude?.toFixed(4) || '—'}
                                </span>
                                <span className={`child-geo ${child.geo_enabled ? 'geo-on' : ''}`}>
                                  {child.geo_enabled ? 'ON' : 'OFF'}
                                </span>
                                <button className="btn-icon" onClick={() => setEditingChild(child.id)}>
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  className="btn-icon"
                                  onClick={() => toggleGeo(child, child.geo_enabled)}
                                  disabled={saving}
                                >
                                  {child.geo_enabled 
                                    ? <ToggleRight size={18} color="var(--green)" />
                                    : <ToggleLeft size={18} color="var(--text-muted)" />
                                  }
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          
          {parentCentres.length === 0 && centres.map(centre => (
            <div key={centre.id} className="centre-parent-card">
              <div className="centre-parent-header">
                <div className="centre-parent-info">
                  <span className="centre-name">{centre.centre_name}</span>
                </div>
                <div className="centre-parent-actions">
                  <button
                    className={`geo-toggle ${centre.geo_enabled ? 'enabled' : ''}`}
                    onClick={() => toggleGeo(centre, centre.geo_enabled)}
                    disabled={saving}
                  >
                    {centre.geo_enabled ? 'GPS ON' : 'GPS OFF'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddCentre && (
        <div className="overlay" onClick={() => setShowAddCentre(false)}>
          <div className="overlay-sheet" onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--gold)', marginBottom: '1.5rem', fontWeight: 700 }}>Add Centre</h3>
            
            <div className="mb-3">
              <label className="label">Centre Name</label>
              <input
                className="input"
                placeholder="e.g. NEW CENTRE"
                value={newCentre.centre_name}
                onChange={e => setNewCentre({ ...newCentre, centre_name: e.target.value })}
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="mb-3">
              <label className="label">Parent Centre (optional)</label>
              <select
                className="input"
                value={newCentre.parent_centre}
                onChange={e => setNewCentre({ ...newCentre, parent_centre: e.target.value })}
              >
                <option value="">None (Top-level)</option>
                {parentCentres.map(p => (
                  <option key={p.id} value={p.centre_name}>{p.centre_name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="mb-3">
                <label className="label">Latitude</label>
                <input className="input" type="number" step="any" placeholder="28.xxxx" value={newCentre.latitude} onChange={e => setNewCentre({ ...newCentre, latitude: e.target.value })} />
              </div>
              <div className="mb-3">
                <label className="label">Longitude</label>
                <input className="input" type="number" step="any" placeholder="77.xxxx" value={newCentre.longitude} onChange={e => setNewCentre({ ...newCentre, longitude: e.target.value })} />
              </div>
            </div>

            <div className="mb-3">
              <label className="label">Geo Radius (meters)</label>
              <input className="input" type="number" value={newCentre.geo_radius} onChange={e => setNewCentre({ ...newCentre, geo_radius: parseInt(e.target.value) || 200 })} />
            </div>

            <div className="mb-4">
              <label className="checkbox-label">
                <input type="checkbox" checked={newCentre.geo_enabled} onChange={e => setNewCentre({ ...newCentre, geo_enabled: e.target.checked })} />
                <span>Enable geo-fencing</span>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <button className="btn btn-outline" onClick={() => setShowAddCentre(false)}>Cancel</button>
              <button className="btn btn-gold" onClick={saveCentre} disabled={saving || !newCentre.centre_name.trim()}>
                {saving ? 'Saving...' : 'Add Centre'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ReportsTab({ sewadarsCount, sessionsCount, onExportSewadars }) {
  return (
    <div className="animate-fade-in">
      <div className="reports-grid stagger-children">
        <div className="report-card">
          <div className="report-icon"><Users size={22} /></div>
          <div className="report-info">
            <div className="report-count">{sewadarsCount}</div>
            <div className="report-label">Total Sewadars</div>
          </div>
          <button className="btn-download" onClick={onExportSewadars}><Download size={18} /></button>
        </div>
        <div className="report-card">
          <div className="report-icon" style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}><CalendarDays size={22} /></div>
          <div className="report-info">
            <div className="report-count">{sessionsCount}</div>
            <div className="report-label">Sessions</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AddSewadarModal({ newSewadar, setNewSewadar, onClose, onSave }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-sheet" onClick={e => e.stopPropagation()}>
        <h3 style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--gold)', marginBottom: '1.5rem', fontWeight: 700 }}>Add New Sewadar</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="mb-2">
            <label className="label">Badge Number</label>
            <input className="input" value={newSewadar.badge_number} onChange={e => setNewSewadar({ ...newSewadar, badge_number: e.target.value })} style={{ textTransform: 'uppercase' }} />
          </div>
          <div className="mb-2">
            <label className="label">Name</label>
            <input className="input" value={newSewadar.sewadar_name} onChange={e => setNewSewadar({ ...newSewadar, sewadar_name: e.target.value })} />
          </div>
          <div className="mb-2">
            <label className="label">Father/Husband</label>
            <input className="input" value={newSewadar.father_husband_name} onChange={e => setNewSewadar({ ...newSewadar, father_husband_name: e.target.value })} />
          </div>
          <div className="mb-2">
            <label className="label">Gender</label>
            <select className="input" value={newSewadar.gender} onChange={e => setNewSewadar({ ...newSewadar, gender: e.target.value })}>
              <option>Male</option>
              <option>Female</option>
            </select>
          </div>
          <div className="mb-2">
            <label className="label">Centre</label>
            <select className="input" value={newSewadar.centre} onChange={e => setNewSewadar({ ...newSewadar, centre: e.target.value })}>
              {PARENT_CENTRES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="mb-2">
            <label className="label">Department</label>
            <input className="input" value={newSewadar.department} onChange={e => setNewSewadar({ ...newSewadar, department: e.target.value })} />
          </div>
        </div>
        <div className="mb-3">
          <label className="checkbox-label">
            <input type="checkbox" checked={newSewadar.geo_required} onChange={e => setNewSewadar({ ...newSewadar, geo_required: e.target.checked })} />
            <span>Require geo-verification</span>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={onSave}>Add Sewadar</button>
        </div>
      </div>
    </div>
  )
}

function AddSessionModal({ newSession, setNewSession, onClose, onSave }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-sheet" onClick={e => e.stopPropagation()}>
        <h3 style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--gold)', marginBottom: '1.5rem', fontWeight: 700 }}>New Session</h3>
        <div className="mb-3">
          <label className="label">Session Name</label>
          <input className="input" placeholder="e.g. Morning Satsang" value={newSession.name} onChange={e => setNewSession({ ...newSession, name: e.target.value })} />
        </div>
        <div className="mb-4">
          <label className="label">Date</label>
          <input className="input" type="date" value={newSession.session_date} onChange={e => setNewSession({ ...newSession, session_date: e.target.value })} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={onSave}>Create Session</button>
        </div>
      </div>
    </div>
  )
}
