import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { supabase, ROLES, getLocalDate } from '../../lib/supabase'
import { Calendar, Plus, Grid3X3, MapPin, RefreshCw, Trash2, X, ChevronDown, ChevronUp, Save, Edit3 } from 'lucide-react'
import * as XLSX from 'xlsx'

import CentreMonthlyPlanner from '../../components/reports/CentreMonthlyPlanner'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function MultiSelectCentres({ centres, selected, onChange, placeholder }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef(null)

  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = centres.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
  const toggleCentre = (name) => onChange(selected.includes(name) ? selected.filter(c => c !== name) : [...selected, name])

  return (
    <div className="multi-select-container" ref={containerRef}>
      <div className="multi-select-chips" onClick={() => setOpen(p => !p)}>
        {selected.length === 0 ? (
          <span className="multi-select-placeholder">{placeholder || 'Select centres...'}</span>
        ) : (
          selected.map(c => (
            <span key={c} className="multi-chip">
              {c}
              <button type="button" className="multi-chip-remove" onClick={(e) => { e.stopPropagation(); toggleCentre(c) }}>
                <X size={10} />
              </button>
            </span>
          ))
        )}
        <ChevronDown size={14} className={`multi-select-chevron ${open ? 'open' : ''}`} />
      </div>
      {open && (
        <div className="multi-select-dropdown">
          <input type="text" className="multi-select-search" placeholder="Search centres..." value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          <div className="multi-select-options">
            {filtered.map(c => (
              <label key={c.name} className={`multi-select-option ${selected.includes(c.name) ? 'checked' : ''}`}>
                <input type="checkbox" checked={selected.includes(c.name)} onChange={() => toggleCentre(c.name)} />
                {c.name}
              </label>
            ))}
            {filtered.length === 0 && <div className="multi-select-empty">No matches</div>}
          </div>
        </div>
      )}
    </div>
  )
}

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
      [dayIdx]: [...(prev[dayIdx] || []), { centres: [], count: 1 }]
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
        if (e.centres.length > 0 && e.count > 0) {
          validRows.push({ centre: e.centres.join(' & '), count: e.count, _dayIdx: Number(dayIdx) })
        }
      }
    }
    if (validRows.length === 0) { alert('Please add at least one centre with a count'); return }
    const curYear = new Date().getFullYear()
    if (year < curYear - 1 || year > curYear + 1) { alert('Please select a valid year'); return }
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
      if (entErr) {
        await supabase.from('jatha_schedules').delete().eq('id', schedule.id)
        if (entErr.code === '23505') {
          alert('This centre already exists in this schedule. Please edit the existing entry instead.')
        } else {
          alert('Failed to save schedule entries. Please try again.')
        }
        console.error(entErr); setSaving(false); return
      }

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
      for (const e of entries) { if (e.centres.length > 0 && e.count > 0) return true }
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
              <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} min={new Date().getFullYear() - 1} max={new Date().getFullYear() + 1} />
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
                      <div key={ri} className="bhati-row multi-centre-row">
                        <MultiSelectCentres
                          centres={centres}
                          selected={row.centres}
                          onChange={val => updateRow(dayIdx, ri, 'centres', val)}
                          placeholder="Select centres..."
                        />
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
  const [masterData, setMasterData] = useState([])

  const locationDepts = useMemo(() => {
    const map = {}
    for (const d of masterData) {
      if (!map[d.centre_name]) map[d.centre_name] = new Set()
      map[d.centre_name].add(d.department)
    }
    return map
  }, [masterData])

  const filteredDepartments = location
    ? departments.filter(d => locationDepts[location]?.has(d))
    : departments

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
        const raw = data || []
        setMasterData(raw)
        const locs = [...new Set(raw.map(d => d.centre_name))]
        setLocations(locs)
        const depts = [...new Set(raw.map(d => d.department).filter(Boolean))]
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
    if (toDate < fromDate) { alert('To date must be on or after from date'); return }
    setSaving(true)
    try {
      const { data: overlappingHeaders } = await supabase
        .from('jatha_schedules')
        .select('id')
        .eq('schedule_type', 'specific')
        .eq('location', location)
        .lte('from_date', toDate)
        .gte('to_date', fromDate)
      if (overlappingHeaders && overlappingHeaders.length > 0) {
        const { data: deptEntries } = await supabase
          .from('jatha_schedule_entries')
          .select('schedule_id')
          .in('schedule_id', overlappingHeaders.map(h => h.id))
          .eq('department', department)
          .limit(1)
        if (deptEntries && deptEntries.length > 0) {
          alert(`An overlapping specific schedule already exists for ${location} (${department}) in this date range. Please adjust dates or edit the existing schedule.`)
          setSaving(false); return
        }
      }
      const { data: { user } } = await supabase.auth.getUser()
      const autoTitle = `Specific - ${department} - ${location} - ${fmtDate(fromDate)} to ${fmtDate(toDate)}`
      const payload = { schedule_type: 'specific', title: autoTitle, from_date: fromDate, to_date: toDate, location, created_by: user?.id }
      const { data: schedule, error: schedErr } = await supabase.from('jatha_schedules').insert(payload).select().single()
      if (schedErr) { alert('Failed to create schedule. Please try again.'); console.error(schedErr); setSaving(false); return }

      const entryRows = validRows.map(r => ({
        schedule_id: schedule.id, day_of_week: null, department, jatha_type: `Jatha ${location}`, date: null, centre: r.centre, count: r.count, created_by: user?.id
      }))
      const { error: entErr } = await supabase.from('jatha_schedule_entries').insert(entryRows)
      if (entErr) {
        await supabase.from('jatha_schedules').delete().eq('id', schedule.id)
        if (entErr.code === '23505') {
          alert('This centre already exists in this schedule. Please edit the existing entry instead.')
        } else {
          alert('Failed to save schedule entries. Please try again.')
        }
        console.error(entErr); setSaving(false); return
      }

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
              <select value={location} onChange={e => { setLocation(e.target.value); setDepartment('') }}>
                <option value="">Select location...</option>
                {locations.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="schedule-field">
              <label>Department</label>
              <select value={department} onChange={e => setDepartment(e.target.value)}>
                <option value="">Select department...</option>
                {filteredDepartments.map(d => <option key={d} value={d}>{d}</option>)}
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
  const [activeDept, setActiveDept] = useState('')
  const [groupAddOpen, setGroupAddOpen] = useState(null)
  const [groupAddCentres, setGroupAddCentres] = useState([])
  const [groupAddCount, setGroupAddCount] = useState(1)

  const parseCentres = (str) => str ? str.split(' & ') : []

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

  const localEntriesForDept = entriesRef.current
  const deptList = [...new Set(localEntriesForDept.map(e => e.department).filter(Boolean))]
  useEffect(() => {
    if (deptList.length > 0 && !deptList.includes(activeDept)) {
      setActiveDept(deptList[0])
    }
  }, [deptList])

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
    const rows = [...(newRowsRef.current[dayIdx] || []), { centres: [], count: 1 }]
    newRowsRef.current = { ...newRowsRef.current, [dayIdx]: rows }
    setChanged(true)
    setRenderTick(t => t + 1)
  }

  const updateNewRow = (dayIdx, rowIdx, field, value) => {
    const rows = [...(newRowsRef.current[dayIdx] || [])]
    rows[rowIdx] = { ...rows[rowIdx], [field]: value }
    if (field === 'centres') {
      rows[rowIdx]._dist = undefined
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
    let errors = []
    let savedAllocs = {}
    try {
      const localEntries = entriesRef.current
      const localDist = distRef.current
      const localNewRows = newRowsRef.current
      const { data: { user } } = await supabase.auth.getUser()

      // Phase 1: Validate all distribution sums first
      for (const e of localEntries) {
        if (e._temp) continue
        const dist = localDist[e.id]
        if (dist) {
          const childSum = Object.values(dist).reduce((s, v) => s + v, 0)
          if (childSum > e.count) {
            alert(`Distribution for ${e.centre} sums to ${childSum}, exceeds available ${e.count}`)
            setSaving(false); return
          }
        }
      }

      // Phase 2: Save existing allocations before any delete
      const allocEntryIds = localEntries
        .filter(e => !e._temp && localDist[e.id])
        .map(e => e.id)
      if (allocEntryIds.length > 0) {
        const { data: oldAllocs } = await supabase
          .from('jatha_schedule_allocations')
          .select('*')
          .in('entry_id', allocEntryIds)
        if (oldAllocs) {
          for (const a of oldAllocs) {
            if (!savedAllocs[a.entry_id]) savedAllocs[a.entry_id] = []
            savedAllocs[a.entry_id].push(a)
          }
        }
      }

      // Phase 3: Update existing entries (counts + centre + distributions) — skip _temp
      for (const e of localEntries) {
        if (e._temp) continue
        const original = entries.find(o => o.id === e.id)
        if (original && (original.count !== e.count || original.centre !== e.centre)) {
          const updates = {}
          if (original.count !== e.count) updates.count = e.count
          if (original.centre !== e.centre) updates.centre = e.centre
          const { error } = await supabase.from('jatha_schedule_entries').update(updates).eq('id', e.id)
          if (error) { errors.push(`Failed to update ${e.centre}: ${error.message}`); continue }
        }
        const dist = localDist[e.id]
        if (dist && Object.values(dist).some(v => v > 0)) {
          const { error: delErr } = await supabase.from('jatha_schedule_allocations').delete().eq('entry_id', e.id)
          if (delErr) { errors.push(`Failed to update distribution for ${e.centre}`); continue }
          const allocRows = Object.entries(dist).filter(([,c]) => c > 0).map(([child, count]) => ({
            entry_id: e.id, centre: child, count, created_by: user?.id
          }))
          if (allocRows.length > 0) {
            const { error } = await supabase.from('jatha_schedule_allocations').insert(allocRows)
            if (error) {
              if (savedAllocs[e.id]) {
                await supabase.from('jatha_schedule_allocations').insert(savedAllocs[e.id])
              }
              errors.push(`Failed to save distribution for ${e.centre}`)
            }
          }
        }
      }

      // Phase 4: Insert new rows (multi-centre → combined name) and _temp entries from group additions
      const pendingInserts = []
      for (const [dayIdx, rows] of Object.entries(localNewRows)) {
        for (const r of rows) {
          if (r.centres.length === 0 || r.count <= 0) continue
          pendingInserts.push({ centre: r.centres.join(' & '), count: r.count, day_of_week: Number(dayIdx) })
        }
      }
      for (const e of localEntries) {
        if (!e._temp) continue
        pendingInserts.push({ centre: e.centre, count: e.count, day_of_week: e.day_of_week })
      }

      for (const pi of pendingInserts) {
        const { data: existing } = await supabase
          .from('jatha_schedule_entries')
          .select('id')
          .eq('schedule_id', schedule.id)
          .eq('day_of_week', pi.day_of_week)
          .eq('department', activeDept)
          .eq('centre', pi.centre)
          .maybeSingle()
        if (existing) {
          const { error } = await supabase.from('jatha_schedule_entries').update({ count: pi.count }).eq('id', existing.id)
          if (error) { errors.push(`Failed to update ${pi.centre}: ${error.message}`) }
        } else {
          const { error } = await supabase.from('jatha_schedule_entries').insert({
            schedule_id: schedule.id, day_of_week: pi.day_of_week, department: activeDept,
            centre: pi.centre, count: pi.count, created_by: user?.id
          })
          if (error) { errors.push(`Failed to add ${pi.centre}: ${error.message}`) }
        }
      }

      if (errors.length > 0) {
        alert(`Some changes couldn't be saved:\n${errors.join('\n')}\n\nFix the issues and try again.`)
        setSaving(false); return
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
    } finally {
      setSaving(false)
    }
  }

  const localEntries = entriesRef.current
  const newRows = newRowsRef.current
  const departments = [...new Set(localEntries.map(e => e.department).filter(Boolean))]

  const deptEntries = activeDept ? localEntries.filter(e => e.department === activeDept) : localEntries
  const deptNewRows = activeDept ? newRows : {}

  // Group existing entries by (day_of_week, count)
  const groupsByDay = {}
  for (const e of deptEntries) {
    const d = e.day_of_week
    if (!groupsByDay[d]) groupsByDay[d] = []
    let group = groupsByDay[d].find(g => g.count === e.count)
    if (!group) {
      group = { count: e.count, entries: [] }
      groupsByDay[d].push(group)
    }
    group.entries.push(e)
  }

  const removeFromGroup = (entry, centreName) => {
    const components = parseCentres(entry.centre)
    const filtered = components.filter(c => c !== centreName)
    if (filtered.length === 0) {
      if (entry._temp || !entry.id) {
        entriesRef.current = entriesRef.current.filter(e => e !== entry)
      } else {
        deleteEntry(entry.id)
        return
      }
    } else {
      const newCentre = filtered.join(' & ')
      entriesRef.current = entriesRef.current.map(e =>
        (e.id && e.id === entry.id) || (!e.id && e === entry) ? { ...e, centre: newCentre } : e
      )
    }
    setChanged(true)
    setRenderTick(t => t + 1)
  }

  const addCentresToGroup = (dayIdx, count, selected) => {
    if (selected.length === 0) return
    const existing = entriesRef.current.find(e =>
      e.day_of_week === dayIdx && e.count === count && e.department === activeDept
    )
    if (existing) {
      const current = parseCentres(existing.centre)
      const merged = [...new Set([...current, ...selected])]
      entriesRef.current = entriesRef.current.map(e =>
        e === existing ? { ...e, centre: merged.join(' & ') } : e
      )
    } else {
      entriesRef.current = [...entriesRef.current, {
        schedule_id: schedule.id, day_of_week: dayIdx, department: activeDept,
        centre: selected.join(' & '), count, _temp: true
      }]
    }
    setChanged(true)
    setRenderTick(t => t + 1)
  }

  const updateGroupCount = (dayIdx, currentCount, newVal) => {
    entriesRef.current = entriesRef.current.map(e =>
      e.day_of_week === dayIdx && e.count === currentCount
        ? { ...e, count: Math.max(0, parseInt(newVal) || 0) }
        : e
    )
    setChanged(true)
    setRenderTick(t => t + 1)
  }

  const renderGroupCard = (group, dayIdx) => {
    const groupKey = `${dayIdx}_${group.count}`
    const isAdding = groupAddOpen === groupKey
    return (
      <div key={groupKey} className="group-card">
        <div className="group-centres-row">
          {group.entries.map(e => {
            const centreList = parseCentres(e.centre)
            return centreList.map((c, ci) => (
              <span key={`${e.id || 't'}-${ci}`} className="group-chip">
                <MapPin size={10} />
                {c}
                {canCreate && <button className="group-chip-x" onClick={() => removeFromGroup(e, c)}><X size={9} /></button>}
              </span>
            ))
          })}
          {canCreate && (
            <button className="group-add-chip" onClick={() => { setGroupAddOpen(isAdding ? null : groupKey); setGroupAddCentres([]); setGroupAddCount(1) }}>
              <Plus size={10} /> Add
            </button>
          )}
        </div>
        <div className="group-actions-row">
          <div className="group-count-wrap">
            <span className="group-count-label">Count</span>
            {canWrite ? (
              <input type="number" min="0" className="group-count-input" value={group.count} onChange={ev => updateGroupCount(dayIdx, group.count, ev.target.value)} />
            ) : (
              <span className="group-count-display">{group.count}</span>
            )}
          </div>
        </div>
        {canWrite && group.entries.map(e => {
          if (!e.id) return null
          const centreList = parseCentres(e.centre)
          return centreList.filter(c => (childMap[c] || []).length > 0).map(c => {
            const hasDist = distRef.current[e.id] !== undefined || (savedDistRef.current[e.id] !== undefined && !toggledOffRef.current.has(e.id))
            const dist = hasDist ? (distRef.current[e.id] || savedDistRef.current[e.id]) : null
            const childSum = dist ? Object.values(dist).reduce((s, v) => s + v, 0) : 0
            const children = childMap[c] || []
            return (
              <div key={`dist-${e.id}-${c}`} className="group-dist-section">
                <button className={`group-dist-btn ${hasDist ? 'active' : ''}`} onClick={() => toggleDistEntry(e.id)}>
                  ⬇ {c}
                </button>
                {hasDist && (
                  <div className="group-dist-children">
                    {children.map(child => (
                      <div key={child} className="group-dist-child">
                        <span className="group-dist-child-name">{child}</span>
                        <input type="number" min="0" className="group-dist-input" value={dist?.[child] || 0} onChange={ev => updateDistChild(e.id, child, ev.target.value)} />
                      </div>
                    ))}
                    <div className="group-dist-sum">
                      <span>Total</span>
                      <span className={childSum !== e.count ? 'mismatch' : ''}>{childSum} / {e.count}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        })}
        {isAdding && canCreate && (
          <div className="group-add-bar">
            <MultiSelectCentres centres={centres} selected={groupAddCentres} onChange={setGroupAddCentres} placeholder="Add centres..." />
            <input type="number" min="1" className="group-add-count-input" value={groupAddCount} onChange={e => setGroupAddCount(Math.max(1, parseInt(e.target.value) || 1))} />
            <button className="group-add-confirm" onClick={() => { addCentresToGroup(dayIdx, groupAddCount, groupAddCentres); setGroupAddCentres([]); setGroupAddCount(1); setGroupAddOpen(null) }} disabled={groupAddCentres.length === 0}><Plus size={12} /></button>
            <button className="group-add-cancel" onClick={() => { setGroupAddCentres([]); setGroupAddCount(1); setGroupAddOpen(null) }}><X size={12} /></button>
          </div>
        )}
      </div>
    )
  }

  const renderNewRow = (r, ri, dayIdx) => (
    <div key={`new-${ri}`} className="group-card group-card-new">
      <div className="group-centres-row">
        <MultiSelectCentres centres={centres} selected={r.centres} onChange={val => updateNewRow(dayIdx, ri, 'centres', val)} placeholder="Select centres..." />
      </div>
      <div className="group-actions-row">
        <div className="group-count-wrap">
          <span className="group-count-label">Count</span>
          <input type="number" min="1" className="group-count-input" value={r.count} onChange={e => updateNewRow(dayIdx, ri, 'count', Math.max(1, parseInt(e.target.value) || 1))} />
        </div>
        <button className="group-delete-btn" onClick={() => removeNewRow(dayIdx, ri)}><X size={12} /> Delete</button>
      </div>
    </div>
  )

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
          const dayGroups = groupsByDay[dayIdx] || []
          const dayNewRows = deptNewRows[dayIdx] || []
          return (
            <div key={dayIdx} className="bhati-day-section">
              <div className="bhati-day-header">
                <span className="bhati-day-label">{DAYS_FULL[dayIdx]}</span>
                {canCreate && (
                  <button className="bhati-add-row-btn" onClick={() => addNewRow(dayIdx)}>
                    <Plus size={14} /> Add Group
                  </button>
                )}
              </div>

              {dayGroups.length === 0 && dayNewRows.length === 0 ? (
                <p className="bhati-day-empty">—</p>
              ) : (
                <>
                  {dayGroups.map(group => renderGroupCard(group, dayIdx))}
                  {canWrite && dayNewRows.map((r, ri) => renderNewRow(r, ri, dayIdx))}
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
      const entryDept = departments[0] || (!isBhati && schedule.title?.startsWith('Specific - ') ? schedule.title.split(' - ')[1] : null) || null
      for (const e of entriesRef.current) {
        if (e._temp) {
          const { data: existing } = await supabase
            .from('jatha_schedule_entries')
            .select('id, count')
            .eq('schedule_id', schedule.id)
            .eq('department', entryDept)
            .eq('centre', e.centre)
            .maybeSingle()
          if (existing) {
            const { error: updErr } = await supabase.from('jatha_schedule_entries').update({ count: existing.count + e.count }).eq('id', existing.id)
            if (updErr) { alert('Failed to update entry. Please try again.'); console.error(updErr); setSaving(false); return }
          } else {
            const { error } = await supabase.from('jatha_schedule_entries').insert({
              schedule_id: schedule.id, day_of_week: null, department: entryDept, centre: e.centre, count: e.count, created_by: user?.id
            })
            if (error) { alert('Failed to add entry. Please try again.'); console.error(error); setSaving(false); return }
          }
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

      {showModal && createPortal(
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
        </div>,
        document.body
      )}
    </>
  )
}

export default function ScheduleManager({ profile, hasPermission }) {
  const [loading, setLoading] = useState(true)
  const [schedules, setSchedules] = useState([])
  const [entriesMap, setEntriesMap] = useState({})
  const [centres, setCentres] = useState([])
  const [consolidatedEntries, setConsolidatedEntries] = useState([])
  const [specificConsolidated, setSpecificConsolidated] = useState([])
  const [showBhati, setShowBhati] = useState(false)
  const [showSpecific, setShowSpecific] = useState(false)
  const [plannerRefresh, setPlannerRefresh] = useState(0)

  const canWrite = profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.ASO || (hasPermission && hasPermission('schedule_distribute'))
  const canCreate = profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.ASO

  const fetchSchedules = useCallback(async () => {
    setLoading(true)
    let centresData = []
    try { const { data } = await supabase.rpc('get_user_accessible_centres'); centresData = data || [] } catch (_) { centresData = [] }
    const centresList = centresData.map(r => ({ name: r.centre_name }))
    setCentres(centresList)

    const curYear = new Date().getFullYear()
    const schedRes = await supabase
      .from('jatha_schedules')
      .select('*')
      .or(`year.gte.${curYear - 1},to_date.gte.${curYear - 1}-01-01`)
      .order('created_at', { ascending: false })
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
