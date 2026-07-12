import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, ROLES, getLocalDate } from '../../lib/supabase'
import { Calendar, Plus, Grid3X3, MapPin, RefreshCw, Trash2, X, ChevronDown, ChevronUp, Save, Edit3 } from 'lucide-react'
import * as XLSX from 'xlsx'

import CentreMonthlyPlanner from '../../components/reports/CentreMonthlyPlanner'

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
          alert(`A Bhati schedule already exists for ${selectedDept} — ${MONTHS[month - 1]} ${year}. Edit the existing schedule to add or modify entries.`)
          setSaving(false)
          return
        }
      }
      const { data: { user } } = await supabase.auth.getUser()
      const autoTitle = `Bhati - ${selectedDept} - ${MONTHS[month - 1]} ${year}`
      const payload = { schedule_type: 'bhati', title: autoTitle, month, year, created_by: user?.id }
      const { data: schedule, error: schedErr } = await supabase.from('jatha_schedules').insert(payload).select().single()
      if (schedErr) { alert('Failed to create schedule. Please try again.'); console.error(schedErr); setSaving(false); return }

      const rows = validRows.map(e => ({
        schedule_id: schedule.id, day_of_week: Number(e._dayIdx), department: selectedDept, jatha_type: 'major_centre', centre: e.centre, count: e.count, created_by: user?.id
      }))
      const { error: entErr } = await supabase.from('jatha_schedule_entries').insert(rows)
      if (entErr) { alert('Failed to save schedule entries. Please try again.'); console.error(entErr); setSaving(false); return }

      setSaving(false)
      onSave()
      onClose()
    } catch (err) {
      alert('An unexpected error occurred. Please try again.')
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
    if (toDate < fromDate) { alert('To date must be on or after from date'); setSaving(false); return }
    setSaving(true)
    try {
      const { data: existingOverlap } = await supabase
        .from('jatha_schedules')
        .select('id, title')
        .eq('schedule_type', 'specific')
        .eq('location', location)
        .lte('from_date', toDate)
        .gte('to_date', fromDate)
        .limit(1)
      if (existingOverlap && existingOverlap.length > 0) {
        alert(`An overlapping specific schedule already exists for ${location} in this date range. Please adjust dates or edit the existing schedule.`)
        setSaving(false); return
      }
      const { data: { user } } = await supabase.auth.getUser()
      const autoTitle = `Specific - ${department} - ${location} - ${fmtDate(fromDate)} to ${fmtDate(toDate)}`
      const payload = { schedule_type: 'specific', title: autoTitle, from_date: fromDate, to_date: toDate, location, created_by: user?.id }
      const { data: schedule, error: schedErr } = await supabase.from('jatha_schedules').insert(payload).select().single()
      if (schedErr) { alert('Failed to create schedule. Please try again.'); console.error(schedErr); setSaving(false); return }

      const entryRows = validRows.map(r => ({
        schedule_id: schedule.id, day_of_week: null, department, date: null, centre: r.centre, count: r.count, created_by: user?.id
      }))
      const { error: entErr } = await supabase.from('jatha_schedule_entries').insert(entryRows)
      if (entErr) { alert('Failed to save schedule entries. Please try again.'); console.error(entErr); setSaving(false); return }

      setSaving(false)
      onSave()
      onClose()
    } catch (err) {
      alert('An unexpected error occurred. Please try again.')
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

function BhatiScheduleView({ schedule, entries, centres, onRefresh, canWrite, canCreate }) {
  const entriesRef = useRef([])
  const newRowsRef = useRef({})
  const distRef = useRef({})
  const newDistRef = useRef({})
  const savedDistRef = useRef({})
  const toggledOffRef = useRef(new Set())
  const [saving, setSaving] = useState(false)
  const [changed, setChanged] = useState(false)
  const [renderTick, setRenderTick] = useState(0)
  const [childMap, setChildMap] = useState({})

  useEffect(() => {
    entriesRef.current = [...entries]
    newRowsRef.current = {}
    newDistRef.current = {}
    toggledOffRef.current = new Set()
    setChanged(false)
    setRenderTick(t => t + 1)
    supabase.from('centres').select('name, parent_centre').then(({ data }) => {
      const map = {}
      for (const c of (data || [])) {
        if (c.parent_centre) {
          if (!map[c.parent_centre]) map[c.parent_centre] = []
          map[c.parent_centre].push(c.name)
        }
      }
      setChildMap(map)
    })
    const entryIds = entries.map(e => e.id)
    if (entryIds.length > 0) {
      supabase.from('jatha_schedule_allocations').select('*').in('entry_id', entryIds).then(({ data }) => {
        const saved = {}
        for (const a of (data || [])) {
          if (!saved[a.entry_id]) saved[a.entry_id] = {}
          saved[a.entry_id][a.centre] = a.count
        }
        savedDistRef.current = saved
        setRenderTick(t => t + 1)
      })
    }
  }, [entries])

  const updateCount = (entryId, val) => {
    entriesRef.current = entriesRef.current.map(e => e.id === entryId ? { ...e, count: Math.max(0, parseInt(val) || 0) } : e)
    setChanged(true)
    setRenderTick(t => t + 1)
  }

  const deleteEntry = async (entryId) => {
    if (!confirm('Delete this entry?')) return
    const { error } = await supabase.from('jatha_schedule_entries').delete().eq('id', entryId)
    if (error) { alert('Failed to delete entry. Please try again.'); console.error(error) }
    else onRefresh()
  }

  const toggleDistEntry = (entryId) => {
    const entry = entriesRef.current.find(e => e.id === entryId)
    if (!entry) return
    const children = childMap[entry.centre] || []
    if (children.length === 0) return
    const cur = distRef.current[entryId]
    if (cur) {
      const next = { ...distRef.current }
      delete next[entryId]
      distRef.current = next
      toggledOffRef.current.add(entryId)
    } else {
      toggledOffRef.current.delete(entryId)
      const saved = savedDistRef.current[entryId]
      if (saved) {
        distRef.current = { ...distRef.current, [entryId]: { ...saved } }
      } else {
        const dist = {}
        for (const child of children) dist[child] = 0
        distRef.current = { ...distRef.current, [entryId]: dist }
      }
    }
    setChanged(true)
    setRenderTick(t => t + 1)
  }

  const updateDistChild = (entryId, child, val) => {
    const existing = distRef.current[entryId] || savedDistRef.current[entryId] || {}
    const cur = { ...existing }
    cur[child] = Math.max(0, parseInt(val) || 0)
    distRef.current = { ...distRef.current, [entryId]: cur }
    setChanged(true)
    setRenderTick(t => t + 1)
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
    if (field === 'centre') {
      delete rows[rowIdx]._dist
      const nd = { ...newDistRef.current }
      if (nd[dayIdx]) { delete nd[dayIdx][rowIdx]; if (Object.keys(nd[dayIdx]).length === 0) delete nd[dayIdx] }
      newDistRef.current = nd
    }
    newRowsRef.current = { ...newRowsRef.current, [dayIdx]: rows }
    setRenderTick(t => t + 1)
  }

  const removeNewRow = (dayIdx, rowIdx) => {
    const rows = (newRowsRef.current[dayIdx] || []).filter((_, i) => i !== rowIdx)
    const next = { ...newRowsRef.current }
    if (rows.length === 0) delete next[dayIdx]
    else next[dayIdx] = rows
    newRowsRef.current = next
    const nd = { ...newDistRef.current }
    if (nd[dayIdx]) { delete nd[dayIdx][rowIdx]; if (Object.keys(nd[dayIdx]).length === 0) delete nd[dayIdx] }
    newDistRef.current = nd
    setChanged(true)
    setRenderTick(t => t + 1)
  }

  const toggleNewDist = (dayIdx, rowIdx) => {
    const row = (newRowsRef.current[dayIdx] || [])[rowIdx]
    if (!row) return
    const children = childMap[row.centre] || []
    if (children.length === 0) return
    const nd = { ...newDistRef.current }
    if (!nd[dayIdx]) nd[dayIdx] = {}
    const cur = nd[dayIdx][rowIdx]
    if (cur) {
      delete nd[dayIdx][rowIdx]
      if (Object.keys(nd[dayIdx]).length === 0) delete nd[dayIdx]
    } else {
      const dist = {}
      for (const child of children) dist[child] = 0
      nd[dayIdx][rowIdx] = dist
    }
    newDistRef.current = nd
    setChanged(true)
    setRenderTick(t => t + 1)
  }

  const updateNewDistChild = (dayIdx, rowIdx, child, val) => {
    const nd = { ...newDistRef.current }
    if (!nd[dayIdx]) nd[dayIdx] = {}
    nd[dayIdx][rowIdx] = { ...(nd[dayIdx][rowIdx] || {}), [child]: Math.max(0, parseInt(val) || 0) }
    newDistRef.current = nd
    setChanged(true)
    setRenderTick(t => t + 1)
  }

  const saveChanges = async () => {
    setSaving(true)
    try {
      const localEntries = entriesRef.current
      const localDist = distRef.current
      const localNewRows = newRowsRef.current
      const localNewDist = newDistRef.current
      const { data: { user } } = await supabase.auth.getUser()

      for (const e of localEntries) {
        const original = schedule.jatha_schedule_entries.find(o => o.id === e.id)
        if (original && original.count !== e.count) {
          const { error } = await supabase.from('jatha_schedule_entries').update({ count: e.count }).eq('id', e.id)
          if (error) { alert('Failed to update entry. Please try again.'); console.error(error); setSaving(false); return }
        }
        const dist = localDist[e.id]
        if (dist && Object.values(dist).some(v => v > 0)) {
          const childSum = Object.values(dist).reduce((s, v) => s + v, 0)
          if (childSum > e.count) {
            alert(`Distribution for ${e.centre} sums to ${childSum}, exceeds available ${e.count}`)
            setSaving(false); return
          }
          const { error: delErr } = await supabase.from('jatha_schedule_allocations').delete().eq('entry_id', e.id)
          if (delErr) { console.error('Failed to clear existing allocations:', delErr); alert('Failed to update distribution. Please try again.'); setSaving(false); return }
          const allocRows = Object.entries(dist).filter(([,c]) => c > 0).map(([child, count]) => ({
            entry_id: e.id, centre: child, count, created_by: user?.id
          }))
          if (allocRows.length > 0) {
            const { error } = await supabase.from('jatha_schedule_allocations').insert(allocRows)
            if (error) { alert('Failed to save distribution. Please try again.'); console.error(error); setSaving(false); return }
          }
        }
      }

      for (const [dayIdx, rows] of Object.entries(localNewRows)) {
        for (let ri = 0; ri < rows.length; ri++) {
          const r = rows[ri]
          if (!r.centre || r.count <= 0) continue
          const d = Number(dayIdx)
          const { data: existing } = await supabase
            .from('jatha_schedule_entries')
            .select('id')
            .eq('schedule_id', schedule.id)
            .eq('day_of_week', d)
            .eq('department', activeDept)
            .eq('centre', r.centre)
            .maybeSingle()
          let entryId
          if (existing) {
            entryId = existing.id
          } else {
            const { data: ins, error } = await supabase.from('jatha_schedule_entries').insert({
              schedule_id: schedule.id, day_of_week: d, department: activeDept, centre: r.centre, count: r.count, created_by: user?.id
            }).select('id').single()
            if (error) { alert('Failed to add entry. Please try again.'); console.error(error); continue }
            entryId = ins.id
          }
          const dist = localNewDist[dayIdx]?.[ri]
          if (dist && Object.values(dist).some(v => v > 0)) {
            const childSum = Object.values(dist).reduce((s, v) => s + v, 0)
            if (childSum > r.count) {
              alert(`Distribution for ${r.centre} sums to ${childSum}, exceeds ${r.count}`)
              setSaving(false); return
            }
            const { error: delErr } = await supabase.from('jatha_schedule_allocations').delete().eq('entry_id', entryId)
            if (delErr) { console.error('Failed to clear existing allocations:', delErr); alert('Failed to update distribution. Please try again.'); setSaving(false); return }
            const allocRows = Object.entries(dist).filter(([,c]) => c > 0).map(([child, count]) => ({
              entry_id: entryId, centre: child, count, created_by: user?.id
            }))
            if (allocRows.length > 0) {
              const { error } = await supabase.from('jatha_schedule_allocations').insert(allocRows)
              if (error) { alert('Failed to save distribution. Please try again.'); console.error(error); setSaving(false); return }
            }
          }
        }
      }

      newRowsRef.current = {}
      newDistRef.current = {}
      distRef.current = {}
      toggledOffRef.current = new Set()
      setChanged(false)
      setRenderTick(t => t + 1)
      onRefresh()
    } catch (err) {
      alert('Failed to save changes. Please try again.')
      console.error(err)
    }
    setSaving(false)
  }

  const localEntries = entriesRef.current
  const newRows = newRowsRef.current
  const departments = [...new Set(localEntries.map(e => e.department).filter(Boolean))]
  const [activeDept, setActiveDept] = useState('')

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
                {canCreate && (
                  <button className="bhati-add-row-btn" onClick={() => addNewRow(dayIdx)}>
                    <Plus size={14} /> Add
                  </button>
                )}
              </div>
              {dayEntries.length === 0 && dayNewRows.length === 0 ? (
                <p className="bhati-day-empty">—</p>
              ) : (
                <>
                  {dayEntries.map(e => {
                    const children = childMap[e.centre] || []
                    const hasDist = distRef.current[e.id] !== undefined || (savedDistRef.current[e.id] !== undefined && !toggledOffRef.current.has(e.id))
                    const dist = distRef.current[e.id] || savedDistRef.current[e.id]
                    const childSum = dist ? Object.values(dist).reduce((s, v) => s + v, 0) : 0
                    return (
                    <div key={e.id} className={`bhati-row ${hasDist ? 'has-distribute' : ''}`}>
                      <span className="bhati-centre-label"><MapPin size={12} /> {e.centre}</span>
                      {canWrite ? (
                        <input type="number" min="0" className="sched-count-input" value={e.count} onChange={ev => updateCount(e.id, ev.target.value)} />
                      ) : (
                        <span className="bhati-count-display">{e.count}</span>
                      )}
                      {canWrite && children.length > 0 && (
                        <button className={`bhati-dist-btn ${hasDist ? 'active' : ''}`} onClick={() => toggleDistEntry(e.id)} title="Distribute to child centres">⬇</button>
                      )}
                      {canCreate && (
                        <button className="bhati-remove-btn" onClick={() => deleteEntry(e.id)}><Trash2 size={14} /></button>
                      )}
                      {hasDist && (
                        <div className="bhati-dist-children">
                          {children.map(child => (
                            <div key={child} className="bhati-dist-child">
                              <span className="bhati-dist-child-name">{child}</span>
                              <input type="number" min="0" className="sched-count-input dist-input" value={dist[child] || 0} onChange={ev => updateDistChild(e.id, child, ev.target.value)} />
                            </div>
                          ))}
                          <div className="bhati-dist-sum"><span>Total</span><span className={childSum !== e.count ? 'mismatch' : ''}>{childSum} / {e.count}</span></div>
                        </div>
                      )}
                    </div>
                  )})}
                  {canWrite && dayNewRows.map((r, ri) => {
                    const children = childMap[r.centre] || []
                    const hasDist = newDistRef.current[dayIdx]?.[ri] !== undefined
                    const dist = newDistRef.current[dayIdx]?.[ri]
                    const childSum = dist ? Object.values(dist).reduce((s, v) => s + v, 0) : 0
                    return (
                    <div key={`new-${ri}`} className={`bhati-row ${hasDist ? 'has-distribute' : ''}`}>
                      <select value={r.centre} onChange={e => updateNewRow(dayIdx, ri, 'centre', e.target.value)}>
                        <option value="">Select centre...</option>
                        {centres.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                      <input type="number" min="1" className="sched-count-input" value={r.count} onChange={e => updateNewRow(dayIdx, ri, 'count', Math.max(1, parseInt(e.target.value) || 1))} />
                      {children.length > 0 && (
                        <button className={`bhati-dist-btn ${hasDist ? 'active' : ''}`} onClick={() => toggleNewDist(dayIdx, ri)} title="Distribute to child centres">⬇</button>
                      )}
                      <button className="bhati-remove-btn" onClick={() => removeNewRow(dayIdx, ri)}><X size={14} /></button>
                      {hasDist && (
                        <div className="bhati-dist-children">
                          {children.map(child => (
                            <div key={child} className="bhati-dist-child">
                              <span className="bhati-dist-child-name">{child}</span>
                              <input type="number" min="0" className="sched-count-input dist-input" value={dist[child] || 0} onChange={ev => updateNewDistChild(dayIdx, ri, child, ev.target.value)} />
                            </div>
                          ))}
                          <div className="bhati-dist-sum"><span>Total</span><span className={childSum !== r.count ? 'mismatch' : ''}>{childSum} / {r.count}</span></div>
                        </div>
                      )}
                    </div>
                  )})}
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

function ScheduleCard({ schedule, entries, centres, onDelete, onRefresh, canWrite, canCreate }) {
  const [showModal, setShowModal] = useState(false)
  const isBhati = schedule.schedule_type === 'bhati'
  const [changed, setChanged] = useState(false)
  const [saving, setSaving] = useState(false)
  const entriesRef = useRef(entries.map(e => ({ ...e })))
  const [newCentre, setNewCentre] = useState('')
  const [newCount, setNewCount] = useState(1)
  const [centreSearch, setCentreSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  useEffect(() => { entriesRef.current = entries.map(e => ({ ...e })); setChanged(false) }, [entries])
  const totalCount = entriesRef.current.reduce((s, e) => s + (e.count || 0), 0)
  const departments = [...new Set(entries.map(e => e.department).filter(Boolean))]

  const filteredCentres = centres.filter(c => c.name.toLowerCase().includes(centreSearch.toLowerCase()))

  const updateCount = (id, val) => {
    entriesRef.current = entriesRef.current.map(e => e.id === id ? { ...e, count: Math.max(0, parseInt(val) || 0) } : e)
    setChanged(true)
  }

  const addEntry = () => {
    if (!newCentre) return
    entriesRef.current = [...entriesRef.current, { centre: newCentre, count: Math.max(1, newCount), _temp: true }]
    setNewCentre('')
    setNewCount(1)
    setCentreSearch('')
    setShowDropdown(false)
    setChanged(true)
  }

  const removeEntry = (idx) => {
    entriesRef.current = entriesRef.current.filter((_, i) => i !== idx)
    setChanged(true)
  }

  const saveChanges = async () => {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      for (const e of entriesRef.current) {
        if (e._temp) {
          const { error } = await supabase.from('jatha_schedule_entries').insert({
            schedule_id: schedule.id, day_of_week: null, department: departments[0] || null, centre: e.centre, count: e.count, created_by: user?.id
          })
          if (error) { alert('Failed to add entry. Please try again.'); console.error(error); setSaving(false); return }
        } else {
          const orig = entries.find(o => o.id === e.id)
          if (orig && orig.count !== e.count) {
            const { error } = await supabase.from('jatha_schedule_entries').update({ count: e.count }).eq('id', e.id)
            if (error) { alert('Failed to update entry. Please try again.'); console.error(error); setSaving(false); return }
          }
        }
      }
      setSaving(false)
      setChanged(false)
      setShowModal(false)
      onRefresh()
    } catch (err) {
      alert('Failed to save changes. Please try again.')
      console.error(err)
      setSaving(false)
    }
  }

  return (
    <>
      <tr className={`sched-row`} onClick={() => setShowModal(true)}>
        <td className="sched-cell-type">
          <span className={`schedule-type-badge ${isBhati ? '' : 'specific'}`}>{isBhati ? 'BHATI' : 'SPECIFIC'}</span>
        </td>
        <td className="sched-cell-title">{isBhati ? schedule.title : schedule.location}</td>
        <td className="sched-cell-dept">{departments.join(', ') || '—'}</td>
        <td className="sched-cell-date">{isBhati ? `${MONTHS[schedule.month - 1]} ${schedule.year}` : `${fmtDate(schedule.from_date)} – ${fmtDate(schedule.to_date)}`}</td>
        <td className="sched-cell-count">{totalCount}</td>
        <td className="sched-cell-actions" onClick={e => e.stopPropagation()}>
          {canCreate && (
            <button className="schedule-delete-btn" onClick={() => onDelete(schedule.id)} title="Delete schedule">
              <Trash2 size={14} />
            </button>
          )}
          <span className={`sched-expand-icon`}><ChevronDown size={14} /></span>
        </td>
      </tr>

      {showModal && (
        <div className="modal-overlay" onClick={() => { if (!changed || confirm('Discard changes?')) setShowModal(false) }}>
          <div className="modal-content sched-modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{isBhati ? schedule.title : schedule.location}</h3>
              <button className="modal-close" onClick={() => { if (!changed || confirm('Discard changes?')) setShowModal(false) }}><X size={20} /></button>
            </div>
            <div className="modal-body">
              {isBhati ? (
                <BhatiScheduleView schedule={schedule} entries={entries} centres={centres} onRefresh={() => { setShowModal(false); onRefresh() }} canWrite={canWrite} canCreate={canCreate} />
              ) : (
                <div className="specific-edit-body">
                  <table className="schedule-entry-table">
                    <thead>
                      <tr><th>Centre</th><th className="sched-num-col">Count</th></tr>
                    </thead>
                    <tbody>
                      {entriesRef.current.map((e, i) => (
                        <tr key={e.id || `new-${i}`}>
                          <td className="sched-centre-cell">{e.centre}{e._temp && <span className="sched-new-badge">NEW</span>}</td>
                          <td className="sched-num-col">
                            {canWrite ? (
                              <div className="sched-count-wrap">
                                <input type="number" min="0" className="sched-count-input" value={e.count} onChange={ev => updateCount(e.id || `new-${i}`, ev.target.value)} />
                                {e._temp && <button className="sched-remove-btn" onClick={() => removeEntry(i)}><X size={12} /></button>}
                              </div>
                            ) : e.count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {canCreate && (
                    <div className="sched-add-row">
                      <div className="sched-centre-picker">
                        <input type="text" className="sched-add-input" placeholder="Search centre..." value={centreSearch} onFocus={() => setShowDropdown(true)} onChange={e => { setCentreSearch(e.target.value); setShowDropdown(true) }} />
                        {showDropdown && filteredCentres.length > 0 && (
                          <div className="sched-centre-dropdown">
                            {filteredCentres.map(c => (
                              <div key={c.name} className={`sched-centre-option${newCentre === c.name ? ' selected' : ''}`} onClick={() => { setNewCentre(c.name); setCentreSearch(c.name); setShowDropdown(false) }}>{c.name}</div>
                            ))}
                          </div>
                        )}
                      </div>
                      <input type="number" min="1" className="sched-add-input sched-add-count" value={newCount} onChange={e => setNewCount(Math.max(1, parseInt(e.target.value) || 1))} />
                      <button className="btn btn-sm" onClick={addEntry} disabled={!newCentre}>+ Add</button>
                    </div>
                  )}
                  {canWrite && changed && (
                    <div className="sched-modal-actions">
                      <button className="btn btn-secondary" onClick={() => { setShowModal(false); onRefresh() }}>Cancel</button>
                      <button className="btn btn-primary" onClick={saveChanges} disabled={saving}>
                        <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
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
  const [plannerRefresh, setPlannerRefresh] = useState(0)

  const canWrite = profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.ASO || profile?.role === ROLES.ADMIN
  const canCreate = profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.ASO

  const fetchSchedules = useCallback(async () => {
    setLoading(true)
    const [centresRes] = await Promise.all([
      supabase.rpc('get_user_accessible_centres')
    ])
    const centresList = (centresRes.data || []).map(r => ({ name: r.centre_name }))
    setCentres(centresList)

    const schedRes = await supabase.from('jatha_schedules').select('*').order('created_at', { ascending: false }).limit(200)
    const schedData = schedRes.data || []
    setSchedules(schedData)
    const map = {}
    if (schedData.length > 0) {
      const { data: entData } = await supabase
        .from('jatha_schedule_entries')
        .select('*')
        .in('schedule_id', schedData.map(s => s.id))
        .order('centre')
      for (const e of (entData || [])) {
        if (!map[e.schedule_id]) map[e.schedule_id] = []
        map[e.schedule_id].push(e)
      }
    }
    setEntriesMap(map)

    const cn = []
    const sp = []
    for (const s of schedData) {
      const entries = map[s.id] || []
      if (s.schedule_type === 'bhati') {
        for (const e of entries) {
          cn.push({ ...e, month: s.month, year: s.year })
        }
      } else if (s.schedule_type === 'specific') {
        for (const e of entries) {
          sp.push({ ...e, jatha_schedules: { from_date: s.from_date, to_date: s.to_date, location: s.location || s.title || '', title: s.title || '' } })
        }
      }
    }
    setConsolidatedEntries(cn)
    setSpecificConsolidated(sp)
    setLoading(false)
    setPlannerRefresh(p => p + 1)
  }, [])

  useEffect(() => { fetchSchedules() }, [fetchSchedules])

  const handleDelete = async (scheduleId) => {
    if (!confirm('Delete this schedule and all its entries?')) return
    try {
      const { error } = await supabase.from('jatha_schedules').delete().eq('id', scheduleId)
      if (error) { console.error('Delete failed:', error); alert('Failed to delete schedule. Please try again.') }
    } catch (err) {
      console.error('Delete error:', err)
      alert('Failed to delete schedule. Please try again.')
    }
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

  const downloadScheduleXLSX = () => {
    if (schedules.length === 0) return
    const bhatiRows = []
    const specificRows = []
    for (const s of schedules) {
      const entries = entriesMap[s.id] || []
      if (s.schedule_type === 'bhati') {
        for (const e of entries) {
          bhatiRows.push({
            Type: 'Bhati',
            Title: s.title,
            Location: '',
            Day: DAYS_FULL[e.day_of_week] ?? '',
            Department: e.department || '',
            Centre: e.centre,
            Count: e.count,
          })
        }
      } else {
        for (const e of entries) {
          specificRows.push({
            Type: 'Specific',
            Title: s.title,
            Location: s.location || '',
            'From Date': s.from_date || '',
            'To Date': s.to_date || '',
            Department: e.department || '',
            Centre: e.centre,
            Count: e.count,
          })
        }
      }
    }
    const wb = XLSX.utils.book_new()
    const bhatiWs = XLSX.utils.json_to_sheet(bhatiRows)
    const specificWs = XLSX.utils.json_to_sheet(specificRows)
    XLSX.utils.book_append_sheet(wb, bhatiWs, 'Bhati')
    XLSX.utils.book_append_sheet(wb, specificWs, 'Specific')
    const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([data], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `schedules_export_${getLocalDate()}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="schedules-container">
      <div className="schedules-header">
        <h3>Jatha Schedules</h3>
        {canWrite && (
          <div className="schedules-actions">
            <button className="btn btn-primary" onClick={downloadScheduleXLSX} disabled={schedules.length === 0}>
              <span role="img" aria-label="export">📥</span> Export Excel
            </button>
            {canCreate && (
              <button className="btn btn-primary" onClick={() => setShowBhati(true)}>
                <Grid3X3 size={16} /> New Bhati
              </button>
            )}
            {canCreate && (
              <button className="btn btn-primary" onClick={() => setShowSpecific(true)}>
                <Calendar size={16} /> New Specific
              </button>
            )}
          </div>
        )}
      </div>

      {canWrite && (
        <>
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
        </>
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
      ) : (<>
        <CentreMonthlyPlanner profile={profile} refreshTrigger={plannerRefresh} />
        {schedules.length > 0 && <table className="schedules-table">
          <thead>
            <tr>
              <th className="sched-th-type">Type</th>
              <th className="sched-th-title">Title / Location</th>
              <th className="sched-th-dept">Department</th>
              <th className="sched-th-date">Period</th>
              <th className="sched-th-count">Count</th>
              <th className="sched-th-actions"></th>
            </tr>
          </thead>
          <tbody>
            {schedules.map(s => (
              <ScheduleCard key={s.id} schedule={s} entries={entriesMap[s.id] || []} centres={centres} onDelete={handleDelete} onRefresh={fetchSchedules} canWrite={canWrite} canCreate={canCreate} />
            ))}
          </tbody>
        </table>}
      </>)}

      {canCreate && (
        <>
          <BhatiSchedulerModal open={showBhati} onClose={() => setShowBhati(false)} onSave={fetchSchedules} centres={centres} />
          <SpecificSchedulerModal open={showSpecific} onClose={() => setShowSpecific(false)} onSave={fetchSchedules} centres={centres} />
        </>
      )}
    </div>
  )
}
