// JathaPage.jsx — Three tabs: Mark Jatha + View Jatha Records + Table View
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, JATHA_TYPE, JATHA_TYPE_LABEL } from '../lib/supabase'
import {
  Search, Calendar, CheckCircle, ChevronDown, MapPin, AlertTriangle,
  X, RefreshCw, Plane, Download, Flag, Pencil, Trash2, FileText
} from 'lucide-react'

// ── All supported jatha types including jatha_home ──
const ALL_JATHA_TYPES = [
  { value: 'major_centre', label: 'Major Centre' },
  { value: 'beas',         label: 'Beas'         },
  { value: 'jatha_home',   label: 'Jatha Home'   },
]

function getJathaLabel(type) {
  if (!type) return '—'
  if (JATHA_TYPE_LABEL && JATHA_TYPE_LABEL[type]) return JATHA_TYPE_LABEL[type]
  const found = ALL_JATHA_TYPES.find(t => t.value === type)
  return found ? found.label : type
}

// Satsang days for jatha = total days inclusive (no Wed/Sun rule)
function countJathaDays(from, to) {
  if (!from || !to) return 0
  const f = new Date(from + 'T00:00:00')
  const t = new Date(to   + 'T00:00:00')
  if (t < f) return 0
  return Math.round((t - f) / 86400000) + 1
}

function validateRange(from, to) {
  if (!from || !to) return null
  const f = new Date(from + 'T00:00:00')
  const t = new Date(to   + 'T00:00:00')
  if (t < f) return 'End date must be on or after start date'
  const diff = Math.round((t - f) / 86400000)
  if (diff > 10) return `Range is ${diff} days — maximum allowed is 10 days`
  return null
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00+05:30').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata'
  })
}

// ─────────────────────────────────────────────
//  CONFLICT CHECKER
// ─────────────────────────────────────────────
async function checkConflicts(badgeNumber, dateFrom, dateTo) {
  const [jathaRes, dailyRes] = await Promise.all([
    supabase.from('jatha_attendance')
      .select('id, jatha_type, jatha_centre, jatha_dept, date_from, date_to, satsang_days, submitted_name')
      .eq('badge_number', badgeNumber)
      .gte('date_to', dateFrom)
      .lte('date_from', dateTo),
    supabase.from('attendance')
      .select('id, type, scan_time, scanner_name, centre')
      .eq('badge_number', badgeNumber)
      .gte('scan_time', dateFrom + 'T00:00:00+05:30')
      .lte('scan_time', dateTo   + 'T23:59:59+05:30')
      .order('scan_time', { ascending: true }),
  ])
  return {
    jathaConflicts: jathaRes.data || [],
    dailyConflicts: dailyRes.data || [],
  }
}

