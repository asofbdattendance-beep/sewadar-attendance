import { useState, useEffect, useRef } from 'react'
import { supabase, ROLES, SESSION_STATUS, formatDateIndian, getLocalDate, getDutyType, formatTime12Hour } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { logAction } from '../lib/logger'
import { useToast } from '../components/Toast'
import { Users, Search, Plus, AlertTriangle, CheckCircle, Calendar, MapPin, Briefcase, ChevronDown, X, DoorOpen, Truck, Shield, Download } from 'lucide-react'
import * as XLSX from 'xlsx'

const JATHA_TYPES = [
  { value: 'beas', label: 'BEAS' },
  { value: 'major_centre', label: 'Major Centre' },
  { value: 'jatha_home', label: 'Jatha Home' },
]

const MAX_JATHA_DAYS = 10

const downloadOverlapExcel = (overlaps, type) => {
  if (!overlaps.length) return
  const ws = XLSX.utils.json_to_sheet(overlaps)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Overlaps')
  const colWidths = Object.keys(overlaps[0]).map(k => ({ wch: Math.max(k.length * 2, 18) }))
  ws['!cols'] = colWidths
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([data], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${type}_overlaps_${getLocalDate()}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

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
  const [submitOverlaps, setSubmitOverlaps] = useState([])
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
    setSubmitOverlaps([])
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
        const overlaps = await checkGateOverlaps(selectedSewadar.badge_number, [updated])
        setDbOverlaps(prev => {
          const next = { ...prev }
          if (overlaps.overlappingIds.has(id)) {
            next[id] = overlaps.overlaps[0]?.reason || 'Overlap detected'
          } else {
            delete next[id]
          }
          return next
        })
      }
    }
  }

  const MAX_HOURS_PER_DAY = 16
  const MAX_DAYS = 7

  const validateSingleEntry = (entry) => {
    const errors = []
    if (!entry.inDate || !entry.inTime) errors.push('IN date/time required')
    if (!entry.outDate || !entry.outTime) errors.push('OUT date/time required')
    if (entry.inDate && entry.inDate > getLocalDate()) {
      errors.push('IN date cannot be in the future')
    }
    if (entry.inDate && entry.outDate && entry.outDate < entry.inDate) {
      errors.push('OUT must be after IN')
    }
    if (entry.outDate && entry.outDate > getLocalDate()) {
      errors.push('OUT date cannot be in the future')
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

  const checkGateOverlaps = async (badgeNumber, entries) => {
    if (!entries.length) return { overlaps: [], overlappingIds: new Set() }

    const twoMonthsAgo = new Date()
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2)
    const twoMonthsAgoStr = twoMonthsAgo.toISOString().split('T')[0]

    let openRes, closedRes
    try {
      [openRes, closedRes] = await Promise.all([
        supabase.from('attendance_sessions')
          .select('id, in_date, in_time, out_date, out_time, status')
          .eq('badge_number', badgeNumber)
          .eq('status', 'OPEN'),
        supabase.from('attendance_sessions')
          .select('id, in_date, in_time, out_date, out_time, status')
          .eq('badge_number', badgeNumber)
          .eq('status', 'CLOSED')
          .gte('in_date', twoMonthsAgoStr)
      ])
    } catch (e) {
      console.error('Overlap check query failed:', e)
      return { overlaps: [], overlappingIds: new Set() }
    }

    const allSessions = [...(openRes.data || []), ...(closedRes.data || [])]
    const overlaps = []
    const overlappingIds = new Set()

    for (const entry of entries) {
      const entryIn = new Date(`${entry.inDate}T${entry.inTime || '00:00'}`)
      const entryOut = new Date(`${entry.outDate}T${entry.outTime || '23:59'}`)

      for (const session of allSessions) {
        const sessionIn = new Date(`${session.in_date}T${session.in_time || '00:00'}`)
        const sessionOut = session.out_date
          ? new Date(`${session.out_date}T${session.out_time || '23:59'}`)
          : null

        const isOpen = !sessionOut
        let isOverlapping = false

        if (isOpen) {
          // OPEN session spans to infinity → overlaps if entry end is after session start
          isOverlapping = entryOut > sessionIn
        } else {
          // CLOSED session: standard interval overlap
          isOverlapping = entryIn < sessionOut && entryOut > sessionIn
        }

        if (isOverlapping) {
          const conflictType = isOpen ? 'OPEN' : 'CLOSED'
          const reason = isOpen
            ? `Already inside since ${formatTime12Hour(session.in_time)} on ${formatDateIndian(session.in_date)}`
            : `Session from ${formatDateIndian(session.in_date)} ${formatTime12Hour(session.in_time)} to ${formatDateIndian(session.out_date)} ${formatTime12Hour(session.out_time)} overlaps`

          overlaps.push({
            entryId: entry.id,
            sewadarName: selectedSewadar?.sewadar_name || '',
            badgeNumber,
            entryInDate: formatDateIndian(entry.inDate),
            entryInTime: formatTime12Hour(entry.inTime),
            entryOutDate: formatDateIndian(entry.outDate),
            entryOutTime: formatTime12Hour(entry.outTime),
            conflictType,
            conflictInDate: formatDateIndian(session.in_date),
            conflictInTime: formatTime12Hour(session.in_time),
            conflictOutDate: session.out_date ? formatDateIndian(session.out_date) : '—',
            conflictOutTime: session.out_time ? formatTime12Hour(session.out_time) : '—',
            conflictStatus: session.status,
            reason
          })
          overlappingIds.add(entry.id)
          break // first overlap per entry is enough
        }
      }
    }

    return { overlaps, overlappingIds }
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
    if (val.length > 0) setSubmitOverlaps([])

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
    setSubmitOverlaps([])

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
    
    setValidationMsg('')
    return null
  }

  const checkLockDates = async () => {
    const uniqueDates = [...new Set(entries.flatMap(e => [e.inDate, e.outDate].filter(Boolean)))]
    for (const dateStr of uniqueDates) {
      const { data } = await supabase.rpc('is_date_locked', { p_date: dateStr })
      if (data === true) {
        return { locked: true, date: dateStr }
      }
    }
    return { locked: false }
  }

  const submitEntries = async () => {
    const result = await validateEntries()
    if (result) {
      toast.error(result.msg || 'Please fix validation errors before submitting')
      return
    }

    // Check lock dates
    const lockCheck = await checkLockDates()
    if (lockCheck.locked) {
      toast.error(`Cannot submit: ${formatDateIndian(lockCheck.date)} is in a locked period`)
      return
    }

    setSubmitting(true)
    setSubmitResult(null)
    setSubmitOverlaps([])

    try {
      // Fresh overlap check using the 2-phase approach
      const { overlaps, overlappingIds } = await checkGateOverlaps(
        selectedSewadar.badge_number, entries
      )

      const validEntries = entries.filter(e => !overlappingIds.has(e.id))

      if (validEntries.length === 0) {
        // All entries have overlaps − nothing to save
        setSubmitOverlaps(overlaps)
        toast.error('All entries have overlaps. Download the overlap report for details.')
        setSubmitting(false)
        return
      }

      // Insert only valid entries
      const records = validEntries.map(entry => ({
        badge_number: selectedSewadar.badge_number,
        sewadar_name: selectedSewadar.sewadar_name,
        centre: profile?.centre || selectedSewadar.centre || 'UNKNOWN',
        duty_type: entry.inDate === entry.outDate
          ? getDutyType(new Date(entry.inDate + 'T' + (entry.inTime || '00:00')))
          : 'WATCH_AND_WARD',
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

      const { error: insertError } = await supabase
        .from('attendance_sessions')
        .insert(records)

      if (insertError) throw insertError

      const firstEntry = validEntries[0]
      const dutyTypeUsed = firstEntry.inDate === firstEntry.outDate
        ? getDutyType(new Date(firstEntry.inDate + 'T' + (firstEntry.inTime || '00:00')))
        : 'WATCH_AND_WARD'

      logAction(profile?.badge_number, profile?.name, 'GATE_ENTRY', { 
        count: records.length, 
        centre: profile?.centre || selectedSewadar.centre || 'UNKNOWN',
        duty_type: dutyTypeUsed,
        from_date: firstEntry.inDate,
        to_date: firstEntry.outDate
      })

      if (overlappingIds.size > 0) {
        // Partial success
        setSubmitOverlaps(overlaps)
        setSubmitResult({ success: true, count: records.length, skipped: overlappingIds.size })
        setValidationErrors({})
        setValidationMsg('')
        toast.success(`${records.length} entries saved. ${overlappingIds.size} skipped due to overlap.`)
        setTimeout(() => {
          resetForm()
          setSubmitResult(null)
          setSubmitOverlaps([])
        }, 5000)
      } else {
        toast.success(`${records.length} entries added!`)
        setSubmitResult({ success: true, count: records.length })
        setValidationErrors({})
        setValidationMsg('')
        setTimeout(() => {
          resetForm()
          setSubmitResult(null)
        }, 2000)
      }

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

      {submitOverlaps.length > 0 && (
        <div className="overlap-report" style={{ marginBottom: '1rem' }}>
          <div className="overlap-report-header">
            <AlertTriangle size={16} />
            <span>{submitOverlaps.length} entr{submitOverlaps.length > 1 ? 'ies' : 'y'} skipped due to overlap</span>
          </div>
          <div className="overlap-report-list">
            {submitOverlaps.slice(0, 5).map((o, i) => (
              <div key={i} className="overlap-report-item">
                <div className="overlap-reason">{o.reason}</div>
              </div>
            ))}
            {submitOverlaps.length > 5 && (
              <div className="overlap-report-more">...and {submitOverlaps.length - 5} more</div>
            )}
          </div>
          <button className="download-overlap-btn" onClick={() => downloadOverlapExcel(submitOverlaps, 'gate')}>
            <Download size={14} /> Download Overlap Report (.xlsx)
          </button>
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
                  <input type="date" value={entry.inDate} max={getLocalDate()} onChange={e => updateEntry(entry.id, 'inDate', e.target.value)} />
                </div>
                <div className="entry-field">
                  <label>IN TIME</label>
                  <input type="time" value={entry.inTime} onChange={e => updateEntry(entry.id, 'inTime', e.target.value)} />
                </div>
                <div className="entry-field">
                  <label>OUT DATE</label>
                  <input type="date" value={entry.outDate} min={entry.inDate} max={getLocalDate()} onChange={e => updateEntry(entry.id, 'outDate', e.target.value)} />
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
  const [jathaOverlaps, setJathaOverlaps] = useState([])

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
    setJathaOverlaps([])
    setRemarks('')
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
    setJathaOverlaps([])
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
    if (!fromDate || !toDate || sewadars.length === 0) return { overlaps: [], overlappingIds: new Set() }
    const badgeNumbers = sewadars.map(s => s.badge_number)
    try {
      const { data } = await supabase
        .from('jatha_attendance')
        .select(`badge_number, from_date, to_date, jatha_master!jatha_id(centre_name)`)
        .in('badge_number', badgeNumbers)
        .lte('from_date', toDate)
        .gte('to_date', fromDate)

      const sewadarMap = {}
      sewadars.forEach(s => { sewadarMap[s.badge_number] = s })

      const overlaps = []
      const overlappingIds = new Set()
      for (const row of data || []) {
        const sewadar = sewadarMap[row.badge_number]
        if (!sewadar) continue
        const exists = overlaps.some(o => o.badge === row.badge_number)
        if (exists) continue
        overlaps.push({
          name: sewadar.sewadar_name,
          badge: sewadar.badge_number,
          existingFrom: row.from_date,
          existingTo: row.to_date,
          destination: row.jatha_master?.centre_name || 'Unknown',
          type: 'JATHA_DUPLICATE'
        })
        overlappingIds.add(row.badge_number)
      }
      return { overlaps, overlappingIds }
    } catch (err) {
      console.error('Duplicate check error:', err)
      return { overlaps: [], overlappingIds: new Set() }
    }
  }

  const checkForAttendanceOverlap = async () => {
    if (!fromDate || !toDate || sewadars.length === 0) return { overlaps: [], overlappingIds: new Set() }
    const badgeNumbers = sewadars.map(s => s.badge_number)
    try {
      const { data } = await supabase
        .from('attendance_sessions')
        .select('badge_number, in_date, out_date, duty_type')
        .in('badge_number', badgeNumbers)
        .or(`status.eq.OPEN,status.eq.CLOSED`)

      const sewadarMap = {}
      sewadars.forEach(s => { sewadarMap[s.badge_number] = s })
      const jathaFrom = new Date(fromDate)
      const jathaTo = new Date(toDate)

      const overlaps = []
      const overlappingIds = new Set()
      for (const session of data || []) {
        const sewadar = sewadarMap[session.badge_number]
        if (!sewadar) continue
        const sessIn = new Date(session.in_date)
        const sessOut = session.out_date ? new Date(session.out_date) : new Date()

        if (sessIn <= jathaTo && sessOut >= jathaFrom) {
          if (!overlappingIds.has(session.badge_number)) {
            overlaps.push({
              name: sewadar.sewadar_name,
              badge: sewadar.badge_number,
              sessionDate: session.in_date,
              dutyType: session.duty_type,
              type: 'SESSION_OVERLAP'
            })
            overlappingIds.add(session.badge_number)
          }
        }
      }
      return { overlaps, overlappingIds }
    } catch (err) {
      console.error('Attendance overlap check error:', err)
      return { overlaps: [], overlappingIds: new Set() }
    }
  }

  const checkJathaLockDates = async () => {
    const datesToCheck = [fromDate, toDate].filter(Boolean)
    for (const dateStr of datesToCheck) {
      const { data } = await supabase.rpc('is_date_locked', { p_date: dateStr })
      if (data === true) {
        return dateStr
      }
    }
    return null
  }

  const validateAndCheck = async () => {
    const dateError = checkDateValidations()
    if (dateError) return { error: dateError }
    if (sewadars.length === 0) return { error: 'Please add at least one sewadar' }

    const lockedDate = await checkJathaLockDates()
    if (lockedDate) return { error: `Cannot submit: ${formatDateIndian(lockedDate)} is in a locked period` }

    const [dupResult, sessResult] = await Promise.all([
      checkForDuplicates(),
      checkForAttendanceOverlap()
    ])

    const allOverlapIds = new Set([...dupResult.overlappingIds, ...sessResult.overlappingIds])
    const allOverlaps = [...dupResult.overlaps, ...sessResult.overlaps]

    const validSewadars = sewadars.filter(s => !allOverlapIds.has(s.badge_number))
    const skippedSewadars = sewadars.filter(s => allOverlapIds.has(s.badge_number))

    return { validSewadars, skippedSewadars, overlaps: allOverlaps, overlappingIds: allOverlapIds }
  }

  const buildJathaOverlapExcelData = (overlaps) => {
    return overlaps.map(o => ({
      'Sewadar Name': o.name,
      'Badge Number': o.badge,
      'Jatha Centre': selectedJatha?.centre_name || '',
      'Jatha Type': jathaType,
      'From Date': formatDateIndian(fromDate),
      'To Date': formatDateIndian(toDate),
      'Conflict Type': o.type === 'JATHA_DUPLICATE' ? 'Jatha Duplicate' : 'Gate Session',
      'Conflict Detail': o.type === 'JATHA_DUPLICATE'
        ? `Already in jatha: ${o.destination} from ${formatDateIndian(o.existingFrom)} to ${formatDateIndian(o.existingTo)}`
        : `Has ${o.dutyType} attendance on ${formatDateIndian(o.sessionDate)}`,
      'Reason': o.type === 'JATHA_DUPLICATE'
        ? `Overlapping jatha entry detected at ${o.destination}`
        : `Overlapping gate session detected on ${formatDateIndian(o.sessionDate)}`
    }))
  }

  const submitJathaAttendance = async () => {
    if (!selectedJatha) { toast.error('Please select a jatha'); return }
    
    if (jathaType === 'jatha_home' && !remarks?.trim()) {
      toast.error('Remarks is required for Jatha Home')
      return
    }

    const result = await validateAndCheck()
    if (result.error) { toast.error(result.error); return }

    if (result.overlappingIds.size > 0 && result.validSewadars.length === 0) {
      setJathaOverlaps(result.overlaps)
      toast.error('All sewadars have overlaps. Download the overlap report for details.')
      return
    }

    setSubmitting(true)
    setSubmitResult(null)

    try {
      const records = result.validSewadars.map(sewadar => ({
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

      const { error: insertError } = await supabase
        .from('jatha_attendance')
        .insert(records)

      if (insertError) throw insertError

      logAction(profile?.badge_number, profile?.name, 'JATHA_ENTRY', {
        count: records.length,
        jatha_id: selectedJatha?.id,
        jatha_centre: selectedJatha?.centre_name,
        jatha_department: selectedJatha?.department,
        from_date: fromDate,
        to_date: toDate
      })

      if (result.overlappingIds.size > 0) {
        setJathaOverlaps(result.overlaps)
        setSubmitResult({ success: true, count: records.length, skipped: result.overlappingIds.size })
        toast.success(`${records.length} sewadars added. ${result.overlappingIds.size} skipped due to overlap.`)
        setTimeout(() => {
          resetForm()
          setSubmitResult(null)
          setJathaOverlaps([])
        }, 5000)
      } else {
        toast.success(`${records.length} sewadars added to jatha!`)
        setSubmitResult({ success: true, count: records.length })
        setTimeout(() => { resetForm(); setSubmitResult(null) }, 2000)
      }
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
            onClick={() => { setJathaType(type.value); setSelectedJatha(null); setJathaOverlaps([]) }}>
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
                        onChange={e => { setFromDate(e.target.value); setWarnings([]); setJathaOverlaps([]) }} />
                    </div>
                    <div className="entry-field">
                      <label>TO DATE</label>
                      <input type="date" value={toDate} min={fromDate} max={getLocalDate()}
                        onChange={e => { setToDate(e.target.value); setWarnings([]); setJathaOverlaps([]) }} />
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

      {jathaOverlaps.length > 0 && (
        <div className="overlap-report">
          <div className="overlap-report-header">
            <AlertTriangle size={16} />
            <span>{jathaOverlaps.length} sewadar(s) skipped due to overlap</span>
          </div>
          <div className="overlap-report-list">
            {jathaOverlaps.slice(0, 5).map((o, i) => (
              <div key={i} className="overlap-report-item">
                <div className="overlap-name">{o.name} ({o.badge})</div>
                <div className="overlap-reason">
                  {o.type === 'JATHA_DUPLICATE'
                    ? `Already in jatha at ${o.destination} (${formatDateIndian(o.existingFrom)} to ${formatDateIndian(o.existingTo)})`
                    : `${o.dutyType} session on ${formatDateIndian(o.sessionDate)} overlaps`
                  }
                </div>
              </div>
            ))}
            {jathaOverlaps.length > 5 && (
              <div className="overlap-report-more">...and {jathaOverlaps.length - 5} more</div>
            )}
          </div>
          <button className="download-overlap-btn" onClick={() => downloadOverlapExcel(buildJathaOverlapExcelData(jathaOverlaps), 'jatha')}>
            <Download size={14} /> Download Overlap Report (.xlsx)
          </button>
        </div>
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
