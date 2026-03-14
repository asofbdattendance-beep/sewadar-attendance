// JathaPage.jsx — Two tabs: Mark Jatha + View Jatha Records
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, countSatsangDays, validateJathaRange, JATHA_TYPE, JATHA_TYPE_LABEL } from '../lib/supabase'
import { Search, Calendar, Flag, CheckCircle, ChevronDown, MapPin, AlertTriangle, X, RefreshCw, Plane } from 'lucide-react'

// ─────────────────────────────────────────────
//  TAB 1 — MARK JATHA ATTENDANCE (original form)
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
  const [flagEntry, setFlagEntry] = useState(false)
  const [flagReason, setFlagReason] = useState('')

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
    const err = validateJathaRange(dateFrom, dateTo)
    setDateError(err || '')
    if (!err && dateFrom && dateTo) setSatsangDays(countSatsangDays(dateFrom, dateTo))
    else setSatsangDays(0)
  }, [dateFrom, dateTo])

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
    const err = validateJathaRange(dateFrom, dateTo)
    if (err) { setError(err); return }
    if (!jathaType) { setError('Select Jatha type'); return }
    if (!jathaCentre) { setError('Select a Jatha centre'); return }
    if (!jathaDept) { setError('Select a department'); return }
    if (flagEntry && !flagReason.trim()) { setError('Please describe the flag reason'); return }

    setSubmitting(true); setError('')
    const { error: dbErr } = await supabase.from('jatha_attendance').insert({
      badge_number: selected.badge_number, sewadar_name: selected.sewadar_name,
      centre: selected.centre, department: selected.department || null,
      jatha_type: jathaType, jatha_centre: jathaCentre, jatha_dept: jathaDept,
      date_from: dateFrom, date_to: dateTo, satsang_days: satsangDays,
      remarks: remarks.trim() || null, flag: flagEntry,
      flag_reason: flagEntry ? flagReason.trim() : null,
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
    setJathaDept(''); setRemarks(''); setFlagEntry(false); setFlagReason(''); setSatsangDays(0)
  }

  return (
    <div>
      {/* Step 1: Find Sewadar */}
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

      {/* Step 2: Dates */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          2 · Jatha Dates
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.6rem' }}>
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
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
            <strong>{satsangDays}</strong> satsang {satsangDays === 1 ? 'day' : 'days'}
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 2 }}>(Sundays &amp; Wednesdays)</span>
          </div>
        )}
      </div>

      {/* Step 3: Destination */}
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

      {/* Step 4: Remarks & Flag */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          4 · Remarks &amp; Flag
        </div>
        <label className="label">Remarks <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>(optional)</span></label>
        <textarea className="input" rows={2} placeholder="Any notes…" value={remarks} onChange={e => setRemarks(e.target.value)} style={{ resize: 'none', marginBottom: '0.85rem' }} />

        <button onClick={() => setFlagEntry(f => !f)}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', background: flagEntry ? 'rgba(198,40,40,0.08)' : 'var(--bg)', border: `1.5px solid ${flagEntry ? 'rgba(198,40,40,0.35)' : 'var(--border)'}`, borderRadius: 8, padding: '0.6rem 0.85rem', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s' }}>
          <Flag size={15} color={flagEntry ? 'var(--red)' : 'var(--text-muted)'} />
          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: flagEntry ? 'var(--red)' : 'var(--text-secondary)' }}>Flag this entry</span>
          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{flagEntry ? 'ON' : 'OFF'}</span>
        </button>

        {flagEntry && (
          <div style={{ marginTop: '0.75rem' }}>
            <label className="label">Flag reason <span style={{ color: 'var(--red)' }}>*</span></label>
            <textarea className="input" rows={2} placeholder="Describe the issue…" value={flagReason} onChange={e => setFlagReason(e.target.value)} style={{ resize: 'none', borderColor: 'rgba(198,40,40,0.35)' }} />
          </div>
        )}
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
        disabled={submitting || !selected || !!dateError || !jathaType || !jathaCentre || !jathaDept}
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
    ? records.filter(r => r.sewadar_name?.toLowerCase().includes(searchTerm.toLowerCase()) || r.badge_number?.toUpperCase().includes(searchTerm.toUpperCase()))
    : records

  const totalSatsangDays = filtered.reduce((acc, r) => acc + (r.satsang_days || 0), 0)

  function fmtDate(d) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
  }

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Showing </span>
          <strong>{filtered.length}</strong>
          <span style={{ color: 'var(--text-muted)' }}> jatha records</span>
        </div>
        <div style={{ background: 'var(--gold-bg)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 8, padding: '0.4rem 0.85rem', fontSize: '0.8rem', color: 'var(--gold)' }}>
          <strong>{totalSatsangDays}</strong> satsang days total
        </div>
      </div>

      {/* Filters */}
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
        {monthFilter && <button onClick={() => setMonthFilter('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}><X size={14} /></button>}
        <button className="btn btn-ghost" onClick={fetchRecords} style={{ padding: '0.4rem 0.6rem' }}><RefreshCw size={15} /></button>
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
                  <div style={{ fontSize: '0.78rem', color: 'var(--green)', fontWeight: 700, marginTop: '0.2rem' }}>{r.satsang_days} satsang {r.satsang_days === 1 ? 'day' : 'days'}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>by {r.submitted_name || r.submitted_by}</div>
                </div>
              </div>
              {r.remarks && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.35rem 0.6rem', marginTop: '0.5rem' }}>
                  {r.remarks}
                </div>
              )}
              {r.flag && r.flag_reason && (
                <div style={{ fontSize: '0.78rem', color: 'var(--red)', background: 'rgba(198,40,40,0.05)', border: '1px solid rgba(198,40,40,0.2)', borderRadius: 6, padding: '0.35rem 0.6rem', marginTop: '0.4rem', display: 'flex', gap: '0.35rem', alignItems: 'flex-start' }}>
                  <Flag size={11} style={{ marginTop: 2, flexShrink: 0 }} /> {r.flag_reason}
                </div>
              )}
            </div>
          ))}
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

  return (
    <div className="page pb-nav" style={{ maxWidth: 600 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>Jatha Attendance</h2>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', background: 'var(--bg-elevated)', borderRadius: 10, padding: '0.25rem', border: '1px solid var(--border)' }}>
        <button onClick={() => setTab('mark')}
          style={{ flex: 1, padding: '0.55rem', borderRadius: 8, border: 'none', background: tab === 'mark' ? 'var(--bg)' : 'transparent', color: tab === 'mark' ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: tab === 'mark' ? 700 : 400, fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'inherit', boxShadow: tab === 'mark' ? '0 1px 3px rgba(0,0,0,0.15)' : 'none', transition: 'all 0.12s' }}>
          Mark Jatha
        </button>
        <button onClick={() => setTab('view')}
          style={{ flex: 1, padding: '0.55rem', borderRadius: 8, border: 'none', background: tab === 'view' ? 'var(--bg)' : 'transparent', color: tab === 'view' ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: tab === 'view' ? 700 : 400, fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'inherit', boxShadow: tab === 'view' ? '0 1px 3px rgba(0,0,0,0.15)' : 'none', transition: 'all 0.12s' }}>
          View Records
        </button>
      </div>

      {tab === 'mark' && <MarkJathaTab />}
      {tab === 'view' && <ViewJathaTab />}
    </div>
  )
}