// ─────────────────────────────────────────────
//  TAB 1 — MARK JATHA ATTENDANCE
// ─────────────────────────────────────────────
function MarkJathaTab() {
  const { profile } = useAuth()

  const [badgeInput, setBadgeInput]             = useState('')
  const [searching, setSearching]               = useState(false)
  const [searchResults, setSearchResults]       = useState([])
  const [selected, setSelected]                 = useState(null)
  const [dateFrom, setDateFrom]                 = useState('')
  const [dateTo, setDateTo]                     = useState('')
  const [jathaType, setJathaType]               = useState('')
  const [jathaCentreOptions, setJathaCentreOptions] = useState([])
  const [jathaCentre, setJathaCentre]           = useState('')
  const [jathaDept, setJathaDept]               = useState('')
  const [remarks, setRemarks]                   = useState('')
  const [dateError, setDateError]               = useState('')
  const [satsangDays, setSatsangDays]           = useState(0)
  const [submitting, setSubmitting]             = useState(false)
  const [success, setSuccess]                   = useState(false)
  const [error, setError]                       = useState('')

  const [checkingConflicts, setCheckingConflicts] = useState(false)
  const [jathaConflicts, setJathaConflicts]       = useState([])
  const [dailyConflicts, setDailyConflicts]       = useState([])
  const [conflictChecked, setConflictChecked]     = useState(false)
  const conflictTimer = useRef(null)

  const uniqueCentreNames = [...new Set(jathaCentreOptions.map(r => r.centre_name))]
  const deptOptions = jathaCentreOptions
    .filter(r => r.centre_name === jathaCentre)
    .map(r => r.department)
  const hasConflict = jathaConflicts.length > 0 || dailyConflicts.length > 0

  // Load centres when type changes
  useEffect(() => {
    if (!jathaType) { setJathaCentreOptions([]); setJathaCentre(''); setJathaDept(''); return }
    supabase.from('jatha_centres')
      .select('centre_name, department')
      .eq('jatha_type', jathaType).eq('is_active', true)
      .order('centre_name').order('department')
      .then(({ data }) => { setJathaCentreOptions(data || []); setJathaCentre(''); setJathaDept('') })
  }, [jathaType])

  // Auto-select single centre for beas/jatha_home
  useEffect(() => {
    if ((jathaType === 'beas' || jathaType === 'jatha_home') && !jathaCentre && uniqueCentreNames.length === 1) {
      setJathaCentre(uniqueCentreNames[0])
    }
  }, [jathaType, jathaCentre, uniqueCentreNames])

  // Recalculate days + trigger conflict check
  useEffect(() => {
    const err = validateRange(dateFrom, dateTo)
    setDateError(err || '')
    setSatsangDays(!err && dateFrom && dateTo ? countJathaDays(dateFrom, dateTo) : 0)

    if (!dateFrom || !dateTo || err) {
      setJathaConflicts([]); setDailyConflicts([]); setConflictChecked(false); return
    }

    clearTimeout(conflictTimer.current)
    conflictTimer.current = setTimeout(async () => {
      if (!selected) return
      setCheckingConflicts(true)
      const { jathaConflicts: jc, dailyConflicts: dc } = await checkConflicts(selected.badge_number, dateFrom, dateTo)
      setJathaConflicts(jc); setDailyConflicts(dc); setConflictChecked(true)
      setCheckingConflicts(false)
    }, 400)
    return () => clearTimeout(conflictTimer.current)
  }, [dateFrom, dateTo, selected])

  function handleDateFromChange(val) {
    setDateFrom(val)
    if (dateTo && dateTo < val) setDateTo('')
  }

  async function searchBadge() {
    const term = badgeInput.trim()
    if (!term) return
    setSearching(true)
    const { data } = await supabase.from('sewadars').select('*')
      .or(`badge_number.ilike.%${term.toUpperCase()}%,sewadar_name.ilike.%${term}%`).limit(10)
    setSearchResults(data || [])
    setSearching(false)
  }

  function selectSewadar(s) {
    setSelected(s); setSearchResults([]); setBadgeInput(s.badge_number)
    setSuccess(false); setError('')
    setJathaConflicts([]); setDailyConflicts([]); setConflictChecked(false)
  }

  async function submitJatha() {
    if (!selected)            { setError('Select a sewadar first'); return }
    const err = validateRange(dateFrom, dateTo)
    if (err)                  { setError(err); return }
    if (!dateFrom || !dateTo) { setError('Both dates are required'); return }
    if (!jathaType)           { setError('Select Jatha type'); return }
    if (!jathaCentre)         { setError('Select a Jatha centre'); return }
    if (!jathaDept)           { setError('Select a department'); return }

    setSubmitting(true); setError('')

    // Final conflict re-check
    const { jathaConflicts: jc, dailyConflicts: dc } = await checkConflicts(selected.badge_number, dateFrom, dateTo)
    if (jc.length > 0 || dc.length > 0) {
      setJathaConflicts(jc); setDailyConflicts(dc); setConflictChecked(true)
      setError('Cannot submit — conflicts detected above.')
      setSubmitting(false); return
    }

    const { error: dbErr } = await supabase.from('jatha_attendance').insert({
      badge_number: selected.badge_number, sewadar_name: selected.sewadar_name,
      centre: selected.centre, department: selected.department || null,
      jatha_type: jathaType, jatha_centre: jathaCentre, jatha_dept: jathaDept,
      date_from: dateFrom, date_to: dateTo, satsang_days: satsangDays,
      remarks: remarks.trim() || null, flag: false, flag_reason: null,
      submitted_by: profile.badge_number, submitted_name: profile.name, submitted_centre: profile.centre,
    })
    await supabase.from('logs').insert({
      user_badge: profile.badge_number, action: 'JATHA_ATTENDANCE',
      details: `Jatha for ${selected.badge_number} → ${jathaCentre} (${jathaType}) ${dateFrom}–${dateTo}`,
      timestamp: new Date().toISOString()
    })
    setSubmitting(false)
    if (dbErr) { setError(dbErr.message); return }
    setSuccess(true)
    setDateFrom(''); setDateTo(''); setJathaType(''); setJathaCentre('')
    setJathaDept(''); setRemarks(''); setSatsangDays(0)
    setJathaConflicts([]); setDailyConflicts([]); setConflictChecked(false)
  }

  const canSubmit = selected && dateFrom && dateTo && !dateError && jathaType && jathaCentre && jathaDept && !hasConflict && !checkingConflicts

  const dailyDates = [...new Set(dailyConflicts.map(r =>
    new Date(r.scan_time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' })
  ))]

  return (
    <div>
      {/* Step 1 */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>1 · Find Sewadar</div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <div className="search-box" style={{ flex: 1 }}>
            <Search size={14} />
            <input type="text" placeholder="Badge number or name…" value={badgeInput}
              onChange={e => { setBadgeInput(e.target.value); setSelected(null) }}
              onKeyDown={e => e.key === 'Enter' && searchBadge()} />
            {badgeInput && (
              <button onClick={() => { setBadgeInput(''); setSelected(null); setSearchResults([]) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={14} />
              </button>
            )}
          </div>
          <button className="btn btn-gold" onClick={searchBadge} disabled={searching}>{searching ? '…' : 'Search'}</button>
        </div>

        {searchResults.length > 0 && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {searchResults.map(s => (
              <button key={s.badge_number} onClick={() => selectSewadar(s)}
                style={{ display: 'flex', width: '100%', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 0.85rem', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{s.sewadar_name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.centre} · {s.department || '—'}</div>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gold)' }}>{s.badge_number}</span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--gold-bg)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 8, padding: '0.7rem 0.85rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--gold)' }}>{selected.sewadar_name}</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{selected.badge_number} · {selected.centre} · {selected.department || '—'}</div>
            </div>
            <button onClick={() => { setSelected(null); setBadgeInput(''); setJathaConflicts([]); setDailyConflicts([]); setConflictChecked(false) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
              <X size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Step 2 */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>2 · Jatha Dates</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.6rem' }}>
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={dateFrom} onChange={e => handleDateFromChange(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>

        {dateError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--red)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            <AlertTriangle size={13} /> {dateError}
          </div>
        )}
        {!dateError && satsangDays > 0 && (
          <div className="jatha-satsang-pill">
            <Calendar size={13} /><strong>{satsangDays}</strong> {satsangDays === 1 ? 'day' : 'days'} total
          </div>
        )}

        {/* Conflict indicator */}
        {checkingConflicts && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            <div className="spinner" style={{ width: 14, height: 14 }} /> Checking for conflicts…
          </div>
        )}

        {!checkingConflicts && conflictChecked && hasConflict && (
          <div style={{ marginTop: '0.85rem', background: 'rgba(198,40,40,0.06)', border: '1px solid rgba(198,40,40,0.3)', borderRadius: 10, padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--red)', fontWeight: 700, fontSize: '0.88rem' }}>
              <AlertTriangle size={16} /> Conflict detected — cannot submit
            </div>

            {jathaConflicts.length > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--red)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Existing Jatha Duty
                </div>
                {jathaConflicts.map(j => (
                  <div key={j.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.75rem', marginBottom: '0.35rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{getJathaLabel(j.jatha_type)} — {j.jatha_centre}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                      {j.jatha_dept} · {fmtDate(j.date_from)} → {fmtDate(j.date_to)} · {j.satsang_days} days
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                      Submitted by {j.submitted_name || '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {dailyConflicts.length > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--red)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Daily Attendance Scans in This Range
                </div>
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    {selected?.sewadar_name} has {dailyConflicts.length} scan{dailyConflicts.length > 1 ? 's' : ''} on:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.4rem' }}>
                    {dailyDates.map(d => (
                      <span key={d} style={{ fontSize: '0.75rem', background: 'rgba(198,40,40,0.1)', color: 'var(--red)', border: '1px solid rgba(198,40,40,0.25)', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>{d}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    {dailyConflicts.map(r => (
                      <span key={r.id}>
                        {r.type === 'IN' ? '→ IN' : '← OUT'}&nbsp;
                        {new Date(r.scan_time).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                        &nbsp;via {r.scanner_name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div style={{ fontSize: '0.78rem', color: 'var(--red)', fontStyle: 'italic' }}>
              Resolve the above conflict before marking jatha attendance.
            </div>
          </div>
        )}

        {!checkingConflicts && conflictChecked && !hasConflict && dateFrom && dateTo && selected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--green)', fontSize: '0.8rem', marginTop: '0.6rem', fontWeight: 600 }}>
            <CheckCircle size={14} /> No conflicts — all clear
          </div>
        )}
      </div>

      {/* Step 3 */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>3 · Jatha Destination</div>
        <label className="label">Type</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem', marginBottom: '0.85rem' }}>
          {ALL_JATHA_TYPES.map(t => (
            <button key={t.value} onClick={() => setJathaType(t.value)}
              style={{ padding: '0.6rem 0.3rem', border: `2px solid ${jathaType === t.value ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 8, background: jathaType === t.value ? 'var(--gold-bg)' : 'var(--bg)', color: jathaType === t.value ? 'var(--gold)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s' }}>
              {t.label}
            </button>
          ))}
        </div>

        {jathaType === 'major_centre' && (
          <>
            <label className="label">Major Centre</label>
            <div style={{ position: 'relative', marginBottom: '0.85rem' }}>
              <select className="input" value={jathaCentre} onChange={e => { setJathaCentre(e.target.value); setJathaDept('') }} style={{ appearance: 'none', paddingRight: '2.5rem' }}>
                <option value="">Select centre…</option>
                {uniqueCentreNames.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={15} style={{ position: 'absolute', right: '0.85rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </>
        )}

        {jathaType && (jathaCentre || jathaType !== 'major_centre') && deptOptions.length > 0 && (
          <>
            <label className="label">Department at {jathaType === 'beas' ? 'Beas' : jathaType === 'jatha_home' ? 'Home Centre' : jathaCentre}</label>
            <div style={{ position: 'relative' }}>
              <select className="input" value={jathaDept} onChange={e => setJathaDept(e.target.value)} style={{ appearance: 'none', paddingRight: '2.5rem' }}>
                <option value="">Select department…</option>
                {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <ChevronDown size={15} style={{ position: 'absolute', right: '0.85rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </>
        )}

        {jathaType && jathaCentreOptions.length === 0 && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>No centres configured for this type. Ask Super Admin.</p>
        )}
      </div>

      {/* Step 4 */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>4 · Remarks</div>
        <label className="label">Remarks <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>(optional)</span></label>
        <textarea className="input" rows={2} placeholder="Any notes about this jatha…"
          value={remarks} onChange={e => setRemarks(e.target.value)} style={{ resize: 'none' }} />
        <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.5 }}>
          Found a mistake after submitting? Use the "Flag error" button in the View Records tab.
        </p>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(198,40,40,0.08)', border: '1px solid rgba(198,40,40,0.25)', borderRadius: 8, padding: '0.7rem 0.85rem', marginBottom: '0.85rem', color: 'var(--red)', fontSize: '0.85rem' }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}
      {success && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', borderRadius: 8, padding: '0.7rem 0.85rem', marginBottom: '0.85rem', color: 'var(--green)', fontSize: '0.85rem', fontWeight: 600 }}>
          <CheckCircle size={15} /> Jatha attendance recorded successfully!
        </div>
      )}

      <button className="btn btn-gold btn-full" onClick={submitJatha}
        disabled={submitting || !canSubmit}
        style={{ padding: '0.85rem', fontSize: '0.95rem', fontWeight: 700 }}>
        {submitting ? 'Saving…' : hasConflict ? 'Cannot Submit — Conflict Exists' : 'Submit Jatha Attendance'}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────
//  TAB 2 — VIEW JATHA RECORDS (card view)
// ─────────────────────────────────────────────
function ViewJathaTab() {
  const { profile } = useAuth()
  const [records, setRecords]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [flagModal, setFlagModal]   = useState(null)
  const [flagReason, setFlagReason] = useState('')
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [flagSuccess, setFlagSuccess] = useState(false)
  const [editModal, setEditModal]   = useState(null)
  const [editSaving, setEditSaving] = useState(false)

  const isAdmin = [ROLES.ASO, ROLES.CENTRE_USER].includes(profile?.role)
  const isAso   = profile?.role === ROLES.ASO

  useEffect(() => { fetchRecords().catch(console.error) }, [typeFilter, monthFilter])

  async function fetchRecords() {
    setLoading(true)
    let q = supabase.from('jatha_attendance').select('*').order('created_at', { ascending: false }).limit(500)
    if (typeFilter) q = q.eq('jatha_type', typeFilter)
    if (monthFilter) {
      const [year, month] = monthFilter.split('-')
      const start = `${year}-${month}-01`
      const end   = new Date(year, month, 0).toISOString().split('T')[0]
      q = q.gte('date_from', start).lte('date_from', end)
    }
    if (profile?.role === ROLES.SC_SP_USER) {
      q = q.eq('centre', profile.centre)
    } else if (profile?.role === ROLES.CENTRE_USER) {
      const { data: cd } = await supabase.from('centres').select('centre_name')
        .or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
      q = q.in('centre', cd?.map(c => c.centre_name) || [profile.centre])
    }
    const { data } = await q
    setRecords(data || [])
    setLoading(false)
  }

  const filtered = searchTerm
    ? records.filter(r =>
        r.sewadar_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.badge_number?.toUpperCase().includes(searchTerm.toUpperCase()))
    : records

  const totalDays    = filtered.reduce((acc, r) => acc + (r.satsang_days || 0), 0)
  const flaggedCount = filtered.filter(r => r.flag).length

  function exportCSV() {
    const header = ['Badge','Name','Centre','Department','Jatha Type','Destination','Dept at Jatha','From','To','Days','Remarks','Flagged','Flag Reason','Submitted By','Submitted Centre','Submitted On']
    const rows = filtered.map(r => [
      r.badge_number, `"${r.sewadar_name}"`, r.centre, r.department || '',
      getJathaLabel(r.jatha_type), r.jatha_centre, r.jatha_dept,
      r.date_from, r.date_to, r.satsang_days, `"${r.remarks || ''}"`,
      r.flag ? 'Yes' : 'No', `"${r.flag_reason || ''}"`,
      r.submitted_name || r.submitted_by, r.submitted_centre,
      r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : ''
    ])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `jatha_records${monthFilter ? '_' + monthFilter : ''}.csv`
    a.click()
  }

  async function saveEdit(updated) {
    setEditSaving(true)
    const { error } = await supabase.from('jatha_attendance').update({
      jatha_type: updated.jatha_type, jatha_centre: updated.jatha_centre,
      jatha_dept: updated.jatha_dept, date_from: updated.date_from,
      date_to: updated.date_to, satsang_days: updated.satsang_days, remarks: updated.remarks,
    }).eq('id', updated.id)
    setEditSaving(false)
    if (!error) { setEditModal(null); fetchRecords() }
    else alert('Save failed: ' + error.message)
  }

  async function deleteRecord(record) {
    if (!confirm(`Delete jatha record for ${record.sewadar_name} (${record.date_from} → ${record.date_to})?\nThis cannot be undone.`)) return
    const { error } = await supabase.from('jatha_attendance').delete().eq('id', record.id)
    if (!error) {
      await supabase.from('logs').insert({ user_badge: profile.badge_number, action: 'DELETE_JATHA', details: `Deleted jatha id=${record.id} for ${record.badge_number}`, timestamp: new Date().toISOString() })
      fetchRecords()
    } else alert('Delete failed: ' + error.message)
  }

  async function submitFlag() {
    if (!flagModal || !flagReason.trim()) return
    setFlagSubmitting(true)
    await supabase.from('jatha_attendance').update({ flag: true, flag_reason: flagReason.trim() }).eq('id', flagModal.id)
    await supabase.from('logs').insert({ user_badge: profile.badge_number, action: 'FLAG_JATHA', details: `Flagged jatha id=${flagModal.id}: ${flagReason.trim()}`, timestamp: new Date().toISOString() })
    setFlagSubmitting(false); setFlagSuccess(true)
    setTimeout(() => { setFlagModal(null); setFlagReason(''); setFlagSuccess(false); fetchRecords() }, 1200)
  }

  async function removeFlag(record) {
    if (!isAdmin || !confirm('Remove flag?')) return
    await supabase.from('jatha_attendance').update({ flag: false, flag_reason: null }).eq('id', record.id)
    fetchRecords()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Showing </span><strong>{filtered.length}</strong><span style={{ color: 'var(--text-muted)' }}> records</span>
        </div>
        <div style={{ background: 'var(--gold-bg)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 8, padding: '0.4rem 0.85rem', fontSize: '0.8rem', color: 'var(--gold)' }}>
          <strong>{totalDays}</strong> total days
        </div>
        {flaggedCount > 0 && (
          <div style={{ background: 'rgba(198,40,40,0.08)', border: '1px solid rgba(198,40,40,0.25)', borderRadius: 8, padding: '0.4rem 0.85rem', fontSize: '0.8rem', color: 'var(--red)' }}>
            <strong>{flaggedCount}</strong> flagged
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="search-box" style={{ flex: 1, minWidth: 160 }}>
          <Search size={14} />
          <input type="text" placeholder="Search name or badge…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          {searchTerm && <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={13} /></button>}
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.65rem', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.82rem' }}>
          <option value="">All types</option>
          {ALL_JATHA_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.65rem', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.82rem' }} />
        {monthFilter && <button onClick={() => setMonthFilter('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}><X size={14} /></button>}
        <button className="btn btn-ghost" onClick={fetchRecords} style={{ padding: '0.4rem 0.6rem' }}><RefreshCw size={15} /></button>
        <button className="btn btn-ghost" onClick={exportCSV} disabled={filtered.length === 0} style={{ padding: '0.4rem 0.75rem', fontSize: '0.82rem' }}><Download size={14} /> Export</button>
      </div>

      {loading ? (
        <div className="text-center" style={{ padding: '2rem 0' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
          <Plane size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.25, display: 'block' }} /><p>No jatha records found</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {filtered.map(r => (
            <div key={r.id} className="card" style={{ padding: '0.85rem 1rem', borderLeft: r.flag ? '3px solid var(--red)' : '3px solid var(--gold)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{r.sewadar_name}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--gold)' }}>{r.badge_number}</span>
                    {r.flag && (
                      <span style={{ fontSize: '0.68rem', background: 'rgba(198,40,40,0.08)', color: 'var(--red)', border: '1px solid rgba(198,40,40,0.25)', borderRadius: 999, padding: '1px 6px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Flag size={9} /> Flagged
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>{r.centre} · {r.department || '—'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.7rem', background: 'var(--gold-bg)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 999, padding: '1px 7px', fontWeight: 700 }}>
                      {getJathaLabel(r.jatha_type)}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      <MapPin size={11} style={{ display: 'inline', marginRight: 2 }} />{r.jatha_centre}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{r.jatha_dept}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDate(r.date_from)} → {fmtDate(r.date_to)}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--green)', fontWeight: 700, marginTop: '0.2rem' }}>{r.satsang_days} {r.satsang_days === 1 ? 'day' : 'days'}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>by {r.submitted_name || r.submitted_by}</div>
                </div>
              </div>

              {r.remarks && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.35rem 0.6rem', marginTop: '0.5rem' }}>
                  {r.remarks}
                </div>
              )}

              {r.flag && r.flag_reason && (
                <div style={{ fontSize: '0.78rem', color: 'var(--red)', background: 'rgba(198,40,40,0.05)', border: '1px solid rgba(198,40,40,0.2)', borderRadius: 6, padding: '0.35rem 0.6rem', marginTop: '0.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <span style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-start' }}>
                    <Flag size={11} style={{ marginTop: 2, flexShrink: 0 }} /> {r.flag_reason}
                  </span>
                  {isAdmin && (
                    <button onClick={() => removeFlag(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.72rem', flexShrink: 0, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                      Remove flag
                    </button>
                  )}
                </div>
              )}

              <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {isAso && (
                    <button onClick={() => setEditModal({ ...r })}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '0.25rem 0.65rem', fontSize: '0.75rem', color: 'var(--blue)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'inherit' }}>
                      <Pencil size={11} /> Edit
                    </button>
                  )}
                  {isAso && (
                    <button onClick={() => deleteRecord(r)}
                      style={{ background: 'none', border: '1px solid rgba(198,40,40,0.3)', borderRadius: 6, padding: '0.25rem 0.65rem', fontSize: '0.75rem', color: 'var(--red)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'inherit' }}>
                      <Trash2 size={11} /> Delete
                    </button>
                  )}
                </div>
                {!r.flag && (
                  <button onClick={() => { setFlagModal(r); setFlagReason(''); setFlagSuccess(false) }}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '0.25rem 0.65rem', fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'inherit' }}>
                    <Flag size={11} /> Flag error
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editModal && <EditJathaModal record={editModal} saving={editSaving} onSave={saveEdit} onClose={() => setEditModal(null)} />}

      {flagModal && (
        <div className="overlay" onClick={() => { setFlagModal(null); setFlagReason('') }}>
          <div className="overlay-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            {flagSuccess ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <div style={{ width: 52, height: 52, background: 'rgba(198,40,40,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                  <Flag size={22} color="var(--red)" />
                </div>
                <p style={{ fontWeight: 600, color: 'var(--red)' }}>Record flagged</p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Flag size={17} color="var(--red)" />
                    <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Flag This Entry</h3>
                  </div>
                  <button onClick={() => setFlagModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
                </div>
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.65rem 0.85rem', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{flagModal.sewadar_name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    {flagModal.badge_number} · {fmtDate(flagModal.date_from)} → {fmtDate(flagModal.date_to)} · {flagModal.jatha_centre}
                  </div>
                </div>
                <label className="label">What's wrong? <span style={{ color: 'var(--red)' }}>*</span></label>
                <textarea className="input" rows={3} placeholder="Describe the error or issue…"
                  value={flagReason} onChange={e => setFlagReason(e.target.value)}
                  style={{ resize: 'none', marginBottom: '1rem', borderColor: 'rgba(198,40,40,0.35)' }} autoFocus />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <button className="btn btn-outline btn-full" onClick={() => setFlagModal(null)}>Cancel</button>
                  <button onClick={submitFlag} disabled={flagSubmitting || !flagReason.trim()}
                    style={{ padding: '0.6rem', border: 'none', borderRadius: 8, background: '#dc2626', color: 'white', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'inherit', opacity: (!flagReason.trim() || flagSubmitting) ? 0.5 : 1 }}>
                    {flagSubmitting ? 'Flagging…' : 'Submit Flag'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
//  TAB 3 — TABLE VIEW (like daily records tab)
// ─────────────────────────────────────────────
function JathaTableTab() {
  const { profile } = useAuth()
  const isAso        = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE_USER
  const isAdmin      = isAso || isCentreUser

  // Reactive desktop detection
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024)
  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 1024)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const PAGE_SIZE = 50
  const [records, setRecords]           = useState([])
  const [loading, setLoading]           = useState(false)
  const [totalCount, setTotalCount]     = useState(0)
  const [page, setPage]                 = useState(1)
  const [searchInput, setSearchInput]   = useState('')
  const [searchTerm, setSearchTerm]     = useState('')
  const [typeFilter, setTypeFilter]     = useState('')
  const [dateRange, setDateRange]       = useState({ from: '', to: '' })
  const [centres, setCentres]           = useState([])
  const [centreFilter, setCentreFilter] = useState('')
  const [sortCol, setSortCol]           = useState('date_from')
  const [sortDir, setSortDir]           = useState('desc')
  const searchTimer = useRef(null)

  useEffect(() => { fetchCentres() }, [])
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearchTerm(searchInput); setPage(1) }, 300)
    return () => clearTimeout(searchTimer.current)
  }, [searchInput])
  useEffect(() => { fetchRecords() }, [page, sortCol, sortDir, searchTerm, typeFilter, dateRange, centreFilter, centres])

  async function fetchCentres() {
    let q = supabase.from('centres').select('centre_name, parent_centre').order('centre_name')
    if (isCentreUser) q = supabase.from('centres').select('centre_name, parent_centre')
      .or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`).order('centre_name')
    const { data } = await q
    setCentres(data || [])
  }

  async function fetchRecords() {
    setLoading(true)
    let q = supabase.from('jatha_attendance')
      .select('*', { count: 'exact' })
      .order(sortCol, { ascending: sortDir === 'asc' })

    if (dateRange.from) q = q.gte('date_from', dateRange.from)
    if (dateRange.to)   q = q.lte('date_from', dateRange.to)
    if (typeFilter)     q = q.eq('jatha_type', typeFilter)

    if (profile?.role === ROLES.SC_SP_USER) {
      q = q.eq('centre', profile.centre)
    } else if (isCentreUser) {
      const scope = [profile.centre, ...centres.filter(c => c.parent_centre === profile.centre).map(c => c.centre_name)]
      q = q.in('centre', scope)
    } else if (centreFilter) {
      q = q.eq('centre', centreFilter)
    }

    if (searchTerm.trim()) {
      q = q.or(`badge_number.ilike.%${searchTerm.trim()}%,sewadar_name.ilike.%${searchTerm.trim()}%`)
    }

    const { data, count, error } = await q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    setLoading(false)
    if (error) { console.error(error); return }
    setRecords(data || [])
    setTotalCount(count || 0)
  }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
    setPage(1)
  }


  function SortTh({ col, label }) {
    return (
      <th onClick={() => handleSort(col)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {label}
          {sortCol === col && <span style={{ fontSize: '0.6rem', color: 'var(--gold)' }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
        </div>
      </th>
    )
  }

  function exportCSV() {
    const header = ['Badge','Name','Centre','Dept','Jatha Type','Destination','Dept at Jatha','From','To','Days','Remarks','Flagged']
    const rows = records.map(r => [
      r.badge_number, `"${r.sewadar_name}"`, r.centre, r.department || '',
      getJathaLabel(r.jatha_type), r.jatha_centre, r.jatha_dept,
      r.date_from, r.date_to, r.satsang_days, `"${r.remarks || ''}"`, r.flag ? 'Yes' : 'No'
    ])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `jatha_table_${dateRange.from || 'all'}.csv`
    a.click()
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.85rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.75rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div className="search-box" style={{ flex: 1, minWidth: 180 }}>
          <Search size={14} />
          <input type="text" placeholder="Search badge or name…" value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setSearchTerm(searchInput)} />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearchTerm('') }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
              <X size={13} />
            </button>
          )}
        </div>

        <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.65rem', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.82rem' }}>
          <option value="">All types</option>
          {ALL_JATHA_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        {isAso && centres.length > 0 && (
          <select value={centreFilter} onChange={e => { setCentreFilter(e.target.value); setPage(1) }}
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.65rem', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.82rem' }}>
            <option value="">All Centres</option>
            {centres.map(c => <option key={c.centre_name} value={c.centre_name}>{c.centre_name}</option>)}
          </select>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.65rem' }}>
          <Calendar size={13} color="var(--text-muted)" />
          <input type="date" value={dateRange.from}
            onChange={e => { setDateRange(p => ({ ...p, from: e.target.value })); setPage(1) }}
            style={{ border: 'none', background: 'none', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }} />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>→</span>
          <input type="date" value={dateRange.to}
            onChange={e => { setDateRange(p => ({ ...p, to: e.target.value })); setPage(1) }}
            style={{ border: 'none', background: 'none', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }} />
          {(dateRange.from || dateRange.to) && (
            <button onClick={() => { setDateRange({ from: '', to: '' }); setPage(1) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
              <X size={12} />
            </button>
          )}
        </div>

        <button className="btn btn-ghost" onClick={fetchRecords} style={{ padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button className="btn btn-ghost" onClick={exportCSV} disabled={records.length === 0} style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}>
          <Download size={13} /> Export
        </button>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
        {totalCount} record{totalCount !== 1 ? 's' : ''} · page {page} of {totalPages || 1}
      </div>

      {/* Table — auto layout on desktop, no forced overflow */}
      <div style={{ width: '100%', overflowX: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem 0' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : records.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
            <FileText size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.25, display: 'block' }} />
            <p>No jatha records found</p>
          </div>
        ) : (
          <table className="records-table" style={{
            width: '100%',
            tableLayout: isDesktop ? 'auto' : 'fixed',
            borderCollapse: 'collapse',
            fontSize: isDesktop ? '0.88rem' : '0.8rem',
          }}>
            {/* colgroup only applies on mobile/tablet where layout=fixed */}
            {!isDesktop && (
              <colgroup>
                <col style={{ width: '110px' }} />
                <col style={{ width: '170px' }} />
                {isAdmin && <col style={{ width: '140px' }} />}
                <col style={{ width: '110px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '95px'  }} />
                <col style={{ width: '95px'  }} />
                <col style={{ width: '55px'  }} />
                <col style={{ width: '80px'  }} />
              </colgroup>
            )}
            <thead style={{
              position: 'sticky',
              top: 0,
              background: 'var(--bg-elevated)',
              zIndex: 2,
              boxShadow: '0 1px 0 var(--border)',
            }}>
              <tr>
                <SortTh col="badge_number" label="Badge"       />
                <SortTh col="sewadar_name" label="Name"        />
                {isAdmin && <SortTh col="centre" label="Centre" />}
                <SortTh col="jatha_type"   label="Type"        />
                <th>Destination</th>
                <th>Department</th>
                <SortTh col="date_from"    label="From"        />
                <SortTh col="date_to"      label="To"          />
                <SortTh col="satsang_days" label="Days"        />
                {isDesktop && <th>Remarks</th>}
                {isDesktop && <th>Flag Reason</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} style={{
                  background: r.flag ? 'rgba(220,38,38,0.04)' : 'transparent',
                  padding: isDesktop ? '0.6rem' : '0.4rem',
                }}>
                  <td style={{ fontFamily: 'monospace', color: 'var(--gold)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {r.badge_number}
                  </td>
                  <td>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.sewadar_name}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.department || '—'}
                    </div>
                  </td>
                  {isAdmin && (
                    <td style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.centre}
                    </td>
                  )}
                  <td>
                    <span style={{ fontSize: '0.72rem', background: 'var(--gold-bg)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 999, padding: '1px 7px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {getJathaLabel(r.jatha_type)}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.jatha_centre}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.jatha_dept}
                  </td>
                  <td style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtDate(r.date_from)}</td>
                  <td style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtDate(r.date_to)}</td>
                  <td style={{ fontWeight: 700, color: 'var(--green)', textAlign: 'center' }}>{r.satsang_days}</td>
                  {isDesktop && (
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.remarks || '—'}
                    </td>
                  )}
                  {isDesktop && (
                    <td style={{ fontSize: '0.8rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.flag && r.flag_reason ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--red)', fontWeight: 600 }}>
                          <Flag size={9} /> {r.flag_reason}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  )}
                  <td>
                    {r.flag ? (
                      <span title={r.flag_reason || 'Flagged'}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', fontWeight: 600, color: 'var(--red)', background: 'var(--red-bg)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 4, padding: '2px 5px', whiteSpace: 'nowrap' }}>
                        <Flag size={9} /> Flagged
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.72rem', color: 'var(--green)', fontWeight: 600 }}>✓ OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => setPage(1)} disabled={page === 1} style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}>«</button>
          <button className="btn btn-ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}>‹</button>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Page {page} of {totalPages} · {totalCount} rows</span>
          <button className="btn btn-ghost" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}>›</button>
          <button className="btn btn-ghost" onClick={() => setPage(totalPages)} disabled={page === totalPages} style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}>»</button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
//  EDIT MODAL — ASO only
// ─────────────────────────────────────────────
function EditJathaModal({ record, saving, onSave, onClose }) {
  const [form, setForm]                   = useState({ ...record })
  const [centreOptions, setCentreOptions] = useState([])
  const [deptOptions, setDeptOptions]     = useState([])

  const satsangDays = countJathaDays(form.date_from, form.date_to)

  useEffect(() => {
    if (!form.jatha_type) return
    supabase.from('jatha_centres').select('centre_name, department')
      .eq('jatha_type', form.jatha_type).eq('is_active', true)
      .order('centre_name').order('department')
      .then(({ data }) => {
        setCentreOptions([...new Set((data || []).map(r => r.centre_name))])
        setDeptOptions((data || []).filter(r => r.centre_name === form.jatha_centre).map(r => r.department))
      })
  }, [form.jatha_type, form.jatha_centre])

  function set(key, val) { setForm(prev => ({ ...prev, [key]: val })) }

  function handleSubmit() {
    if (!form.date_from || !form.date_to) return alert('Both dates required')
    if (form.date_to < form.date_from)    return alert('End date must be after start date')
    onSave({ ...form, satsang_days: satsangDays })
  }

  const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.88rem', fontFamily: 'inherit', boxSizing: 'border-box' }
  const labelStyle = { fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.3rem', display: 'block' }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Pencil size={17} color="var(--gold)" />
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Edit Jatha Record</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        <div style={{ background: 'var(--gold-bg)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 8, padding: '0.65rem 0.85rem', marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--gold)' }}>{form.sewadar_name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{form.badge_number} · {form.centre}</div>
        </div>

        <div style={{ marginBottom: '0.85rem' }}>
          <label style={labelStyle}>Jatha Type</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
            {ALL_JATHA_TYPES.map(t => (
              <button key={t.value} onClick={() => { set('jatha_type', t.value); set('jatha_centre', ''); set('jatha_dept', '') }}
                style={{ padding: '0.5rem 0.3rem', border: `2px solid ${form.jatha_type === t.value ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 8, background: form.jatha_type === t.value ? 'var(--gold-bg)' : 'var(--bg)', color: form.jatha_type === t.value ? 'var(--gold)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {centreOptions.length > 0 && form.jatha_type === 'major_centre' && (
          <div style={{ marginBottom: '0.85rem' }}>
            <label style={labelStyle}>Major Centre</label>
            <div style={{ position: 'relative' }}>
              <select style={{ ...inputStyle, appearance: 'none', paddingRight: '2rem' }}
                value={form.jatha_centre} onChange={e => { set('jatha_centre', e.target.value); set('jatha_dept', '') }}>
                <option value="">Select centre…</option>
                {centreOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={14} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </div>
        )}

        {deptOptions.length > 0 && (
          <div style={{ marginBottom: '0.85rem' }}>
            <label style={labelStyle}>Department</label>
            <div style={{ position: 'relative' }}>
              <select style={{ ...inputStyle, appearance: 'none', paddingRight: '2rem' }}
                value={form.jatha_dept} onChange={e => set('jatha_dept', e.target.value)}>
                <option value="">Select department…</option>
                {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <ChevronDown size={14} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.85rem' }}>
          <div>
            <label style={labelStyle}>From</label>
            <input type="date" style={inputStyle} value={form.date_from}
              onChange={e => { set('date_from', e.target.value); if (form.date_to < e.target.value) set('date_to', '') }} />
          </div>
          <div>
            <label style={labelStyle}>To</label>
            <input type="date" style={inputStyle} value={form.date_to}
              min={form.date_from || undefined} onChange={e => set('date_to', e.target.value)} />
          </div>
        </div>

        {satsangDays > 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--green)', fontWeight: 600, marginBottom: '0.85rem' }}>
            ✓ {satsangDays} {satsangDays === 1 ? 'day' : 'days'} total
          </div>
        )}

        <div style={{ marginBottom: '0.85rem' }}>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{ ...inputStyle, resize: 'none' }} rows={2}
            value={form.remarks || ''} onChange={e => set('remarks', e.target.value)} placeholder="Optional notes…" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <button onClick={onClose} className="btn btn-outline btn-full">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="btn btn-gold btn-full" style={{ fontWeight: 700 }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
//  MAIN PAGE
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  MAIN PAGE
// ─────────────────────────────────────────────
export default function JathaPage() {
  const [tab, setTab] = useState('mark')

  const TABS = [
    { key: 'mark',  label: 'Mark Jatha'   },
    { key: 'view',  label: 'View Records' },
    { key: 'table', label: 'Table View'   },
  ]

  // Table tab expands to full width; form tabs stay narrow for UX
  const isTableTab = tab === 'table'

  return (
    <div className="page pb-nav" style={{
      maxWidth: isTableTab ? '100%' : 600,
      padding: '0 1rem',
      margin: '0 auto',
    }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>Jatha Attendance</h2>
      </div>

      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', background: 'var(--bg-elevated)', borderRadius: 10, padding: '0.25rem', border: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '0.55rem', borderRadius: 8, border: 'none',
              background: tab === t.key ? 'var(--bg)' : 'transparent',
              color: tab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: tab === t.key ? 700 : 400, fontSize: '0.82rem',
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
              transition: 'all 0.12s'
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'mark'  && <MarkJathaTab />}
      {tab === 'view'  && <ViewJathaTab />}
      {tab === 'table' && <JathaTableTab />}
    </div>
  )
}