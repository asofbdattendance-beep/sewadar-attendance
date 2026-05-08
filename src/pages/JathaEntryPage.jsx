import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, ROLES, formatDateIndian } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { logAction } from '../lib/logger'
import { useToast } from '../components/Toast'
import { Users, Search, Plus, Trash2, AlertTriangle, CheckCircle, Calendar, MapPin, Briefcase, ChevronDown, X } from 'lucide-react'

const JATHA_TYPES = [
  { value: 'beas', label: 'BEAS' },
  { value: 'major_centre', label: 'Major Centre' },
  { value: 'jatha_home', label: 'Jatha Home' },
]

const MAX_JATHA_DAYS = 7
const MAX_PAST_DAYS = 7

export default function JathaEntryPage() {
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

  const [sewadars, setSewadars] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchTimeout = useRef(null)

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [lastCreatedIds, setLastCreatedIds] = useState([])

  const resetForm = () => {
    setSelectedJatha(null)
    setJathaType('')
    setSewadars([])
    setSearchTerm('')
    setSearchResults([])
    setFromDate('')
    setToDate('')
    setRemarks('')
    setSubmitResult(null)
    setWarnings([])
    setLastCreatedIds([])
  }

  const [lastCreatedIds, setLastCreatedIds] = useState([])

  const checkDateValidations = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]
    const from = new Date(fromDate)
    const to = new Date(toDate)

    if (fromDate && fromDate > todayStr) {
      return 'FROM DATE cannot be in the future'
    }

    if (toDate && toDate > todayStr) {
      return 'TO DATE cannot be in the future'
    }

    if (fromDate && toDate) {
      const diffDays = Math.ceil((to - from) / (1000 * 60 * 60 * 24))
      if (diffDays > MAX_JATHA_DAYS) {
        return `Maximum ${MAX_JATHA_DAYS} days between FROM and TO date`
      }
    }

    if (fromDate) {
      const daysDiff = Math.ceil((today - from) / (1000 * 60 * 60 * 24))
      if (daysDiff > MAX_PAST_DAYS) {
        return `FROM DATE cannot be more than ${MAX_PAST_DAYS} days in the past`
      }
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
      // Check gate entries (non-jatha)
      const { data: gateData } = await supabase
        .from('attendance_sessions')
        .select('in_date, out_date, duty_type, is_jatha_entry')
        .eq('badge_number', sewadar.badge_number)
        .eq('is_jatha_entry', false)
        .or(`status.eq.OPEN,status.eq.CLOSED`)

      if (gateData) {
        for (const session of gateData) {
          const sessIn = new Date(session.in_date)
          const sessOut = session.out_date ? new Date(session.out_date) : new Date()
          const jathaFrom = new Date(fromDate)
          const jathaTo = new Date(toDate)

          if (sessIn <= jathaTo && sessOut >= jathaFrom) {
            overlaps.push({
              name: sewadar.sewadar_name,
              badge: sewadar.badge_number,
              sessionDate: session.in_date,
              dutyType: session.duty_type,
              type: 'gate'
            })
            break
          }
        }
      }

      // Also check other jatha entries
      if (!overlaps.some(o => o.badge === sewadar.badge_number)) {
        const { data: jathaData } = await supabase
          .from('jatha_attendance')
          .select('from_date, to_date')
          .eq('badge_number', sewadar.badge_number)
          .or(`and(from_date.lte.${toDate},to_date.gte.${fromDate})`)

        if (jathaData && jathaData.length > 0) {
          overlaps.push({
            name: sewadar.sewadar_name,
            badge: sewadar.badge_number,
            sessionDate: jathaData[0].from_date,
            dutyType: 'JATHA',
            type: 'jatha'
          })
        }
      }
    }
    return overlaps
  }

  const validateAndCheck = async () => {
    const dateError = checkDateValidations()
    if (dateError) return { error: dateError }

    if (sewadars.length === 0) {
      return { error: 'Please add at least one sewadar' }
    }

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
        const overlapType = o.type === 'jatha' ? 'another JATHA' : o.dutyType
        allWarnings.push({
          type: 'warning',
          message: `${o.name} has ${overlapType} attendance on ${formatDateIndian(o.sessionDate)}`
        })
      })
    }

    return { warnings: allWarnings }
  }

  useEffect(() => {
    if (!jathaType) {
      setJathas([])
      return
    }
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

  const validateForm = () => {
    if (!selectedJatha) return 'Please select a jatha'
    if (sewadars.length === 0) return 'Please add at least one sewadar'
    if (!fromDate) return 'Please select FROM DATE'
    if (!toDate) return 'Please select TO DATE'
    if (new Date(toDate) < new Date(fromDate)) return 'TO DATE must be after FROM DATE'
    if (jathaType === 'jatha_home' && !remarks?.trim()) return 'Remarks is required for Jatha Home'
    return null
  }

  const submitJathaAttendance = async () => {
    if (!selectedJatha) {
      toast.error('Please select a jatha')
      return
    }

    const validationError = validateForm()
    if (validationError) {
      toast.error(validationError)
      return
    }

    const result = await validateAndCheck()
    
    if (result.error) {
      toast.error(result.error)
      return
    }

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
        remarks: remarks?.trim() || null,
        entered_by_badge: profile?.badge_number,
        entered_by_name: profile?.name,
      }))

      const { data, error: insertError } = await supabase
        .from('jatha_attendance')
        .insert(records)
        .select('id')

      if (insertError) throw insertError

      if (data && data.length !== records.length) {
        throw new Error(`Some records failed to insert. Expected ${records.length}, got ${data.length}`)
      }

      const ids = data.map(r => r.id)
      setLastCreatedIds(ids)

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
      setTimeout(() => {
        resetForm()
        setSubmitResult(null)
      }, 2000)

    } catch (err) {
      console.error('Jatha entry error:', err)
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
    <div className="page pb-nav">
      <div className="header">
        <h2>Jatha Entry</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Mark attendance for multiple sewadars in a jatha
        </p>
      </div>

      {/* ERRORS/WARNINGS AT TOP */}
      {warnings.length > 0 && (
        <div className="jatha-warnings-top">
          {warnings.map((w, i) => (
            <div key={i} className={`jatha-warning ${w.type}`}>
              <AlertTriangle size={16} />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Date Range - Show when jatha is selected */}
      {selectedJatha && (
        <div className="gate-section">
          <div className="section-label">
            <Calendar size={14} />
            Date Range
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>
              Max {MAX_JATHA_DAYS} days
            </span>
          </div>

          <div className="entry-grid">
            <div className="entry-field">
              <label>FROM DATE</label>
              <input
                type="date"
                value={fromDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={e => { setFromDate(e.target.value); setWarnings([]) }}
              />
            </div>
            <div className="entry-field">
              <label>TO DATE</label>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={e => { setToDate(e.target.value); setWarnings([]) }}
              />
            </div>
          </div>

          {fromDate && toDate && (
            <div className="date-summary">
              <Calendar size={14} />
              <span>{formatDateIndian(fromDate)} to {formatDateIndian(toDate)}</span>
              <span className="duty-badge JATHA">JATHA</span>
            </div>
          )}
        </div>
      )}

      {/* Jatha Type Selection */}
      <div className="gate-section">
        <div className="section-label">
          <Briefcase size={14} />
          Select Jatha Type
        </div>
        <div className="duty-filters">
          {JATHA_TYPES.map(type => (
            <button
              key={type.value}
              className={`chip ${jathaType === type.value ? 'active' : ''}`}
              onClick={() => {
                setJathaType(type.value)
                setSelectedJatha(null)
                setSewadars([])
                setFromDate('')
                setToDate('')
                setRemarks('')
                setWarnings([])
              }}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Jatha Selection */}
      {jathaType && (
        <div className="gate-section">
          <div className="section-label">
            <MapPin size={14} />
            Select Jatha
            <span className="entry-count">{jathas.length}</span>
          </div>

          {!selectedJatha ? (
            <div className="search-box-gate">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search jatha..."
                onFocus={() => setShowJathaDropdown(true)}
              />
              <ChevronDown size={16} />
            </div>
          ) : (
            <div className="selected-sewadar-gate">
              <div className="selected-info">
                <div className="selected-name">{selectedJatha.department}</div>
                <div className="selected-badge">{selectedJatha.centre_name}</div>
                <span className={`jatha-type-badge ${selectedJatha.jatha_type}`}>
                  {selectedJatha.jatha_type}
                </span>
              </div>
              <button className="change-btn-gate" onClick={() => {
                setSelectedJatha(null)
                setSewadars([])
                setFromDate('')
                setToDate('')
                setWarnings([])
              }}>
                Change
              </button>
            </div>
          )}

          {showJathaDropdown && (
            <>
              <div
                className="dropdown-overlay"
                onClick={() => setShowJathaDropdown(false)}
              />
              <div className="search-results-gate jatha-dropdown">
                {loading ? (
                  <div className="loading-text">Loading...</div>
                ) : Object.keys(groupedJathas).length > 0 ? (
                  Object.entries(groupedJathas).map(([centre, items]) => (
                    <div key={centre}>
                      <div className="jatha-centre-header">{centre}</div>
                      {items.map(j => (
                        <div
                          key={j.id}
                          className="result-item-gate jatha-item"
                          onClick={() => {
                            setSelectedJatha(j)
                            setShowJathaDropdown(false)
                          }}
                        >
                          <div className="result-name">{j.department}</div>
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  <div className="no-results">No jathas found</div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Sewadar Selection */}
      {selectedJatha && (
        <div className="gate-section">
          <div className="section-label">
            <Users size={14} />
            Add Sewadars
            <span className="entry-count">{sewadars.length}</span>
          </div>

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
                <div
                  key={s.badge_number}
                  className="result-item-gate"
                  onClick={() => addSewadar(s)}
                >
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

          {/* Selected Sewadars */}
          {sewadars.length > 0 && (
            <div className="selected-sewadars-list">
              {sewadars.map(s => (
                <div key={s.badge_number} className="selected-sewadar-chip">
                  <div>
                    <div className="chip-name">{s.sewadar_name}</div>
                    <div className="chip-badge">{s.badge_number}</div>
                    <div className="chip-details">
                      <span className="chip-centre">{s.centre}</span>
                      <span className="chip-dept">{s.department}</span>
                    </div>
                  </div>
                  <button
                    className="chip-remove"
                    onClick={() => removeSewadar(s.badge_number)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Submit */}
      {selectedJatha && sewadars.length > 0 && fromDate && toDate && (jathaType !== 'jatha_home' || remarks?.trim()) && (
        <button
          className="submit-gate-btn"
          onClick={submitJathaAttendance}
          disabled={submitting}
        >
          {submitting ? (
            <>
              <div className="spinner" style={{ width: 18, height: 18 }} />
              Saving...
            </>
          ) : (
            <>
              <CheckCircle size={18} />
              Mark {sewadars.length} Sewadar(s) for Jatha
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
                <div style={{ fontSize: 12 }}>Jatha attendance recorded</div>
              </div>
              <button
                className="btn-icon btn-delete"
                style={{ marginLeft: 'auto' }}
                title="Undo - Delete these entries"
                  onClick={async () => {
                    if (!window.confirm(`Delete last ${submitResult.count} jatha entries?`)) return
                    const { data: deletedRecords } = await supabase.from('jatha_attendance').select('*').in('id', lastCreatedIds)
                    const { error } = await supabase.from('jatha_attendance').delete().in('id', lastCreatedIds)
                    if (error) { toast.error(error.message); return }
                    logAction(profile?.badge_number, profile?.name, 'JATHA_DELETE', { 
                      count: lastCreatedIds.length, 
                      ids: lastCreatedIds,
                      deleted_records: deletedRecords || []
                    })
                    toast.success('Entries deleted')
                    resetForm()
                  }}
              >
                <Trash2 size={16} />
              </button>
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
        <span>All selected sewadars will be marked for JATHA duty from {fromDate || '___'} to {toDate || '___'}</span>
      </div>
    </div>
  )
}
