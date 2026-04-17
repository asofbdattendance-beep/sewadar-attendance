import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, ROLES, SESSION_STATUS, formatTime12Hour } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'
import { UserPlus, Search, Plus, Trash2, AlertTriangle, CheckCircle, Clock, Calendar, Lock, Unlock, RefreshCw, MapPin, Briefcase, Shield } from 'lucide-react'

export default function GateEntryPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const [sewadar, setSewadar] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [entries, setEntries] = useState([{ id: 1, inDate: '', inTime: '', outDate: '', outTime: '' }])
  const [validationErrors, setValidationErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [existingSessions, setExistingSessions] = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const searchTimeout = useRef(null)

  const resetForm = () => {
    setSewadar(null)
    setSearchTerm('')
    setSearchResults([])
    setEntries([{ id: 1, inDate: '', inTime: '', outDate: '', outTime: '' }])
    setValidationErrors({})
    setSubmitResult(null)
    setExistingSessions([])
  }

  const fetchExistingSessions = async (badgeNumber) => {
    const { data } = await supabase
      .from('attendance_sessions')
      .select('id, in_date, in_time, out_date, out_time, status, duty_type')
      .eq('badge_number', badgeNumber)
      .or('status.eq.OPEN,status.eq.CLOSED')
    setExistingSessions(data || [])
  }

  const refreshSessions = async () => {
    if (!sewadar) return
    setRefreshing(true)
    await fetchExistingSessions(sewadar.badge_number)
    setRefreshing(false)
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

  const selectSewadar = async (s) => {
    setSewadar(s)
    setSearchTerm('')
    setSearchResults([])
    await fetchExistingSessions(s.badge_number)
  }

  const addEntry = () => {
    setEntries([...entries, { id: Date.now(), inDate: '', inTime: '', outDate: '', outTime: '' }])
  }

  const removeEntry = (id) => {
    if (entries.length === 1) return
    setEntries(entries.filter(e => e.id !== id))
  }

  const validateSingleEntry = (entry) => {
    const entryErrors = {}
    
    if (!entry.inDate) entryErrors.inDate = 'Required'
    if (!entry.inTime) entryErrors.inTime = 'Required'
    if (!entry.outDate) entryErrors.outDate = 'Required'
    if (!entry.outTime) entryErrors.outTime = 'Required'

    if (entry.inDate && entry.inTime && entry.outDate && entry.outTime) {
      const inDateTime = new Date(`${entry.inDate}T${entry.inTime}:00`)
      const outDateTime = new Date(`${entry.outDate}T${entry.outTime}:00`)
      
      if (outDateTime <= inDateTime) {
        entryErrors.outTime = 'OUT > IN required'
        entryErrors.outDate = 'OUT > IN required'
      }
    }

    return entryErrors
  }

  const checkDbOverlaps = (entry) => {
    if (!entry.inDate || !entry.inTime || !entry.outDate || !entry.outTime) return null
    if (validateSingleEntry(entry).outTime) return null
    
    const entryIn = new Date(`${entry.inDate}T${entry.inTime}:00`)
    const entryOut = new Date(`${entry.outDate}T${entry.outTime}:00`)
    
    for (const session of existingSessions) {
      const sessionIn = new Date(`${session.in_date}T${session.in_time}:00`)
      const sessionOut = session.out_date && session.out_time
        ? new Date(`${session.out_date}T${session.out_time}:00`)
        : null
      
      // If existing session is OPEN - person is inside since sessionIn
      if (!sessionOut) {
        // Any gate entry that ends after they entered = conflict
        if (entryOut > sessionIn) {
          return `${session.in_date} (OPEN - inside since ${session.in_time})`
        }
      }
      // If existing session is CLOSED - check for time overlap
      else {
        if (entryIn < sessionOut && entryOut > sessionIn) {
          return `${session.in_date} (${session.duty_type})`
        }
      }
    }
    return null
  }

  const checkFormOverlaps = () => {
    const overlaps = {}
    const validEntries = entries.filter(e => 
      e.inDate && e.inTime && e.outDate && e.outTime && 
      !validateSingleEntry(e).outTime
    )
    
    for (let i = 0; i < validEntries.length; i++) {
      for (let j = i + 1; j < validEntries.length; j++) {
        const a = validEntries[i]
        const b = validEntries[j]
        const aIn = new Date(`${a.inDate}T${a.inTime}:00`)
        const aOut = new Date(`${a.outDate}T${a.outTime}:00`)
        const bIn = new Date(`${b.inDate}T${b.inTime}:00`)
        const bOut = new Date(`${b.outDate}T${b.outTime}:00`)
        
        if (aIn < bOut && aOut > bIn) {
          overlaps[a.id] = 'Form Entry'
          overlaps[b.id] = 'Form Entry'
        }
      }
    }
    return overlaps
  }

  const hasAnyErrors = () => {
    for (const entry of entries) {
      if (Object.keys(validateSingleEntry(entry)).length > 0) return true
    }
    if (Object.keys(checkFormOverlaps()).length > 0) return true
    for (const entry of entries) {
      if (checkDbOverlaps(entry)) return true
    }
    return false
  }

  const updateEntry = (id, field, value) => {
    setEntries(entries => entries.map(e => e.id === id ? { ...e, [field]: value } : e))
    
    const updatedEntry = entries.find(e => e.id === id)
    if (updatedEntry) {
      const updated = { ...updatedEntry, [field]: value }
      const entryErrors = validateSingleEntry(updated)
      setValidationErrors(prev => ({ ...prev, [id]: entryErrors }))
    }
  }

  const validateEntries = async () => {
    if (!sewadar) return 'Please select a sewadar'
    
    const errors = {}

    for (const entry of entries) {
      const entryErrors = validateSingleEntry(entry)
      if (Object.keys(entryErrors).length > 0) {
        errors[entry.id] = entryErrors
      }
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors)
      return 'Please fill all required fields correctly'
    }

    const formOverlaps = checkFormOverlaps()
    const hasFormOverlap = Object.keys(formOverlaps).length > 0
    
    const dbOverlaps = entries.map(e => checkDbOverlaps(e))
    const hasDbOverlap = dbOverlaps.some(o => o !== null)

    if (hasFormOverlap || hasDbOverlap) {
      setValidationErrors({ ...errors, _blocked: true })
      return 'Please resolve all overlap errors before submitting'
    }

    return null
  }

  const submitEntries = async () => {
    const error = await validateEntries()
    if (error) return

    setSubmitting(true)
    setSubmitResult(null)

    try {
      // Fresh overlap check immediately before insert (race condition prevention)
      const { data: freshSessions } = await supabase
        .from('attendance_sessions')
        .select('id, in_date, in_time, out_date, out_time, status')
        .eq('badge_number', sewadar.badge_number)
        .or('status.eq.OPEN,status.eq.CLOSED')

      if (freshSessions) {
        for (const entry of entries) {
          const entryIn = new Date(`${entry.inDate}T${entry.inTime}:00`)
          const entryOut = new Date(`${entry.outDate}T${entry.outTime}:00`)

          for (const session of freshSessions) {
            const sessionIn = new Date(`${session.in_date}T${session.in_time}:00`)
            const sessionOut = session.out_date && session.out_time
              ? new Date(`${session.out_date}T${session.out_time}:00`)
              : null

            if (!sessionOut) {
              if (entryOut > sessionIn) {
                throw new Error(`Session conflict: ${session.in_date} (OPEN - inside since ${session.in_time})`)
              }
            } else {
              if (entryIn < sessionOut && entryOut > sessionIn) {
                throw new Error(`Session overlap: ${session.in_date} to ${session.out_date}`)
              }
            }
          }
        }
      }

      const records = entries.map(entry => ({
        badge_number: sewadar.badge_number,
        sewadar_name: sewadar.sewadar_name,
        centre: profile?.centre || sewadar.centre || 'UNKNOWN',
        duty_type: entry.inDate === entry.outDate ? 'DAILY' : 'WATCH_AND_WARD',
        status: SESSION_STATUS.CLOSED,
        in_date: entry.inDate,
        in_time: entry.inTime,
        out_date: entry.outDate,
        out_time: entry.outTime,
        in_scanner_badge: profile?.badge_number,
        in_scanner_name: profile?.name,
        in_scanner_centre: profile?.centre || sewadar.centre || 'UNKNOWN',
        out_scanner_badge: profile?.badge_number,
        out_scanner_name: profile?.name,
        out_scanner_centre: profile?.centre || sewadar.centre || 'UNKNOWN',
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

      if (data && data.length !== records.length) {
        throw new Error(`Some records failed to insert. Expected ${records.length}, got ${data.length}`)
      }

      setSubmitResult({ success: true, count: records.length })
      setTimeout(() => {
        resetForm()
        setSubmitResult(null)
      }, 2000)

    } catch (err) {
      console.error('Gate entry error:', err)
      toast.error(err.message || 'Failed to save entries')
      setSubmitResult({ success: false, error: err.message || 'Failed to save entries' })
      setSubmitting(false)
    }
  }

  const getEntryErrors = (entryId) => validationErrors[entryId] || {}

  return (
    <div className="page pb-nav">
      <div className="header">
        <h2>Gate Entry</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Bulk attendance entry with overlap validation
        </p>
      </div>

      {/* Sewadar Selection */}
      <div className="gate-section">
        <div className="section-label">
          <Lock size={14} />
          Select Sewadar
        </div>
        
        {!sewadar ? (
          <div className="search-box-gate">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search by name or badge..."
              value={searchTerm}
              onChange={handleSearchChange}
            />
          </div>
        ) : (
          <div className="selected-sewadar-gate">
            <div className="selected-info">
              <div className="selected-name">{sewadar?.sewadar_name}</div>
              <div className="selected-badge">{sewadar?.badge_number}</div>
              <div className="selected-details">
                <span className="detail-item">
                  <MapPin size={12} /> {sewadar?.centre || '-'}
                </span>
                <span className="detail-item">
                  <Briefcase size={12} /> {sewadar?.department || '-'}
                </span>
                <span className={`detail-item badge-status ${sewadar?.badge_status?.toLowerCase()}`}>
                  <Shield size={12} /> {sewadar?.badge_status || 'OPEN'}
                </span>
              </div>
            </div>
            <button className="change-btn-gate" onClick={resetForm}>
              Change
            </button>
          </div>
        )}

        {searchResults.length > 0 && (
          <div className="search-results-gate">
            {searchResults.map(s => (
              <div key={s.badge_number} className="result-item-gate" onClick={() => selectSewadar(s)}>
                <div className="result-name">{s.sewadar_name}</div>
                <div className="result-badge">{s.badge_number}</div>
              </div>
            ))}
          </div>
        )}

        {searchLoading && <div className="loading-text">Searching...</div>}
      </div>

      {/* Entries */}
      {sewadar && (
        <div className="gate-section">
          <div className="section-label">
            <Calendar size={14} />
            Attendance Entries
            <span className="entry-count">{entries.length}</span>
            <button className="refresh-btn" onClick={refreshSessions} disabled={refreshing} title="Refresh sessions">
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            </button>
          </div>

          {entries.map((entry, index) => {
            const errors = getEntryErrors(entry.id)
            const formOverlaps = checkFormOverlaps()
            const dbOverlap = checkDbOverlaps(entry)
            const hasFormOverlap = formOverlaps[entry.id]
            const hasAnyOverlap = hasFormOverlap || dbOverlap
            return (
              <div key={entry.id} className={`entry-card ${hasAnyOverlap ? 'entry-error' : ''}`}>
                <div className="entry-header">
                  <span className="entry-number">Entry {index + 1}</span>
                  {entries.length > 1 && (
                    <button className="remove-btn" onClick={() => removeEntry(entry.id)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <div className="entry-grid">
                  <div className="entry-field">
                    <label>IN Date</label>
                    <input
                      type="date"
                      className={errors.inDate ? 'input-error' : ''}
                      value={entry.inDate}
                      onChange={e => updateEntry(entry.id, 'inDate', e.target.value)}
                    />
                    {errors.inDate && <span className="error-text">{errors.inDate}</span>}
                  </div>

                  <div className="entry-field">
                    <label>IN Time</label>
                    <input
                      type="time"
                      className={errors.inTime ? 'input-error' : ''}
                      value={entry.inTime}
                      onChange={e => updateEntry(entry.id, 'inTime', e.target.value)}
                    />
                    {errors.inTime && <span className="error-text">{errors.inTime}</span>}
                  </div>

                  <div className="entry-field">
                    <label>OUT Date</label>
                    <input
                      type="date"
                      className={errors.outDate ? 'input-error' : ''}
                      value={entry.outDate}
                      onChange={e => updateEntry(entry.id, 'outDate', e.target.value)}
                    />
                    {errors.outDate && <span className="error-text">{errors.outDate}</span>}
                  </div>

                  <div className="entry-field">
                    <label>OUT Time</label>
                    <input
                      type="time"
                      className={errors.outTime ? 'input-error' : ''}
                      value={entry.outTime}
                      onChange={e => updateEntry(entry.id, 'outTime', e.target.value)}
                    />
                    {errors.outTime && <span className="error-text">{errors.outTime}</span>}
                  </div>
                </div>

                {dbOverlap && (
                  <div className="db-overlap-warning">
                    <AlertTriangle size={12} />
                    <div>
                      <span>Existing session: {dbOverlap}</span>
                      <span className="overlap-sub">Change dates to avoid overlap</span>
                    </div>
                  </div>
                )}

                {hasFormOverlap && (
                  <div className="overlap-warning">
                    <AlertTriangle size={12} />
                    <span>Overlaps with other entries in form</span>
                  </div>
                )}

                {entry.inDate && entry.inTime && entry.outDate && entry.outTime && !errors.outTime && !hasAnyOverlap && (
                  <div className="entry-preview success">
                    <Clock size={12} />
                    <span>
                      {formatTime12Hour(entry.inTime)} → {formatTime12Hour(entry.outTime)}
                      {entry.inDate !== entry.outDate && (
                        <span className="multi-day"> ({entry.inDate} to {entry.outDate})</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )
          })}

          <button className="add-entry-btn" onClick={addEntry}>
            <Plus size={16} />
            Add Another Entry
          </button>
        </div>
      )}

      {/* Submit */}
      {sewadar && entries.length > 0 && (
        <button 
          className="submit-gate-btn" 
          onClick={submitEntries}
          disabled={submitting || loading || hasAnyErrors()}
        >
          {submitting || loading ? (
            <>
              <div className="spinner" style={{ width: 18, height: 18 }} />
              Validating...
            </>
          ) : (
            <>
              <CheckCircle size={18} />
              Submit {entries.length} Entry(s)
            </>
          )}
        </button>
      )}

      {/* Result */}
      {submitResult && (
        <div className={`result-box ${submitResult.success ? 'success' : 'error'}`}>
          {submitResult.success ? (
            <>
              <CheckCircle size={20} />
              <div>
                <div style={{ fontWeight: 700 }}>{submitResult.count} Entries Added!</div>
                <div style={{ fontSize: 12 }}>Attendance recorded successfully</div>
              </div>
            </>
          ) : (
            <>
              <AlertTriangle size={20} />
              <div>
                <div style={{ fontWeight: 700 }}>Error</div>
                <div style={{ fontSize: 12 }}>{submitResult.error}</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Info */}
      <div className="gate-info">
        <AlertTriangle size={14} />
        <span>Entries are validated for overlaps before submission. Multiple entries for the same sewadar cannot overlap.</span>
      </div>
    </div>
  )
}
