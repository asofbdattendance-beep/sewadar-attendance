import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, ROLES, SESSION_STATUS, formatDateIndian } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'
import { Users, Search, Plus, AlertTriangle, CheckCircle, Calendar, MapPin, Briefcase, ChevronDown, X, DoorOpen, Truck, RefreshCw, Shield } from 'lucide-react'

const JATHA_TYPES = [
  { value: 'beas', label: 'BEAS' },
  { value: 'major_centre', label: 'Major Centre' },
  { value: 'jatha_home', label: 'Jatha Home' },
]

const MAX_JATHA_DAYS = 30
const MAX_PAST_DAYS = 7

function GateEntryForm({ profile, onSuccess }) {
  const toast = useToast()
  const [entries, setEntries] = useState([])
  const [selectedSewadar, setSelectedSewadar] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [validationErrors, setValidationErrors] = useState({})
  const [dbOverlaps, setDbOverlaps] = useState({})
  const searchTimeout = useRef(null)

  const resetForm = () => {
    setEntries([])
    setSelectedSewadar(null)
    setSearchTerm('')
    setSearchResults([])
    setSubmitResult(null)
    setValidationErrors({})
    setDbOverlaps({})
  }

  const addEntry = () => {
    const today = new Date().toISOString().split('T')[0]
    setEntries([...entries, {
      id: Date.now(),
      inDate: today,
      inTime: '09:00',
      outDate: today,
      outTime: '18:00',
    }])
  }

  const removeEntry = (id) => {
    setEntries(entries.filter(e => e.id !== id))
    setValidationErrors(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setDbOverlaps(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const updateEntry = (id, field, value) => {
    setEntries(entries => entries.map(e => e.id === id ? { ...e, [field]: value } : e))
    
    const updatedEntry = entries.find(e => e.id === id)
    if (updatedEntry) {
      const updated = { ...updatedEntry, [field]: value }
      const entryErrors = validateSingleEntry(updated)
      setValidationErrors(prev => ({ ...prev, [id]: entryErrors }))
      
      if (selectedSewadar) {
        checkDbOverlaps(selectedSewadar.badge_number, id, updated)
      }
    }
  }

  const validateSingleEntry = (entry) => {
    const errors = []
    if (!entry.inDate || !entry.inTime) errors.push('IN date/time required')
    if (!entry.outDate || !entry.outTime) errors.push('OUT date/time required')
    if (entry.inDate && entry.outDate && entry.outDate < entry.inDate) {
      errors.push('OUT must be after IN')
    }
    return errors
  }

  const checkFormOverlaps = (currentId) => {
    const current = entries.find(e => e.id === currentId)
    if (!current || !current.inDate || !current.outDate) return

    const currentIn = new Date(`${current.inDate}T${current.inTime || '00:00'}`)
    const currentOut = new Date(`${current.outDate}T${current.outTime || '23:59'}`)

    for (const entry of entries) {
      if (entry.id === currentId) continue
      if (!entry.inDate || !entry.outDate) continue

      const entryIn = new Date(`${entry.inDate}T${entry.inTime || '00:00'}`)
      const entryOut = new Date(`${entry.outDate}T${entry.outTime || '23:59'}`)

      if (currentIn < entryOut && currentOut > entryIn) {
        return `Overlaps with entry ${entry.inDate} to ${entry.outDate}`
      }
    }
    return null
  }

  const checkDbOverlaps = async (badgeNumber, entryId, entry) => {
    if (!entry.inDate || !entry.outDate) return

    const { data } = await supabase
      .from('attendance_sessions')
      .select('id, in_date, in_time, out_date, out_time, status')
      .eq('badge_number', badgeNumber)
      .or('status.eq.OPEN,status.eq.CLOSED')

    if (!data) return

    const entryIn = new Date(`${entry.inDate}T${entry.inTime || '00:00'}`)
    const entryOut = new Date(`${entry.outDate}T${entry.outTime || '23:59'}`)

    for (const session of data) {
      const sessionIn = new Date(`${session.in_date}T${session.in_time || '00:00'}`)
      const sessionOut = session.out_date 
        ? new Date(`${session.out_date}T${session.out_time || '23:59'}`)
        : null

      if (sessionOut) {
        if (entryIn < sessionOut && entryOut > sessionIn) {
          setDbOverlaps(prev => ({
            ...prev,
            [entryId]: `${session.in_date} to ${session.out_date} (CLOSED)`
          }))
          return
        }
      } else {
        if (entryOut > sessionIn) {
          setDbOverlaps(prev => ({
            ...prev,
            [entryId]: `${session.in_date} (OPEN - inside since ${session.in_time})`
          }))
          return
        }
      }
    }

    setDbOverlaps(prev => {
      const next = { ...prev }
      delete next[entryId]
      return next
    })
  }

  const searchSewadars = async (query) => {
    if (!query || query.length < 2) {
      setSearchResults([])
      return
    }

    setSearchLoading(true)
    const term = query.replace(/[%_]/g, '').toUpperCase().slice(0, 50)

    let q = supabase.from('sewadars')
      .select('*')
      .or(`badge_number.ilike.%${term}%,sewadar_name.ilike.%${term}%`)
      .limit(10)

    if (profile?.role === ROLES.SC_SP_USER && profile?.centre) {
      q = q.eq('centre', profile.centre)
    }

    const { data } = await q
    setSearchResults(data || [])
    setSearchLoading(false)
  }

  const handleSearchChange = (e) => {
    const val = e.target.value
    setSearchTerm(val)

    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => searchSewadars(val), 300)
  }

  const selectSewadar = async (sewadar) => {
    setSelectedSewadar(sewadar)
    setSearchTerm('')
    setSearchResults([])
    setEntries([])
    setValidationErrors({})
    setDbOverlaps({})

    const today = new Date().toISOString().split('T')[0]
    setEntries([{
      id: Date.now(),
      inDate: today,
      inTime: '09:00',
      outDate: today,
      outTime: '18:00',
    }])
  }

  const validateEntries = async () => {
    if (!selectedSewadar) return 'Select a sewadar first'
    if (entries.length === 0) return 'Add at least one entry'

    const errors = {}
    const hasErrors = entries.some(entry => {
      const entryErrors = validateSingleEntry(entry)
      if (entryErrors.length > 0) {
        errors[entry.id] = entryErrors
        return true
      }
      
      const formOverlap = checkFormOverlaps(entry.id)
      if (formOverlap) {
        errors[entry.id] = [formOverlap]
        return true
      }
      return false
    })

    if (hasErrors) {
      setValidationErrors(errors)
      return 'Validation failed'
    }

    return null
  }

  const submitEntries = async () => {
    const error = await validateEntries()
    if (error) return

    const hasDbOverlaps = Object.keys(dbOverlaps).length > 0
    if (hasDbOverlaps) {
      toast.error('Cannot submit: Overlaps with existing sessions')
      return
    }

    setSubmitting(true)
    setSubmitResult(null)

    try {
      // Fresh overlap check immediately before insert (race condition prevention)
      const { data: freshSessions } = await supabase
        .from('attendance_sessions')
        .select('id, in_date, in_time, out_date, out_time, status')
        .eq('badge_number', selectedSewadar.badge_number)
        .or('status.eq.OPEN,status.eq.CLOSED')

      if (freshSessions) {
        for (const entry of entries) {
          const entryIn = new Date(`${entry.inDate}T${entry.inTime || '00:00'}`)
          const entryOut = new Date(`${entry.outDate}T${entry.outTime || '23:59'}`)

          for (const session of freshSessions) {
            const sessionIn = new Date(`${session.in_date}T${session.in_time || '00:00'}`)
            const sessionOut = session.out_date
              ? new Date(`${session.out_date}T${session.out_time || '23:59'}`)
              : null

            if (sessionOut) {
              if (entryIn < sessionOut && entryOut > sessionIn) {
                throw new Error(`Session overlap: ${session.in_date} to ${session.out_date}`)
              }
            } else {
              if (entryOut > sessionIn) {
                throw new Error(`Session conflict: ${session.in_date} (OPEN - inside since ${session.in_time})`)
              }
            }
          }
        }
      }

      const records = entries.map(entry => ({
        badge_number: selectedSewadar.badge_number,
        sewadar_name: selectedSewadar.sewadar_name,
        centre: profile?.centre || selectedSewadar.centre || 'UNKNOWN',
        duty_type: entry.inDate === entry.outDate ? 'DAILY' : 'WATCH_AND_WARD',
        status: SESSION_STATUS.CLOSED,
        in_date: entry.inDate,
        in_time: entry.inTime,
        out_date: entry.outDate,
        out_time: entry.outTime,
        in_scanner_badge: profile?.badge_number,
        in_scanner_name: profile?.name,
        in_scanner_centre: profile?.centre || selectedSewadar.centre || 'UNKNOWN',
        out_scanner_badge: profile?.badge_number,
        out_scanner_name: profile?.name,
        out_scanner_centre: profile?.centre || selectedSewadar.centre || 'UNKNOWN',
        is_manual: true,
        is_gate_entry: true,
        entered_by_badge: profile?.badge_number,
        entered_by_name: profile?.name,
        updated_at: new Date().toISOString(),
      }))

      const { data, error: insertError } = await supabase
        .from('attendance_sessions')
        .insert(records)
        .select('id')

      if (insertError) throw insertError

      toast.success(`${records.length} entries added!`)
      setSubmitResult({ success: true, count: records.length })
      setTimeout(() => {
        resetForm()
        setSubmitResult(null)
      }, 2000)

    } catch (err) {
      toast.error(err.message || 'Failed to save entries')
      setSubmitResult({ success: false, error: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="entry-section">
      <div className="section-label">
        <DoorOpen size={16} />
        <span>Gate Entry - Select Sewadar</span>
      </div>

      {!selectedSewadar ? (
        <>
          <div className="search-box-gate">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search by name or badge..."
              value={searchTerm}
              onChange={handleSearchChange}
            />
          </div>

          {searchResults.length > 0 && (
            <div className="search-results-gate">
              {searchResults.map(s => (
                <div key={s.badge_number} className="result-item-gate" onClick={() => selectSewadar(s)}>
                  <div className="result-info">
                    <div className="result-name">{s.sewadar_name}</div>
                    <div className="result-badge">{s.badge_number}</div>
                  </div>
                  <Plus size={16} style={{ color: 'var(--excel-green)' }} />
                </div>
              ))}
            </div>
          )}
          {searchLoading && <div className="loading-text">Searching...</div>}
        </>
      ) : (
        <>
          <div className="selected-sewadar-gate">
            <div className="selected-info">
              <div className="selected-name">{selectedSewadar?.sewadar_name}</div>
              <div className="selected-badge">{selectedSewadar?.badge_number}</div>
              <div className="selected-details">
                <span className="detail-item">
                  <MapPin size={12} /> {selectedSewadar?.centre || '-'}
                </span>
                <span className="detail-item">
                  <Briefcase size={12} /> {selectedSewadar?.department || '-'}
                </span>
                <span className={`detail-item badge-status ${selectedSewadar?.badge_status?.toLowerCase()}`}>
                  <Shield size={12} /> {selectedSewadar?.badge_status || 'OPEN'}
                </span>
              </div>
            </div>
            <button className="change-btn-gate" onClick={resetForm}>Change</button>
          </div>

          <div className="section-label" style={{ marginTop: '1rem' }}>
            <Calendar size={14} />
            Attendance Entries
            <span className="entry-count">{entries.length}</span>
          </div>

          {entries.map(entry => (
            <div key={entry.id} className="entry-card">
              <div className="entry-card-header">
                <span>Entry {entries.indexOf(entry) + 1}</span>
                {entries.length > 1 && (
                  <button className="entry-remove" onClick={() => removeEntry(entry.id)}>
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="entry-grid">
                <div className="entry-field">
                  <label>IN DATE</label>
                  <input type="date" value={entry.inDate} onChange={e => updateEntry(entry.id, 'inDate', e.target.value)} />
                </div>
                <div className="entry-field">
                  <label>IN TIME</label>
                  <input type="time" value={entry.inTime} onChange={e => updateEntry(entry.id, 'inTime', e.target.value)} />
                </div>
                <div className="entry-field">
                  <label>OUT DATE</label>
                  <input type="date" value={entry.outDate} min={entry.inDate} onChange={e => updateEntry(entry.id, 'outDate', e.target.value)} />
                </div>
                <div className="entry-field">
                  <label>OUT TIME</label>
                  <input type="time" value={entry.outTime} onChange={e => updateEntry(entry.id, 'outTime', e.target.value)} />
                </div>
              </div>

              {validationErrors[entry.id] && (
                <div className="overlap-warning">
                  {validationErrors[entry.id].map((err, i) => (
                    <div key={i}>{err}</div>
                  ))}
                </div>
              )}

              {dbOverlaps[entry.id] && (
                <div className="db-overlap-warning">
                  <AlertTriangle size={14} />
                  Overlaps with session: {dbOverlaps[entry.id]}
                </div>
              )}
            </div>
          ))}

          <button className="add-entry-btn" onClick={addEntry}>
            <Plus size={16} /> Add Another Entry
          </button>

          <button className="submit-gate-btn" onClick={submitEntries} disabled={submitting}>
            {submitting ? (
              <><div className="spinner" style={{ width: 18, height: 18 }} /> Saving...</>
            ) : (
              <><CheckCircle size={18} /> Submit {entries.length} Entry/Entries</>
            )}
          </button>
        </>
      )}
    </div>
  )
}

function JathaEntryForm({ profile, onSuccess }) {
  const toast = useToast()
  const [jathaType, setJathaType] = useState('')
  const [jathas, setJathas] = useState([])
  const [selectedJatha, setSelectedJatha] = useState(null)
  const [showJathaDropdown, setShowJathaDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [warnings, setWarnings] = useState([])

  const [sewadars, setSewadars] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchTimeout = useRef(null)

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const resetForm = () => {
    setSelectedJatha(null)
    setJathaType('')
    setSewadars([])
    setSearchTerm('')
    setSearchResults([])
    setFromDate('')
    setToDate('')
    setSubmitResult(null)
    setWarnings([])
  }

  useEffect(() => {
    if (!jathaType) { setJathas([]); return }
    fetchJathas()
  }, [jathaType])

  const fetchJathas = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('jatha_master')
      .select('*')
      .eq('jatha_type', jathaType)
      .eq('is_active', true)
      .order('centre_name')
      .order('department')
    setJathas(data || [])
    setLoading(false)
  }

  const searchSewadars = async (query) => {
    if (!query || query.length < 2) { setSearchResults([]); return }
    setSearchLoading(true)
    const term = query.replace(/[%_]/g, '').toUpperCase().slice(0, 50)

    let q = supabase.from('sewadars')
      .select('*')
      .or(`badge_number.ilike.%${term}%,sewadar_name.ilike.%${term}%`)
      .limit(10)

    if (profile?.role === ROLES.SC_SP_USER && profile?.centre) {
      q = q.eq('centre', profile.centre)
    }

    const { data } = await q
    const existingBadges = sewadars.map(s => s.badge_number)
    const filtered = (data || []).filter(s => !existingBadges.includes(s.badge_number))
    setSearchResults(filtered)
    setSearchLoading(false)
  }

  const handleSearchChange = (e) => {
    const val = e.target.value
    setSearchTerm(val)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => searchSewadars(val), 300)
  }

  const addSewadar = (sewadar) => {
    setSewadars(prev => [...prev, sewadar])
    setSearchTerm('')
    setSearchResults([])
  }

  const removeSewadar = (badgeNumber) => {
    setSewadars(prev => prev.filter(s => s.badge_number !== badgeNumber))
  }

  const checkDateValidations = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]
    const from = new Date(fromDate)
    const to = new Date(toDate)

    if (fromDate && fromDate > todayStr) return 'FROM DATE cannot be in the future'
    if (toDate && toDate > todayStr) return 'TO DATE cannot be in the future'
    if (fromDate && toDate) {
      const diffDays = Math.ceil((to - from) / (1000 * 60 * 60 * 24))
      if (diffDays > MAX_JATHA_DAYS) return `Maximum ${MAX_JATHA_DAYS} days between FROM and TO date`
    }
    if (fromDate) {
      const daysDiff = Math.ceil((today - from) / (1000 * 60 * 60 * 24))
      if (daysDiff > MAX_PAST_DAYS) return `FROM DATE cannot be more than ${MAX_PAST_DAYS} days in the past`
    }
    return null
  }

  const checkForDuplicates = async () => {
    if (!selectedJatha || !fromDate || !toDate || sewadars.length === 0) return []
    const duplicates = []
    for (const sewadar of sewadars) {
      const { data } = await supabase
        .from('jatha_attendance')
        .select('*')
        .eq('jatha_id', selectedJatha.id)
        .eq('badge_number', sewadar.badge_number)
        .or(`and(from_date.lte.${toDate},to_date.gte.${fromDate})`)

      if (data && data.length > 0) {
        duplicates.push({
          name: sewadar.sewadar_name,
          badge: sewadar.badge_number,
          existingFrom: data[0].from_date,
          existingTo: data[0].to_date
        })
      }
    }
    return duplicates
  }

  const checkForAttendanceOverlap = async () => {
    if (!fromDate || !toDate || sewadars.length === 0) return []
    const overlaps = []
    for (const sewadar of sewadars) {
      const { data } = await supabase
        .from('attendance_sessions')
        .select('in_date, out_date, duty_type, is_jatha_entry')
        .eq('badge_number', sewadar.badge_number)
        .eq('is_jatha_entry', false)
        .or(`status.eq.OPEN,status.eq.CLOSED`)

      if (data) {
        for (const session of data) {
          const sessIn = new Date(session.in_date)
          const sessOut = session.out_date ? new Date(session.out_date) : new Date()
          const jathaFrom = new Date(fromDate)
          const jathaTo = new Date(toDate)

          if (sessIn <= jathaTo && sessOut >= jathaFrom) {
            overlaps.push({
              name: sewadar.sewadar_name,
              badge: sewadar.badge_number,
              sessionDate: session.in_date,
              dutyType: session.duty_type
            })
            break
          }
        }
      }
    }
    return overlaps
  }

  const validateAndCheck = async () => {
    const dateError = checkDateValidations()
    if (dateError) return { error: dateError }
    if (sewadars.length === 0) return { error: 'Please add at least one sewadar' }

    const duplicates = await checkForDuplicates()
    const overlaps = await checkForAttendanceOverlap()

    const allWarnings = []
    if (duplicates.length > 0) {
      duplicates.forEach(d => {
        allWarnings.push({
          type: 'error',
          message: `${d.name} already marked for this jatha from ${formatDateIndian(d.existingFrom)} to ${formatDateIndian(d.existingTo)}`
        })
      })
    }
    if (overlaps.length > 0) {
      overlaps.forEach(o => {
        allWarnings.push({
          type: 'warning',
          message: `${o.name} has ${o.dutyType} attendance on ${formatDateIndian(o.sessionDate)}`
        })
      })
    }
    return { warnings: allWarnings }
  }

  const submitJathaAttendance = async () => {
    if (!selectedJatha) { toast.error('Please select a jatha'); return }

    const result = await validateAndCheck()
    if (result.error) { toast.error(result.error); return }

    if (result.warnings && result.warnings.length > 0) {
      const hasErrors = result.warnings.some(w => w.type === 'error')
      if (hasErrors) {
        setWarnings(result.warnings)
        toast.error('Cannot submit: Duplicate jatha entries found')
        return
      }
      setWarnings(result.warnings)
    }

    setSubmitting(true)
    setSubmitResult(null)

    try {
      const records = sewadars.map(sewadar => ({
        jatha_id: selectedJatha.id,
        badge_number: sewadar.badge_number,
        sewadar_name: sewadar.sewadar_name,
        from_date: fromDate,
        to_date: toDate,
        entered_by_badge: profile.badge_number,
        entered_by_name: profile.name,
      }))

      const { data, error: insertError } = await supabase
        .from('jatha_attendance')
        .insert(records)
        .select('id')

      if (insertError) throw insertError
      toast.success(`${records.length} sewadars added to jatha!`)
      setSubmitResult({ success: true, count: records.length })
      setTimeout(() => { resetForm(); setSubmitResult(null) }, 2000)

    } catch (err) {
      toast.error(err.message || 'Failed to save entries')
      setSubmitResult({ success: false, error: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const groupedJathas = jathas.reduce((acc, j) => {
    if (!acc[j.centre_name]) acc[j.centre_name] = []
    acc[j.centre_name].push(j)
    return acc
  }, {})

  return (
    <div className="entry-section">
      <div className="section-label">
        <Truck size={16} />
        <span>Jatha Entry - Select Jatha Type</span>
      </div>

      <div className="duty-filters">
        {JATHA_TYPES.map(type => (
          <button key={type.value} className={`chip ${jathaType === type.value ? 'active' : ''}`}
            onClick={() => { setJathaType(type.value); setSelectedJatha(null) }}>
            {type.label}
          </button>
        ))}
      </div>

      {jathaType && (
        <>
          {!selectedJatha ? (
            <>
              <div className="search-box-gate" style={{ marginTop: '1rem' }}>
                <Search size={16} />
                <input type="text" placeholder="Search jatha..." onFocus={() => setShowJathaDropdown(true)} />
                <ChevronDown size={16} />
              </div>

              {showJathaDropdown && (
                <>
                  <div className="dropdown-overlay" onClick={() => setShowJathaDropdown(false)} />
                  <div className="search-results-gate jatha-dropdown">
                    {loading ? <div className="loading-text">Loading...</div> :
                      Object.keys(groupedJathas).length > 0 ?
                        Object.entries(groupedJathas).map(([centre, items]) => (
                          <div key={centre}>
                            <div className="jatha-centre-header">{centre}</div>
                            {items.map(j => (
                              <div key={j.id} className="result-item-gate jatha-item"
                                onClick={() => { setSelectedJatha(j); setShowJathaDropdown(false) }}>
                                <div className="result-name">{j.department}</div>
                              </div>
                            ))}
                          </div>
                        )) : <div className="no-results">No jathas found</div>
                    }
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="selected-sewadar-gate" style={{ marginTop: '1rem' }}>
                <div className="selected-info">
                  <div className="selected-name">{selectedJatha.department}</div>
                  <div className="selected-badge">{selectedJatha.centre_name}</div>
                  <span className={`jatha-type-badge ${selectedJatha.jatha_type}`}>{selectedJatha.jatha_type}</span>
                </div>
                <button className="change-btn-gate" onClick={() => setSelectedJatha(null)}>Change</button>
              </div>

              <div className="section-label" style={{ marginTop: '1rem' }}>
                <Users size={14} />
                Add Sewadars
                <span className="entry-count">{sewadars.length}</span>
              </div>

              <div className="search-box-gate">
                <Search size={16} />
                <input type="text" placeholder="Search by name or badge..." value={searchTerm} onChange={handleSearchChange} />
              </div>

              {searchResults.length > 0 && (
                <div className="search-results-gate">
                  {searchResults.map(s => (
                    <div key={s.badge_number} className="result-item-gate" onClick={() => addSewadar(s)}>
                      <div className="result-info">
                        <div className="result-name">{s.sewadar_name}</div>
                        <div className="result-badge">{s.badge_number}</div>
                      </div>
                      <Plus size={16} style={{ color: 'var(--excel-green)' }} />
                    </div>
                  ))}
                </div>
              )}
              {searchLoading && <div className="loading-text">Searching...</div>}

              {sewadars.length > 0 && (
                <div className="selected-sewadars-list">
                  {sewadars.map(s => (
                    <div key={s.badge_number} className="selected-sewadar-chip">
                      <div>
                        <div className="chip-name">{s.sewadar_name}</div>
                        <div className="chip-badge">{s.badge_number}</div>
                      </div>
                      <button className="chip-remove" onClick={() => removeSewadar(s.badge_number)}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {selectedJatha && sewadars.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <div className="section-label">
                    <Calendar size={14} />
                    Date Range
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>Max {MAX_JATHA_DAYS} days</span>
                  </div>

                  <div className="entry-grid">
                    <div className="entry-field">
                      <label>FROM DATE</label>
                      <input type="date" value={fromDate} max={new Date().toISOString().split('T')[0]}
                        onChange={e => { setFromDate(e.target.value); setWarnings([]) }} />
                    </div>
                    <div className="entry-field">
                      <label>TO DATE</label>
                      <input type="date" value={toDate} min={fromDate} max={new Date().toISOString().split('T')[0]}
                        onChange={e => { setToDate(e.target.value); setWarnings([]) }} />
                    </div>
                  </div>

                  {fromDate && toDate && (
                    <div className="date-summary">
                      <Calendar size={14} />
                      <span>{formatDateIndian(fromDate)} to {formatDateIndian(toDate)}</span>
                      <span className="duty-badge JATHA">JATHA</span>
                    </div>
                  )}

                  {warnings.length > 0 && (
                    <div className="jatha-warnings">
                      {warnings.map((w, i) => (
                        <div key={i} className={`jatha-warning ${w.type}`}>
                          <AlertTriangle size={14} />
                          <span>{w.message}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <button className="submit-gate-btn" onClick={submitJathaAttendance} disabled={submitting}>
                    {submitting ? <><div className="spinner" style={{ width: 18, height: 18 }} /> Saving...</> :
                      <><CheckCircle size={18} /> Mark {sewadars.length} Sewadar(s) for Jatha</>}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

export default function AttendanceEntryPage() {
  const [activeTab, setActiveTab] = useState('gate')

  return (
    <div className="page pb-nav">
      <div className="header">
        <h2>Attendance Entry</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Mark attendance for sewadars
        </p>
      </div>

      <div className="tab-container">
        <button className={`tab-btn ${activeTab === 'gate' ? 'active' : ''}`} onClick={() => setActiveTab('gate')}>
          <DoorOpen size={16} />
          Gate Entry
        </button>
        <button className={`tab-btn ${activeTab === 'jatha' ? 'active' : ''}`} onClick={() => setActiveTab('jatha')}>
          <Truck size={16} />
          Jatha Entry
        </button>
      </div>

      {activeTab === 'gate' && <GateEntryForm />}
      {activeTab === 'jatha' && <JathaEntryForm />}
    </div>
  )
}
