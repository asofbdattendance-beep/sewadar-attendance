import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, ROLES, SESSION_STATUS, formatDateIndian, getLocalDate } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { logAction } from '../lib/logger'
import { useToast } from '../components/Toast'
import { Users, Search, Plus, AlertTriangle, CheckCircle, Calendar, MapPin, Briefcase, ChevronDown, X, DoorOpen, Truck, RefreshCw, Shield } from 'lucide-react'

const JATHA_TYPES = [
  { value: 'beas', label: 'BEAS' },
  { value: 'major_centre', label: 'Major Centre' },
  { value: 'jatha_home', label: 'Jatha Home' },
]

const MAX_JATHA_DAYS = 10


function GateEntryForm({ onSuccess }) {
  const { profile } = useAuth()
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
  const [validationMsg, setValidationMsg] = useState('')
  const [allowOtherCentres, setAllowOtherCentres] = useState(false)
  const [childCentres, setChildCentres] = useState([])
  const searchTimeout = useRef(null)
  const gateSearchTickRef = useRef(0)

  useEffect(() => {
    if (profile?.centre) {
      supabase.rpc('get_user_accessible_centres').then(({ data }) => {
        setChildCentres((data || []).map(r => r.centre_name).filter(c => c !== profile.centre))
      }).catch(() => {})
    }
  }, [profile?.centre])

  const resetForm = () => {
    setEntries([])
    setSelectedSewadar(null)
    setSearchTerm('')
    setSearchResults([])
    setSubmitResult(null)
    setValidationErrors({})
    setDbOverlaps({})
    setValidationMsg('')
  }

  const addEntry = () => {
    const today = getLocalDate()
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

  const updateEntry = async (id, field, value) => {
    setEntries(entries => entries.map(e => e.id === id ? { ...e, [field]: value } : e))
    
    const updatedEntry = entries.find(e => e.id === id)
    if (updatedEntry) {
      const updated = { ...updatedEntry, [field]: value }
      const entryErrors = validateSingleEntry(updated)
      setValidationErrors(prev => ({ ...prev, [id]: entryErrors }))
      
      if (selectedSewadar) {
        try {
          await checkDbOverlaps(selectedSewadar.badge_number, id, updated)
        } catch (e) {
          console.error('DB overlap check error:', e)
        }
      }
    }
  }

  const MAX_HOURS_PER_DAY = 16
  const MAX_DAYS = 7

  const validateSingleEntry = (entry) => {
    const errors = []
    if (!entry.inDate || !entry.inTime) errors.push('IN date/time required')
    if (!entry.outDate || !entry.outTime) errors.push('OUT date/time required')
    if (entry.inDate && entry.outDate && entry.outDate < entry.inDate) {
      errors.push('OUT must be after IN')
    }
    if (entry.inDate && entry.outDate && entry.inDate === entry.outDate && entry.inTime && entry.outTime && entry.outTime <= entry.inTime) {
      errors.push('OUT time must be after IN time on same date')
    }
    if (entry.inDate && entry.outDate && entry.inTime && entry.outTime) {
      const inDt = new Date(`${entry.inDate}T${entry.inTime}`)
      const outDt = new Date(`${entry.outDate}T${entry.outTime}`)
      const hours = (outDt - inDt) / (1000 * 60 * 60)
      if (hours > MAX_HOURS_PER_DAY) {
        errors.push(`Duration exceeds ${MAX_HOURS_PER_DAY}h - verify IN/OUT times`)
      }
      const days = Math.ceil((outDt - inDt) / (1000 * 60 * 60 * 24))
      if (days > MAX_DAYS) {
        errors.push(`Entry spans ${days} days - exceeds ${MAX_DAYS} day limit`)
      }
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

    try {
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
    } catch (err) {
      console.error('DB overlap check error:', err)
    }
  }

  const searchSewadars = async (query) => {
    if (!query || query.length < 2) {
      setSearchResults([])
      return
    }

    const tick = ++gateSearchTickRef.current
    setSearchLoading(true)
    const term = query.replace(/[%_]/g, '').toUpperCase().slice(0, 50)

    try {
      if (profile?.centre && !allowOtherCentres) {
        const childNames = childCentres
        const allowed = [profile.centre, ...childNames].filter(Boolean)
        const q = supabase.from('sewadars').select('*').in('centre', allowed).or(`badge_number.ilike.%${term}%,sewadar_name.ilike.%${term}%`).limit(20)
        const { data } = await q
        if (tick !== gateSearchTickRef.current) return
        const existing = entries.map(e => e.badge_number)
        setSearchResults((data || []).filter(s => !existing.includes(s.badge_number)))
      } else {
        const { data } = await supabase.rpc('search_sewadars_all', { p_term: term })
        if (tick !== gateSearchTickRef.current) return
        setSearchResults(data || [])
      }
    } catch (err) {
      console.error('Gate sewadar search error:', err)
    } finally {
      if (tick === gateSearchTickRef.current) setSearchLoading(false)
    }
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

    const today = getLocalDate()
    setEntries([{
      id: Date.now(),
      inDate: today,
      inTime: '09:00',
      outDate: today,
      outTime: '18:00',
    }])
  }

  const validateEntries = async () => {
    if (!selectedSewadar) {
      setValidationMsg('Please select a sewadar first')
      return 'Select a sewadar first'
    }
    if (entries.length === 0) {
      setValidationMsg('Please add at least one entry')
      return 'Add at least one entry'
    }

    const errors = {}
    let firstError = ''
    const hasErrors = entries.some(entry => {
      const entryErrors = validateSingleEntry(entry)
      if (entryErrors.length > 0) {
        errors[entry.id] = entryErrors
        if (!firstError) firstError = entryErrors[0]
        return true
      }
      
      const formOverlap = checkFormOverlaps(entry.id)
      if (formOverlap) {
        errors[entry.id] = [formOverlap]
        if (!firstError) firstError = formOverlap
        return true
      }
      return false
    })

    if (hasErrors) {
      setValidationErrors(errors)
      setValidationMsg(firstError)
      return { errors, msg: firstError }
    }
    
    // Check DB overlaps from state
    const overlapKeys = Object.keys(dbOverlaps)
    if (overlapKeys.length > 0) {
      return { errors: dbOverlaps, msg: 'Overlaps with existing sessions' }
    }

    setValidationMsg('')
    return null
  }

  const submitEntries = async () => {
    const result = await validateEntries()
    if (result) {
      toast.error(result.msg || 'Please fix validation errors before submitting')
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

      const firstEntry = entries[0]
      toast.success(`${records.length} entries added!`)
      logAction(profile?.badge_number, profile?.name, 'GATE_ENTRY', { 
        count: records.length, 
        centre: profile?.centre || selectedSewadar.centre || 'UNKNOWN',
        duty_type: firstEntry.inDate === firstEntry.outDate ? 'DAILY' : 'WATCH_AND_WARD',
        from_date: firstEntry.inDate,
        to_date: firstEntry.outDate
      })
      setSubmitResult({ success: true, count: records.length })
      setValidationErrors({})
      setValidationMsg('')
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

      {validationMsg && (
        <div className="overlap-warning">
          <AlertTriangle size={16} />
          <span>{validationMsg}</span>
        </div>
      )}

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

          {profile && (
            <label className="checkbox-label" style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={allowOtherCentres} onChange={e => { setAllowOtherCentres(e.target.checked); setSearchTerm('') }} />
              <span>Allow other centres (not default)</span>
            </label>
          )}

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
                {selectedSewadar?.centre && selectedSewadar.centre !== profile?.centre && (
                  <span className="detail-item guest-badge-gate">Guest</span>
                )}
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

function JathaEntryForm({ onSuccess }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [jathaType, setJathaType] = useState('')
  const [jathas, setJathas] = useState([])
  const [selectedJatha, setSelectedJatha] = useState(null)
  const [showJathaDropdown, setShowJathaDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [fetchError, setFetchError] = useState('')

  const [sewadars, setSewadars] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchTimeout = useRef(null)
  const searchTickRef = useRef(0)

  const [jathaSearchTerm, setJathaSearchTerm] = useState('')
  const [jathaChildCentres, setJathaChildCentres] = useState([])

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [remarks, setRemarks] = useState('')

  useEffect(() => {
    if (profile?.centre && profile?.role !== ROLES.SUPER_ADMIN) {
      supabase.rpc('get_user_accessible_centres').then(({ data }) => {
        setJathaChildCentres((data || []).map(r => r.centre_name).filter(c => c !== profile.centre))
      }).catch(() => {})
    }
  }, [profile?.centre, profile?.role])

  const resetForm = () => {
    setSelectedJatha(null)
    setJathaType('')
    setSewadars([])
    setSearchTerm('')
    setSearchResults([])
    setJathaSearchTerm('')
    setFromDate('')
    setToDate('')
    setSubmitResult(null)
    setWarnings([])
    setFetchError('')
  }

  useEffect(() => {
    if (!jathaType) { setJathas([]); return }
    fetchJathas()
  }, [jathaType])

  const fetchJathas = async () => {
    setLoading(true)
    setFetchError('')
    setShowJathaDropdown(false)
    const { data, error } = await supabase
      .from('jatha_master')
      .select('*')
      .eq('jatha_type', jathaType)
      .eq('is_active', true)
      .order('centre_name')
      .order('department')
    if (error) {
      console.error('Failed to load jathas:', error)
      setFetchError(error.message || 'Failed to load jathas')
      setJathas([])
    } else {
      setJathas(data || [])
    }
    setLoading(false)
    setShowJathaDropdown(true)
  }

  const searchSewadars = async (query) => {
    if (!query || query.length < 2) { setSearchResults([]); return }
    const tick = ++searchTickRef.current
    setSearchLoading(true)
    const term = query.replace(/[%_]/g, '').toUpperCase().slice(0, 50)

    try {
      let q = supabase.from('sewadars')
        .select('*')
        .or(`badge_number.ilike.%${term}%,sewadar_name.ilike.%${term}%`)
        .limit(20)

      if (profile?.centre && profile?.role !== ROLES.SUPER_ADMIN) {
        const allowed = [profile.centre, ...jathaChildCentres].filter(Boolean)
        q = q.in('centre', allowed)
      }

      const { data } = await q
      if (tick !== searchTickRef.current) return
      const existingBadges = sewadars.map(s => s.badge_number)
      const filtered = (data || []).filter(s => !existingBadges.includes(s.badge_number))
      setSearchResults(filtered)
    } catch (err) {
      console.error('Jatha sewadar search error:', err)
    } finally {
      if (tick === searchTickRef.current) setSearchLoading(false)
    }
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
    const todayStr = today.toLocaleDateString('en-CA')
    const from = new Date(fromDate)
    const to = new Date(toDate)

    if (fromDate && fromDate > todayStr) return 'FROM DATE cannot be in the future'
    if (toDate && toDate > todayStr) return 'TO DATE cannot be in the future'
    if (fromDate && toDate) {
      if (fromDate > toDate) return 'FROM DATE must be before or equal to TO DATE'
      const diffDays = Math.ceil((to - from) / (1000 * 60 * 60 * 24))
      if (diffDays > MAX_JATHA_DAYS) return `Maximum ${MAX_JATHA_DAYS} days between FROM and TO date`
    }

    return null
  }

  const checkForDuplicates = async () => {
    if (!fromDate || !toDate || sewadars.length === 0) return []
    const duplicates = []
    for (const sewadar of sewadars) {
      try {
        const { data } = await supabase
          .from('jatha_attendance')
          .select(`from_date, to_date, jatha_master!jatha_id(centre_name)`)
          .eq('badge_number', sewadar.badge_number)
          .lte('from_date', toDate)
          .gte('to_date', fromDate)

        if (data && data.length > 0) {
          duplicates.push({
            name: sewadar.sewadar_name,
            badge: sewadar.badge_number,
            existingFrom: data[0].from_date,
            existingTo: data[0].to_date,
            destination: data[0].jatha_master?.centre_name || 'Unknown'
          })
        }
      } catch (err) {
        console.error('Duplicate check error:', err)
      }
    }
    return duplicates
  }

  const checkForAttendanceOverlap = async () => {
    if (!fromDate || !toDate || sewadars.length === 0) return []
    const overlaps = []
    for (const sewadar of sewadars) {
      try {
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
      } catch (err) {
        console.error('Attendance overlap check error:', err)
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
          message: `${d.name} already has a jatha entry (${d.destination}) from ${formatDateIndian(d.existingFrom)} to ${formatDateIndian(d.existingTo)}`
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
    
    // Check required remarks for jatha_home
    if (jathaType === 'jatha_home' && !remarks?.trim()) {
      toast.error('Remarks is required for Jatha Home')
      return
    }

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
      toast.error('Cannot submit: Please resolve warnings first')
      return
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
        centre: selectedJatha.centre_name,
        remarks: remarks?.trim() || null,
        entered_by_badge: profile.badge_number,
        entered_by_name: profile.name,
      }))

      const { data, error: insertError } = await supabase
        .from('jatha_attendance')
        .insert(records)
        .select('id')

      if (insertError) throw insertError
      toast.success(`${records.length} sewadars added to jatha!`)
      logAction(profile?.badge_number, profile?.name, 'JATHA_ENTRY', {
        count: records.length,
        jatha_id: selectedJatha?.id,
        jatha_centre: selectedJatha?.centre_name,
        jatha_department: selectedJatha?.department,
        from_date: fromDate,
        to_date: toDate
      })
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
                <input type="text" placeholder="Search jatha..." value={jathaSearchTerm} onChange={e => setJathaSearchTerm(e.target.value)} onFocus={() => setShowJathaDropdown(true)} />
                <ChevronDown size={16} />
              </div>

              {showJathaDropdown && (
                <>
                  <div className="dropdown-overlay" onClick={() => setShowJathaDropdown(false)} />
                  <div className="search-results-gate jatha-dropdown">
                    {loading ? <div className="loading-text">Loading...</div> :
                      fetchError ? <div className="no-results" style={{ color: 'var(--red)' }}>{fetchError}</div> :
                      (() => {
                        const term = jathaSearchTerm.toUpperCase()
                        const filtered = term ? jathas.filter(j => j.centre_name.toUpperCase().includes(term) || j.department.toUpperCase().includes(term)) : jathas
                        const grouped = filtered.reduce((acc, j) => {
                          if (!acc[j.centre_name]) acc[j.centre_name] = []
                          acc[j.centre_name].push(j)
                          return acc
                        }, {})
                        return Object.keys(grouped).length > 0 ?
                          Object.entries(grouped).map(([centre, items]) => (
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
                      })()
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
                      <input type="date" value={fromDate} max={getLocalDate()}
                        onChange={e => { setFromDate(e.target.value); setWarnings([]) }} />
                    </div>
                    <div className="entry-field">
                      <label>TO DATE</label>
                      <input type="date" value={toDate} min={fromDate} max={getLocalDate()}
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

                  {/* REMARKS - Required for Jatha Home, Optional for others */}
                  <div className="entry-field" style={{ marginTop: '1rem' }}>
                    <label style={{ color: jathaType === 'jatha_home' ? 'var(--error)' : 'var(--text-muted)' }}>
                      Remarks {jathaType === 'jatha_home' && <span style={{ color: 'var(--error)' }}>*</span>}
                    </label>
                    <input
                      type="text"
                      placeholder={jathaType === 'jatha_home' ? 'Enter remarks (required)' : 'Enter remarks (optional)'}
                      value={remarks}
                      onChange={e => setRemarks(e.target.value)}
                    />
                  </div>

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

                  <button className="submit-gate-btn" onClick={submitJathaAttendance} disabled={submitting || (jathaType === 'jatha_home' && !remarks?.trim())}>
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
  const { profile, hasPermission } = useAuth()
  const canGate = hasPermission('allow_gate_entry')
  const canJatha = hasPermission('allow_jatha')
  const [activeTab, setActiveTab] = useState(canGate ? 'gate' : 'jatha')

  return (
    <div className="page pb-nav">
      <div className="header">
        <h2>Attendance Entry</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Mark attendance for sewadars
        </p>
      </div>

      <div className="tab-container">
        {canGate && (
          <button className={`tab-btn ${activeTab === 'gate' ? 'active' : ''}`} onClick={() => setActiveTab('gate')}>
            <DoorOpen size={16} />
            Gate Entry
          </button>
        )}
        {canJatha && (
          <button className={`tab-btn ${activeTab === 'jatha' ? 'active' : ''}`} onClick={() => setActiveTab('jatha')}>
            <Truck size={16} />
            Jatha Entry
          </button>
        )}
      </div>

{activeTab === 'gate' && canGate && <GateEntryForm />}
{activeTab === 'jatha' && canJatha && <JathaEntryForm />}
    </div>
  )
}
