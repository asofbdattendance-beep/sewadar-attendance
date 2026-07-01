import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, ROLES, getLocalDate } from '../../lib/supabase'
import { Calendar, Plus, Grid3X3, MapPin, RefreshCw, Trash2, X, ChevronDown, ChevronUp, Save, Edit3 } from 'lucide-react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function BhatiSchedulerModal({ open, onClose, onSave, centres }) {
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [selectedDept, setSelectedDept] = useState('')
  const [departments, setDepartments] = useState([])
  const [dayEntries, setDayEntries] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setMonth(new Date().getMonth() + 1)
    setYear(new Date().getFullYear())
    setSelectedDept('')
    setDayEntries({})
    supabase.from('jatha_master')
      .select('department')
      .eq('jatha_type', 'major_centre')
      .eq('is_active', true)
      .not('department', 'is', null)
      .then(({ data }) => {
        const depts = [...new Set((data || []).map(d => d.department))]
        setDepartments(depts)
      })
  }, [open])

  const addRow = (dayIdx) => {
    setDayEntries(prev => ({
      ...prev,
      [dayIdx]: [...(prev[dayIdx] || []), { centre: '', count: 1 }]
    }))
  }

  const updateRow = (dayIdx, rowIdx, field, value) => {
    setDayEntries(prev => {
      const rows = [...(prev[dayIdx] || [])]
      rows[rowIdx] = { ...rows[rowIdx], [field]: value }
      return { ...prev, [dayIdx]: rows }
    })
  }

  const removeRow = (dayIdx, rowIdx) => {
    setDayEntries(prev => {
      const rows = (prev[dayIdx] || []).filter((_, i) => i !== rowIdx)
      const next = { ...prev }
      if (rows.length === 0) delete next[dayIdx]
      else next[dayIdx] = rows
      return next
    })
  }

  const handleSave = async () => {
    if (!selectedDept) { alert('Please select a department'); return }
    const validRows = []
    for (const [dayIdx, entries] of Object.entries(dayEntries)) {
      for (const e of entries) {
        if (e.centre && e.count > 0) validRows.push({ ...e, _dayIdx: Number(dayIdx) })
      }
    }
    if (validRows.length === 0) { alert('Please add at least one centre with a count'); return }
    setSaving(true)
    try {
      const { data: existing } = await supabase
        .from('jatha_schedules')
        .select('id, title')
        .eq('schedule_type', 'bhati')
        .eq('month', month)
        .eq('year', year)
      const deptSchedules = existing || []
      if (deptSchedules.length > 0) {
        const existingIds = deptSchedules.map(s => s.id)
        const { data: existingEntries } = await supabase
          .from('jatha_schedule_entries')
          .select('schedule_id')
          .in('schedule_id', existingIds)
          .eq('department', selectedDept)
          .limit(1)
        if (existingEntries && existingEntries.length > 0) {
          alert(`A Bhati schedule already exists for ${selectedDept} — ${MONTHS[month - 1]} ${year}`)
          setSaving(false)
          return
        }
      }
      const { data: { user } } = await supabase.auth.getUser()
      const autoTitle = `Bhati - ${selectedDept} - ${MONTHS[month - 1]} ${year}`
      const payload = { schedule_type: 'bhati', title: autoTitle, month, year, created_by: user?.id }
      const { data: schedule, error: schedErr } = await supabase.from('jatha_schedules').insert(payload).select().single()
      if (schedErr) { alert('Failed to create schedule: ' + schedErr.message); console.error(schedErr); setSaving(false); return }

      const rows = validRows.map(e => ({
        schedule_id: schedule.id, day_of_week: Number(e._dayIdx), department: selectedDept, jatha_type: 'major_centre', centre: e.centre, count: e.count, created_by: user?.id
      }))
      const { error: entErr } = await supabase.from('jatha_schedule_entries').insert(rows)
      if (entErr) { alert('Failed to save entries: ' + entErr.message); console.error(entErr); setSaving(false); return }

      setSaving(false)
      onSave()
      onClose()
    } catch (err) {
      alert('Unexpected error: ' + err.message)
      console.error(err)
      setSaving(false)
    }
  }

  if (!open) return null
  const hasValidRows = (() => {
    for (const entries of Object.values(dayEntries)) {
      for (const e of entries) { if (e.centre && e.count > 0) return true }
    }
    return false
  })()

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content schedule-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3><Grid3X3 size={18} /> New Bhati Schedule</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="schedule-form-row">
            <div className="schedule-field">
              <label>Month</label>
              <select value={month} onChange={e => setMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="schedule-field">
              <label>Year</label>
              <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} min={2024} max={2030} />
            </div>
          </div>

          <div className="schedule-field" style={{ marginBottom: 14 }}>
            <label>Department</label>
            <select value={selectedDept} onChange={e => { setSelectedDept(e.target.value); setDayEntries({}) }}>
              <option value="">Select department...</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {selectedDept && (
            <div className="bhati-week-grid">
              {[1,2,3,4,5,6,0].map(dayIdx => (
                <div key={dayIdx} className="bhati-day-section">
                  <div className="bhati-day-header">
                    <span className="bhati-day-label">{DAYS_FULL[dayIdx]}</span>
                    <button className="bhati-add-row-btn" onClick={() => addRow(dayIdx)}>
                      <Plus size={14} /> Add Centre
                    </button>
                  </div>
                  {(dayEntries[dayIdx] || []).length === 0 ? (
                    <p className="bhati-day-empty">No centres assigned</p>
                  ) : (
                    (dayEntries[dayIdx] || []).map((row, ri) => (
                      <div key={ri} className="bhati-row">
                        <select value={row.centre} onChange={e => updateRow(dayIdx, ri, 'centre', e.target.value)}>
                          <option value="">Select centre...</option>
                          {centres.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                        </select>
                        <input
                          type="number" min="1" className="sched-count-input"
                          value={row.count} onChange={e => updateRow(dayIdx, ri, 'count', Math.max(1, parseInt(e.target.value) || 1))}
                        />
                        <button className="bhati-remove-btn" onClick={() => removeRow(dayIdx, ri)}><X size={14} /></button>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || !selectedDept || !hasValidRows}>
            <Save size={16} /> {saving ? 'Saving...' : 'Save Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

const fmtDate = (d) => { if (!d) return ''; const [y, m, day] = d.split('-'); return `${day}-${m}-${y}` }

function SpecificSchedulerModal({ open, onClose, onSave, centres }) {
  const [fromDate, setFromDate] = useState(getLocalDate())
  const [toDate, setToDate] = useState(getLocalDate())
  const [location, setLocation] = useState('')
  const [locations, setLocations] = useState([])
  const [department, setDepartment] = useState('')
  const [departments, setDepartments] = useState([])
  const [rows, setRows] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setFromDate(getLocalDate())
    setToDate(getLocalDate())
    setLocation('')
    setDepartment('')
    setRows([])
    supabase.from('jatha_master')
      .select('centre_name, department')
      .eq('is_active', true)
      .not('centre_name', 'is', null)
      .then(({ data }) => {
        const locs = [...new Set((data || []).map(d => d.centre_name))]
        setLocations(locs)
        const depts = [...new Set((data || []).map(d => d.department).filter(Boolean))]
        setDepartments(depts)
      })
  }, [open])

  const addRow = () => setRows(prev => [...prev, { centre: '', count: 1 }])

  const updateRow = (idx, field, value) => {
    setRows(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  const removeRow = (idx) => setRows(prev => prev.filter((_, i) => i !== idx))

  const handleSave = async () => {
    if (!location) { alert('Please select a location'); return }
    if (!department) { alert('Please select a department'); return }
    const validRows = rows.filter(r => r.centre && r.count > 0)
    if (validRows.length === 0) { alert('Please add at least one centre with a count'); return }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const autoTitle = `Specific - ${department} - ${location} - ${fmtDate(fromDate)} to ${fmtDate(toDate)}`
      const payload = { schedule_type: 'specific', title: autoTitle, from_date: fromDate, to_date: toDate, location, created_by: user?.id }
      const { data: schedule, error: schedErr } = await supabase.from('jatha_schedules').insert(payload).select().single()
      if (schedErr) { alert('Failed to create schedule: ' + schedErr.message); console.error(schedErr); setSaving(false); return }

      const entryRows = validRows.map(r => ({
        schedule_id: schedule.id, day_of_week: null, department, date: null, centre: r.centre, count: r.count, created_by: user?.id
      }))
      const { error: entErr } = await supabase.from('jatha_schedule_entries').insert(entryRows)
      if (entErr) { alert('Failed to save entries: ' + entErr.message); console.error(entErr); setSaving(false); return }

      setSaving(false)
      onSave()
      onClose()
    } catch (err) {
      alert('Unexpected error: ' + err.message)
      console.error(err)
      setSaving(false)
    }
  }

  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content schedule-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3><Calendar size={18} /> New Specific Schedule</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="schedule-form-row">
            <div className="schedule-field">
              <label>Location</label>
              <select value={location} onChange={e => setLocation(e.target.value)}>
                <option value="">Select location...</option>
                {locations.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="schedule-field">
              <label>Department</label>
              <select value={department} onChange={e => setDepartment(e.target.value)}>
                <option value="">Select department...</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div className="schedule-form-row">
            <div className="schedule-field">
              <label>From</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div className="schedule-field">
              <label>To</label>
              <input type="date" value={toDate} min={fromDate} onChange={e => setToDate(e.target.value)} />
            </div>
          </div>

          <div className="specific-rows">
            {rows.map((r, i) => (
              <div key={i} className="bhati-row">
                <select value={r.centre} onChange={e => updateRow(i, 'centre', e.target.value)}>
                  <option value="">Select centre...</option>
                  {centres.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <input type="number" min="1" className="sched-count-input" value={r.count} onChange={e => updateRow(i, 'count', Math.max(1, parseInt(e.target.value) || 1))} />
                <button className="bhati-remove-btn" onClick={() => removeRow(i)}><X size={14} /></button>
              </div>
            ))}
            <button className="bhati-add-row-btn" onClick={addRow}><Plus size={14} /> Add Centre</button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || !location || !department}>
            <Save size={16} /> {saving ? 'Saving...' : 'Save Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

function BhatiScheduleView({ schedule, entries, centres, onRefresh, canWrite }) {
  const entriesRef = useRef([])
  const newRowsRef = useRef({})
  const [saving, setSaving] = useState(false)
  const [changed, setChanged] = useState(false)
  const [renderTick, setRenderTick] = useState(0)

  useEffect(() => {
    entriesRef.current = [...entries]
    newRowsRef.current = {}
    setChanged(false)
    setRenderTick(t => t + 1)
  }, [entries])

  const updateCount = (entryId, val) => {
    entriesRef.current = entriesRef.current.map(e => e.id === entryId ? { ...e, count: Math.max(0, parseInt(val) || 0) } : e)
    setChanged(true)
    setRenderTick(t => t + 1)
  }

  const deleteEntry = async (entryId) => {
    if (!confirm('Delete this entry?')) return
    const { error } = await supabase.from('jatha_schedule_entries').delete().eq('id', entryId)
    if (error) { alert('Failed to delete: ' + error.message); console.error(error) }
    else onRefresh()
  }

  const addNewRow = (dayIdx) => {
    const rows = [...(newRowsRef.current[dayIdx] || []), { centre: '', count: 1 }]
    newRowsRef.current = { ...newRowsRef.current, [dayIdx]: rows }
    setChanged(true)
    setRenderTick(t => t + 1)
  }

  const updateNewRow = (dayIdx, rowIdx, field, value) => {
    const rows = [...(newRowsRef.current[dayIdx] || [])]
    rows[rowIdx] = { ...rows[rowIdx], [field]: value }
    newRowsRef.current = { ...newRowsRef.current, [dayIdx]: rows }
    setRenderTick(t => t + 1)
  }

  const removeNewRow = (dayIdx, rowIdx) => {
    const rows = (newRowsRef.current[dayIdx] || []).filter((_, i) => i !== rowIdx)
    const next = { ...newRowsRef.current }
    if (rows.length === 0) delete next[dayIdx]
    else next[dayIdx] = rows
    newRowsRef.current = next
    setChanged(true)
    setRenderTick(t => t + 1)
  }

  const saveChanges = async () => {
    setSaving(true)
    try {
      const localEntries = entriesRef.current
      const newRows = newRowsRef.current

      const updates = localEntries.filter(e => e.count > 0)
      for (const e of updates) {
        const { error } = await supabase.from('jatha_schedule_entries').update({ count: e.count }).eq('id', e.id)
        if (error) { alert('Failed to update: ' + error.message); console.error(error) }
      }

      const hasNewRows = Object.values(newRows).some(r => r.some(x => x.centre && x.count > 0))
      if (hasNewRows) {
        const { data: { user } } = await supabase.auth.getUser()
        const inserts = []
        for (const [dayIdx, rows] of Object.entries(newRows)) {
          for (const r of rows) {
            if (r.centre && r.count > 0) {
              inserts.push({ schedule_id: schedule.id, day_of_week: Number(dayIdx), department: activeDept, centre: r.centre, count: r.count, created_by: user?.id })
            }
          }
        }
        if (inserts.length > 0) {
          const { error } = await supabase.from('jatha_schedule_entries').insert(inserts)
          if (error) { alert('Failed to add entries: ' + error.message); console.error(error) }
        }
      }

      newRowsRef.current = {}
      setChanged(false)
      setRenderTick(t => t + 1)
      onRefresh()
    } catch (err) {
      alert('Save error: ' + err.message)
      console.error(err)
    }
    setSaving(false)
  }

  const localEntries = entriesRef.current
  const newRows = newRowsRef.current
  const departments = [...new Set(localEntries.map(e => e.department).filter(Boolean))]
  const [activeDept, setActiveDept] = useState(departments[0] || '')

  useEffect(() => {
    if (departments.length > 0 && !departments.includes(activeDept)) {
      setActiveDept(departments[0])
    }
  }, [departments])

  const deptEntries = activeDept ? localEntries.filter(e => e.department === activeDept) : localEntries
  const deptNewRows = activeDept ? newRows : {}

  const groupedByDay = {}
  for (const e of deptEntries) {
    const d = e.day_of_week
    if (!groupedByDay[d]) groupedByDay[d] = []
    groupedByDay[d].push(e)
  }

  return (
    <div>
      {departments.length > 1 && (
        <div className="bhati-dept-tabs">
          {departments.map(d => (
            <button key={d} className={`bhati-dept-tab ${activeDept === d ? 'active' : ''}`} onClick={() => setActiveDept(d)}>
              {d}
            </button>
          ))}
        </div>
      )}

      <div className="bhati-week-grid">
        {[1,2,3,4,5,6,0].map(dayIdx => {
          const dayEntries = groupedByDay[dayIdx] || []
          const dayNewRows = deptNewRows[dayIdx] || []
          return (
            <div key={dayIdx} className="bhati-day-section">
              <div className="bhati-day-header">
                <span className="bhati-day-label">{DAYS_FULL[dayIdx]}</span>
                {canWrite && (
                  <button className="bhati-add-row-btn" onClick={() => addNewRow(dayIdx)}>
                    <Plus size={14} /> Add
                  </button>
                )}
              </div>
              {dayEntries.length === 0 && dayNewRows.length === 0 ? (
                <p className="bhati-day-empty">—</p>
              ) : (
                <>
                  {dayEntries.map(e => (
                    <div key={e.id} className="bhati-row">
                      <span className="bhati-centre-label"><MapPin size={12} /> {e.centre}</span>
                      {canWrite ? (
                        <input type="number" min="0" className="sched-count-input" value={e.count} onChange={val => updateCount(e.id, val.target.value)} />
                      ) : (
                        <span className="bhati-count-display">{e.count}</span>
                      )}
                      {canWrite && (
                        <button className="bhati-remove-btn" onClick={() => deleteEntry(e.id)}><Trash2 size={14} /></button>
                      )}
                    </div>
                  ))}
                  {canWrite && dayNewRows.map((r, ri) => (
                    <div key={`new-${ri}`} className="bhati-row">
                      <select value={r.centre} onChange={e => updateNewRow(dayIdx, ri, 'centre', e.target.value)}>
                        <option value="">Select centre...</option>
                        {centres.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                      <input type="number" min="1" className="sched-count-input" value={r.count} onChange={e => updateNewRow(dayIdx, ri, 'count', Math.max(1, parseInt(e.target.value) || 1))} />
                      <button className="bhati-remove-btn" onClick={() => removeNewRow(dayIdx, ri)}><X size={14} /></button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )
        })}
      </div>

      {canWrite && (
        <div className="bhati-save-bar">
          <button className="btn btn-primary" onClick={saveChanges} disabled={saving || !changed}>
            <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}

function ScheduleCard({ schedule, entries, centres, onDelete, onRefresh, canWrite }) {
  const [expanded, setExpanded] = useState(false)
  const isBhati = schedule.schedule_type === 'bhati'
  const totalCount = entries.reduce((s, e) => s + (e.count || 0), 0)
  const departments = [...new Set(entries.map(e => e.department).filter(Boolean))]

  return (
    <div className="schedule-card">
      <div className="schedule-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="schedule-card-info">
          {isBhati ? (
            <>
              <span className="schedule-card-title">{schedule.title}</span>
              <span className="schedule-card-meta">{MONTHS[schedule.month - 1]} {schedule.year}</span>
              {departments.length > 0 && (
                <span className="schedule-dept-chips">{departments.join(', ')}</span>
              )}
            </>
          ) : (
            <span className="schedule-card-title">{schedule.location} {departments[0] || ''} {fmtDate(schedule.from_date)} → {fmtDate(schedule.to_date)}</span>
          )}
        </div>
        <div className="schedule-card-actions">
          <span className="schedule-total-count">{totalCount} Sewadars</span>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {canWrite && (
            <button className="schedule-delete-btn" onClick={e => { e.stopPropagation(); onDelete(schedule.id) }} title="Delete schedule">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="schedule-card-body">
          {entries.length === 0 ? (
            <p className="schedule-empty">No entries</p>
          ) : isBhati ? (
            <BhatiScheduleView schedule={schedule} entries={entries} centres={centres} onRefresh={onRefresh} canWrite={canWrite} />
          ) : (
            <table className="schedule-entry-table">
              <thead>
                <tr><th>Centre</th><th className="sched-num-col">Count</th></tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id}><td>{e.centre}</td><td className="sched-num-col">{e.count}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}
function getFirstDayOfMonth(year, month) {
  return new Date(year, month - 1, 1).getDay()
}

function CentreMonthlyPlanner({ bhatiEntries, specificEntries, loading }) {
  const months = {}

  for (const e of bhatiEntries) {
    const key = `${e.year}-${e.month}`
    if (!months[key]) months[key] = { year: e.year, month: e.month, label: `${MONTHS[e.month - 1]} ${e.year}`, bhati: {}, specific: [] }
    if (!months[key].bhati[e.day_of_week]) months[key].bhati[e.day_of_week] = []
    months[key].bhati[e.day_of_week].push({ department: e.department, count: e.count, jatha_type: e.jatha_type || 'major_centre' })
  }

  for (const e of specificEntries) {
    const s = e.jatha_schedules
    if (!s || !s.from_date || !s.to_date) continue
    const fromMonth = parseInt(s.from_date.split('-')[1])
    const fromYear = parseInt(s.from_date.split('-')[0])
    const toMonth = parseInt(s.to_date.split('-')[1])
    const toYear = parseInt(s.to_date.split('-')[0])
    for (let y = fromYear; y <= toYear; y++) {
      const startM = y === fromYear ? fromMonth : 1
      const endM = y === toYear ? toMonth : 12
      for (let m = startM; m <= endM; m++) {
        const key = `${y}-${m}`
        if (!months[key]) months[key] = { year: y, month: m, label: `${MONTHS[m - 1]} ${y}`, bhati: {}, specific: [] }
        months[key].specific.push({
          from_date: s.from_date,
          to_date: s.to_date,
          location: s.location || s.title || '',
          title: s.title || '',
          department: e.department,
          centre: e.centre,
          count: e.count
        })
      }
    }
  }

  const sortedMonths = Object.values(months).sort((a, b) => b.year - a.year || b.month - a.month)

  if (loading) return <div className="report-loading"><RefreshCw size={24} className="spin" /><p>Loading planner...</p></div>
  if (sortedMonths.length === 0) return null

  return (
    <div className="planner-section">
      <div className="planner-header">
        <h3><Calendar size={20} /> Monthly Planner</h3>
        <button className="planner-print-all" onClick={() => window.print()}>🖨️ Print / PDF</button>
      </div>
      <p className="planner-subtitle">Consolidated schedule showing all Bhati duties and special events</p>

      {sortedMonths.map(m => {
        const monthKey = `${m.year}-${String(m.month).padStart(2, '0')}`
        const daysInMonth = getDaysInMonth(m.year, m.month)
        const firstDay = getFirstDayOfMonth(m.year, m.month)
        const weeks = []
        let date = 1
        for (let w = 0; date <= daysInMonth; w++) {
          const week = []
          for (let d = 0; d < 7; d++) {
            if ((w === 0 && d < (firstDay === 0 ? 6 : firstDay - 1)) || date > daysInMonth) {
              week.push(null)
            } else {
              week.push(date++)
            }
          }
          if (week.some(d => d !== null)) weeks.push(week)
        }

        const getSpecificForDate = (day) => {
          const dateStr = `${m.year}-${String(m.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          return m.specific.filter(s => s.from_date <= dateStr && s.to_date >= dateStr)
        }

        return (
          <div key={monthKey} className="planner-month">
            <div className="planner-month-title">
              <span className="planner-month-label">{m.label}</span>
              <span className="planner-month-count">
                {Object.values(m.bhati).flat().length > 0 && <span className="planner-type-badge bhati">{Object.values(m.bhati).flat().length} duties</span>}
                {m.specific.length > 0 && <span className="planner-type-badge specific">{m.specific.length} events</span>}
              </span>
            </div>
            <table className="planner-calendar">
              <thead>
                <tr><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Sun</th></tr>
              </thead>
              <tbody>
                {weeks.map((week, wi) => (
                  <tr key={wi}>
                    {week.map((day, di) => {
                      if (day === null) return <td key={di} className="planner-cell empty" />
                      const jsDay = di + 1
                      const dayIdx = jsDay % 7
                      const bhatiItems = m.bhati[dayIdx] || []
                      const specificItems = getSpecificForDate(day)
                      const isEmpty = bhatiItems.length === 0 && specificItems.length === 0
                      return (
                        <td key={di} className={`planner-cell ${isEmpty ? 'empty' : ''}`}>
                          <div className="planner-date">{day}</div>
                          {bhatiItems.map((item, i) => (
                            <div key={`b-${i}`} className="planner-tag bhati-tag" title={`${item.jatha_type} - ${item.department}`}>
                              <span className="planner-tag-label"><span className="planner-type-hint">{item.jatha_type === 'major_centre' ? 'Bhati' : item.jatha_type}</span>{item.department}</span>
                              <span className="planner-tag-count">{item.count}</span>
                            </div>
                          ))}
                          {specificItems.map((s, i) => (
                            <div key={`s-${i}`} className="planner-tag specific-tag" title={`${s.location} - ${s.department || ''}`}>
                              <span className="planner-tag-label">{s.location}{s.department ? <span className="planner-dept-label">{s.department}</span> : null}</span>
                              <span className="planner-tag-count">{s.count}</span>
                            </div>
                          ))}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
      <div className="planner-legend">
        <strong>Abbreviations:</strong>
        <span className="planner-legend-item"><span className="type-badge-plan bhati-badge-plan">Bhati</span> Major Centre duty</span>
        <span className="planner-legend-item"><span className="type-badge-plan special-badge-plan">Special</span> One-off / event duty</span>
      </div>
    </div>
  )
}

export default function ScheduleManager({ profile }) {
  const [loading, setLoading] = useState(true)
  const [schedules, setSchedules] = useState([])
  const [entriesMap, setEntriesMap] = useState({})
  const [centres, setCentres] = useState([])
  const [consolidatedEntries, setConsolidatedEntries] = useState([])
  const [specificConsolidated, setSpecificConsolidated] = useState([])
  const [showBhati, setShowBhati] = useState(false)
  const [showSpecific, setShowSpecific] = useState(false)

  const canWrite = profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.ASO

  const fetchSchedules = useCallback(async () => {
    setLoading(true)
    const [centresRes] = await Promise.all([
      supabase.rpc('get_user_accessible_centres')
    ])
    setCentres((centresRes.data || []).map(r => ({ name: r.centre_name })))

    if (canWrite) {
      const schedRes = await supabase.from('jatha_schedules').select('*').order('created_at', { ascending: false })
      const schedData = schedRes.data || []
      setSchedules(schedData)
      if (schedData.length > 0) {
        const { data: entData } = await supabase
          .from('jatha_schedule_entries')
          .select('*')
          .in('schedule_id', schedData.map(s => s.id))
          .order('centre')
        const map = {}
        for (const e of (entData || [])) {
          if (!map[e.schedule_id]) map[e.schedule_id] = []
          map[e.schedule_id].push(e)
        }
        setEntriesMap(map)
      } else {
        setEntriesMap({})
      }
    } else {
      const [bhatiRes, specificRes] = await Promise.all([
        supabase.from('jatha_schedule_entries')
          .select('*, jatha_schedules!inner(schedule_type, month, year)')
          .eq('jatha_schedules.schedule_type', 'bhati')
          .order('centre'),
        supabase.from('jatha_schedule_entries')
          .select('*, jatha_schedules!inner(schedule_type, from_date, to_date, location, title)')
          .eq('jatha_schedules.schedule_type', 'specific')
          .order('centre')
      ])
      const consolidated = (bhatiRes.data || []).map(e => ({
        ...e,
        month: e.jatha_schedules?.month,
        year: e.jatha_schedules?.year
      }))
      setConsolidatedEntries(consolidated)
      setSpecificConsolidated(specificRes.data || [])
    }
    setLoading(false)
  }, [canWrite])

  useEffect(() => { fetchSchedules() }, [fetchSchedules])

  const handleDelete = async (scheduleId) => {
    if (!confirm('Delete this schedule and all its entries?')) return
    await supabase.from('jatha_schedules').delete().eq('id', scheduleId)
    fetchSchedules()
  }

  const totalSewadars = Object.values(entriesMap).reduce((sum, entries) => sum + entries.reduce((s, e) => s + (e.count || 0), 0), 0)
  const bhatiSchedules = schedules.filter(s => s.schedule_type === 'bhati')
  const specificSchedules = schedules.filter(s => s.schedule_type === 'specific')
  const bhatiMonths = new Set(bhatiSchedules.map(s => `${s.year}-${s.month}`))
  const now = new Date()
  const pendingMonths = []
  for (let i = 1; i <= 6; i++) {
    const m = now.getMonth() + i
    const y = now.getFullYear() + (m > 12 ? 1 : 0)
    const month = m > 12 ? m - 12 : m
    if (!bhatiMonths.has(`${y}-${month}`)) pendingMonths.push({ month, year: y, label: `${MONTHS[month - 1]} ${y}` })
  }

  const downloadScheduleCSV = () => {
    if (schedules.length === 0) return
    const rows = [['Type', 'Title', 'Date Info', 'Location', 'Department', 'Centre', 'Count']]
    for (const s of schedules) {
      const entries = entriesMap[s.id] || []
      const dateInfo = s.schedule_type === 'bhati' ? `${MONTHS[s.month - 1]} ${s.year}` : `${s.from_date} to ${s.to_date}`
      if (entries.length === 0) {
        rows.push([s.schedule_type, s.title, dateInfo, s.location || '', '', '', ''])
      }
      for (const e of entries) {
        rows.push([s.schedule_type, s.title, dateInfo, s.location || '', e.department || '', e.centre, e.count])
      }
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `schedules_export_${getLocalDate()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!canWrite) {
    return (
      <div className="schedules-container">
        <div className="schedules-refresh">
          <button className="icon-btn" onClick={fetchSchedules} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
        <CentreMonthlyPlanner bhatiEntries={consolidatedEntries} specificEntries={specificConsolidated} loading={loading} />
      </div>
    )
  }

  return (
    <div className="schedules-container">
      <div className="schedules-header">
        <h3>Jatha Schedules</h3>
        <div className="schedules-actions">
          <button className="btn btn-primary" onClick={downloadScheduleCSV} disabled={schedules.length === 0}>
            <span role="img" aria-label="export">📥</span> Export CSV
          </button>
          <button className="btn btn-primary" onClick={() => setShowBhati(true)}>
            <Grid3X3 size={16} /> New Bhati
          </button>
          <button className="btn btn-primary" onClick={() => setShowSpecific(true)}>
            <Calendar size={16} /> New Specific
          </button>
        </div>
      </div>

      <div className="schedule-summary">
        <div className="summary-stat"><span className="stat-value">{schedules.length}</span><span className="stat-label">Total Schedules</span></div>
        <div className="summary-stat bhati-stat"><span className="stat-value">{bhatiSchedules.length}</span><span className="stat-label">Bhati</span></div>
        <div className="summary-stat specific-stat"><span className="stat-value">{specificSchedules.length}</span><span className="stat-label">Specific</span></div>
        <div className="summary-stat"><span className="stat-value">{totalSewadars}</span><span className="stat-label">Sewadars</span></div>
        <div className="summary-stat pending-stat"><span className="stat-value">{pendingMonths.length}</span><span className="stat-label">Pending Months</span></div>
      </div>
      {pendingMonths.length > 0 && (
        <div className="pending-months-bar">
          {pendingMonths.map(p => <span key={`${p.year}-${p.month}`} className="pending-chip">{p.label}</span>)}
        </div>
      )}

      <div className="schedules-refresh">
        <button className="icon-btn" onClick={fetchSchedules} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="report-loading">
          <RefreshCw size={24} className="spin" />
          <p>Loading schedules...</p>
        </div>
      ) : schedules.length === 0 ? (
        <div className="report-empty">
          <Calendar size={48} />
          <p>No schedules yet. Create a Bhati or Specific schedule.</p>
        </div>
      ) : (
        <div className="schedules-list">
          {schedules.map(s => (
            <ScheduleCard key={s.id} schedule={s} entries={entriesMap[s.id] || []} centres={centres} onDelete={handleDelete} onRefresh={fetchSchedules} canWrite={canWrite} />
          ))}
        </div>
      )}

      <BhatiSchedulerModal open={showBhati} onClose={() => setShowBhati(false)} onSave={fetchSchedules} centres={centres} />
      <SpecificSchedulerModal open={showSpecific} onClose={() => setShowSpecific(false)} onSave={fetchSchedules} centres={centres} />
    </div>
  )
}
