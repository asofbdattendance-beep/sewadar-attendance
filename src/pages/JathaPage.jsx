// JathaPage.jsx — Two tabs: Mark Jatha + View Jatha Records
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, countSatsangDays, JATHA_TYPE, JATHA_TYPE_LABEL } from '../lib/supabase'
import { Search, Calendar, CheckCircle, ChevronDown, MapPin, AlertTriangle, X, RefreshCw, Plane, Download, Flag } from 'lucide-react'

function validateRange(from, to) {
  if (!from || !to) return null
  const f = new Date(from + 'T00:00:00')
  const t = new Date(to + 'T00:00:00')
  if (t < f) return 'End date must be on or after start date'
  const diff = Math.round((t - f) / 86400000)
  if (diff > 10) return `Range is ${diff} days — maximum allowed is 10 days`
  return null
}

// ─────────────────────────────────────────────
//  TAB 1 — MARK JATHA ATTENDANCE
// ─────────────────────────────────────────────
function MarkJathaTab() {
  const { profile } = useAuth()

  const [badgeInput, setBadgeInput] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [selected, setSelected] = useState(null)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [jathaType, setJathaType] = useState('')
  const [jathaCentreOptions, setJathaCentreOptions] = useState([])
  const [jathaCentre, setJathaCentre] = useState('')
  const [jathaDept, setJathaDept] = useState('')
  const [remarks, setRemarks] = useState('')

  const [dateError, setDateError] = useState('')
  const [satsangDays, setSatsangDays] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const uniqueCentreNames = [...new Set(jathaCentreOptions.map(r => r.centre_name))]
  const deptOptions = jathaCentreOptions.filter(r => r.centre_name === jathaCentre).map(r => r.department)

  useEffect(() => {
    if (!jathaType) { setJathaCentreOptions([]); setJathaCentre(''); setJathaDept(''); return }
    supabase.from('jatha_centres').select('centre_name, department')
      .eq('jatha_type', jathaType).eq('is_active', true).order('centre_name').order('department')
      .then(({ data }) => { setJathaCentreOptions(data || []); setJathaCentre(''); setJathaDept('') })
  }, [jathaType])

  useEffect(() => {
    const err = validateRange(dateFrom, dateTo)
    setDateError(err || '')
    if (!err && dateFrom && dateTo) setSatsangDays(countSatsangDays(dateFrom, dateTo))
    else setSatsangDays(0)
  }, [dateFrom, dateTo])

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
    setSelected(s); setSearchResults([]); setBadgeInput(s.badge_number); setSuccess(false); setError('')
  }

  async function submitJatha() {
    if (!selected) { setError('Select a sewadar first'); return }
    const err = validateRange(dateFrom, dateTo)
    if (err) { setError(err); return }
    if (!dateFrom || !dateTo) { setError('Both dates are required'); return }
    if (!jathaType) { setError('Select Jatha type'); return }
    if (!jathaCentre) { setError('Select a Jatha centre'); return }
    if (!jathaDept) { setError('Select a department'); return }

    setSubmitting(true); setError('')

    // Duplicate check: same sewadar + overlapping dates
    const { data: existing } = await supabase.from('jatha_attendance')
      .select('id, date_from, date_to')
      .eq('badge_number', selected.badge_number)
      .gte('date_to', dateFrom)
      .lte('date_from', dateTo)
    if (existing && existing.length > 0) {
      setError(`Duplicate: overlapping jatha record already exists (${existing[0].date_from} – ${existing[0].date_to})`)
      setSubmitting(false); return
    }

    const { error: dbErr } = await supabase.from('jatha_attendance').insert({
      badge_number: selected.badge_number, sewadar_name: selected.sewadar_name,
      centre: selected.centre, department: selected.department || null,
      jatha_type: jathaType, jatha_centre: jathaCentre, jatha_dept: jathaDept,
      date_from: dateFrom, date_to: dateTo, satsang_days: satsangDays,
      remarks: remarks.trim() || null,
      flag: false, flag_reason: null,
      submitted_by: profile.badge_number, submitted_name: profile.name, submitted_centre: profile.centre,
    })
    await supabase.from('logs').insert({
      user_badge: profile.badge_number, action: 'JATHA_ATTENDANCE',
      details: `Jatha submitted for ${selected.badge_number} → ${jathaCentre} (${jathaType}) ${dateFrom}–${dateTo}`,
      timestamp: new Date().toISOString()
    })
    setSubmitting(false)
    if (dbErr) { setError(dbErr.message); return }
    setSuccess(true)
    setDateFrom(''); setDateTo(''); setJathaType(''); setJathaCentre('')
    setJathaDept(''); setRemarks(''); setSatsangDays(0)
  }

  const canSubmit = selected && dateFrom && dateTo && !dateError && jathaType && jathaCentre && jathaDept

  return (
    <div>
      {/* Step 1 */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          1 · Find Sewadar
        </div>
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
            {searchResults.map((s) => (
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
            <button onClick={() => { setSelected(null); setBadgeInput('') }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
              <X size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Step 2 */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          2 · Jatha Dates
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.6rem' }}>
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={dateFrom}
              onChange={e => handleDateFromChange(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={dateTo}
              min={dateFrom || undefined}
              onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>
        {dateError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--red)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            <AlertTriangle size={13} /> {dateError}
          </div>
        )}
        {!dateError && satsangDays > 0 && (
          <div className="jatha-satsang-pill">
            <Calendar size={13} />
            <strong>{satsangDays}</strong> {satsangDays === 1 ? 'day' : 'days'} total
          </div>
        )}
        {false && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
            End date must be after start date.
          </div>
        )}
      </div>

      {/* Step 3 */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          3 · Jatha Destination
        </div>
        <label className="label">Type</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.85rem' }}>
          {[JATHA_TYPE.MAJOR_CENTRE, JATHA_TYPE.BEAS].map(t => (
            <button key={t} onClick={() => setJathaType(t)}
              style={{ padding: '0.6rem', border: `2px solid ${jathaType === t ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 8, background: jathaType === t ? 'var(--gold-bg)' : 'var(--bg)', color: jathaType === t ? 'var(--gold)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s' }}>
              {JATHA_TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        {jathaType === JATHA_TYPE.MAJOR_CENTRE && (
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

        {jathaType === JATHA_TYPE.BEAS && !jathaCentre && uniqueCentreNames.length > 0 && (() => {
          setTimeout(() => setJathaCentre(uniqueCentreNames[0]), 0); return null
        })()}

        {jathaType && (jathaCentre || jathaType === JATHA_TYPE.BEAS) && deptOptions.length > 0 && (
          <>
            <label className="label">Department at {jathaType === JATHA_TYPE.BEAS ? 'Beas' : jathaCentre}</label>
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
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>No centres configured. Ask Super Admin.</p>
        )}
      </div>

      {/* Step 4: Remarks only — no flag on creation */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          4 · Remarks
        </div>
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
        {submitting ? 'Saving…' : 'Submit Jatha Attendance'}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────
//  TAB 2 — VIEW JATHA RECORDS
// ─────────────────────────────────────────────
function ViewJathaTab() {
  const { profile } = useAuth()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')

  const [flagModal, setFlagModal] = useState(null)
  const [flagReason, setFlagReason] = useState('')
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [flagSuccess, setFlagSuccess] = useState(false)

  const isAdmin = [ROLES.ASO, ROLES.CENTRE_USER].includes(profile?.role)

  useEffect(() => { fetchRecords() }, [typeFilter, monthFilter])

  async function fetchRecords() {
    setLoading(true)
    let q = supabase.from('jatha_attendance').select('*').order('created_at', { ascending: false }).limit(300)

    if (typeFilter) q = q.eq('jatha_type', typeFilter)
    if (monthFilter) {
      const [year, month] = monthFilter.split('-')
      const start = `${year}-${month}-01`
      const end = new Date(year, month, 0).toISOString().split('T')[0]
      q = q.gte('date_from', start).lte('date_from', end)
    }

    if (profile?.role === ROLES.SC_SP_USER) q = q.eq('submitted_centre', profile.centre)
    else if (profile?.role === ROLES.CENTRE_USER) {
      const { data: childData } = await supabase.from('centres').select('centre_name')
        .or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
      const centreNames = childData?.map(c => c.centre_name) || [profile.centre]
      q = q.in('submitted_centre', centreNames)
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

  const totalDays = filtered.reduce((acc, r) => acc + (r.satsang_days || 0), 0)
  const flaggedCount = filtered.filter(r => r.flag).length

  function fmtDate(d) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
  }

  function exportCSV() {
    const header = ['Badge', 'Name', 'Centre', 'Department', 'Jatha Type', 'Destination', 'Dept at Jatha', 'From', 'To', 'Satsang Days', 'Remarks', 'Flagged', 'Flag Reason', 'Submitted By', 'Submitted Centre', 'Submitted On']
    const rows = filtered.map(r => [
      r.badge_number,
      `"${r.sewadar_name}"`,
      r.centre,
      r.department || '',
      JATHA_TYPE_LABEL[r.jatha_type] || r.jatha_type,
      r.jatha_centre,
      r.jatha_dept,
      r.date_from,
      r.date_to,
      r.satsang_days,
      `"${r.remarks || ''}"`,
      r.flag ? 'Yes' : 'No',
      `"${r.flag_reason || ''}"`,
      r.submitted_name || r.submitted_by,
      r.submitted_centre,
      r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : ''
    ])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `jatha_records${monthFilter ? '_' + monthFilter : ''}.csv`
    a.click()
  }

  async function submitFlag() {
    if (!flagModal || !flagReason.trim()) return
    setFlagSubmitting(true)
    await supabase.from('jatha_attendance').update({ flag: true, flag_reason: flagReason.trim() }).eq('id', flagModal.id)
    await supabase.from('logs').insert({
      user_badge: profile.badge_number, action: 'FLAG_JATHA',
      details: `Flagged jatha id=${flagModal.id} (${flagModal.badge_number}): ${flagReason.trim()}`,
      timestamp: new Date().toISOString()
    })
    setFlagSubmitting(false)
    setFlagSuccess(true)
    setTimeout(() => { setFlagModal(null); setFlagReason(''); setFlagSuccess(false); fetchRecords() }, 1200)
  }

  async function removeFlag(record) {
    if (!isAdmin) return
    if (!confirm('Remove flag from this jatha record?')) return
    await supabase.from('jatha_attendance').update({ flag: false, flag_reason: null }).eq('id', record.id)
    fetchRecords()
  }

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Showing </span>
          <strong>{filtered.length}</strong>
          <span style={{ color: 'var(--text-muted)' }}> records</span>
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

      {/* Filters + Export */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="search-box" style={{ flex: 1, minWidth: 160 }}>
          <Search size={14} />
          <input type="text" placeholder="Search name or badge…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          {searchTerm && <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={13} /></button>}
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.65rem', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.82rem' }}>
          <option value="">All types</option>
          <option value="major_centre">Major Centre</option>
          <option value="beas">Beas</option>
        </select>
        <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.65rem', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.82rem' }} />
        {monthFilter && (
          <button onClick={() => setMonthFilter('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            <X size={14} />
          </button>
        )}
        <button className="btn btn-ghost" onClick={fetchRecords} style={{ padding: '0.4rem 0.6rem' }}>
          <RefreshCw size={15} />
        </button>
        <button className="btn btn-ghost" onClick={exportCSV} disabled={filtered.length === 0}
          style={{ padding: '0.4rem 0.75rem', fontSize: '0.82rem' }}>
          <Download size={14} /> Export
        </button>
      </div>

      {loading ? (
        <div className="text-center" style={{ padding: '2rem 0' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
          <Plane size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.25, display: 'block' }} />
          <p>No jatha records found</p>
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
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                    {r.centre} · {r.department || '—'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.7rem', background: 'var(--gold-bg)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 999, padding: '1px 7px', fontWeight: 700 }}>
                      {JATHA_TYPE_LABEL[r.jatha_type] || r.jatha_type}
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
                    <button onClick={() => removeFlag(r)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.72rem', flexShrink: 0, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                      Remove flag
                    </button>
                  )}
                </div>
              )}

              {!r.flag && (
                <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => { setFlagModal(r); setFlagReason(''); setFlagSuccess(false) }}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '0.25rem 0.65rem', fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'inherit' }}>
                    <Flag size={11} /> Flag error
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Flag Modal */}
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
                <textarea className="input" rows={3} placeholder="Describe the error or issue with this record…"
                  value={flagReason} onChange={e => setFlagReason(e.target.value)}
                  style={{ resize: 'none', marginBottom: '1rem', borderColor: 'rgba(198,40,40,0.35)' }}
                  autoFocus />

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
//  MAIN PAGE
// ─────────────────────────────────────────────
export default function JathaPage() {
  const [tab, setTab] = useState('mark')

  const tabStyle = (active) => ({
    flex: 1, padding: '0.55rem', borderRadius: 8, border: 'none',
    background: active ? 'var(--bg)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    fontWeight: active ? 700 : 400, fontSize: '0.88rem',
    cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
    transition: 'all 0.12s'
  })

  return (
    <div className="page pb-nav" style={{ maxWidth: 600 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>Jatha Attendance</h2>
      </div>

      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', background: 'var(--bg-elevated)', borderRadius: 10, padding: '0.25rem', border: '1px solid var(--border)' }}>
        <button onClick={() => setTab('mark')} style={tabStyle(tab === 'mark')}>Mark Jatha</button>
        <button onClick={() => setTab('view')} style={tabStyle(tab === 'view')}>View Records</button>
      </div>

      {tab === 'mark' && <MarkJathaTab />}
      {tab === 'view' && <ViewJathaTab />}
    </div>
  )
}