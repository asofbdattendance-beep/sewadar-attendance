import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, countSatsangDays, validateJathaRange, JATHA_TYPE, JATHA_TYPE_LABEL } from '../lib/supabase'
import { Search, Calendar, Flag, CheckCircle, ChevronDown, User, MapPin, AlertTriangle, X } from 'lucide-react'

export default function JathaPage() {
  const { profile } = useAuth()

  // Step 1 — badge search
  const [badgeInput, setBadgeInput]   = useState('')
  const [searching, setSearching]     = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [selected, setSelected]       = useState(null)

  // Step 2 — jatha form
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [jathaType, setJathaType] = useState('')             // 'major_centre' | 'beas'
  const [jathaCentreOptions, setJathaCentreOptions] = useState([])   // [{centre_name, department}]
  const [jathaCentre, setJathaCentre] = useState('')
  const [jathaDept, setJathaDept]     = useState('')
  const [remarks, setRemarks]         = useState('')
  const [flagEntry, setFlagEntry]     = useState(false)
  const [flagReason, setFlagReason]   = useState('')

  // Derived
  const [dateError, setDateError]     = useState('')
  const [satsangDays, setSatsangDays] = useState(0)

  // UI state
  const [submitting, setSubmitting]   = useState(false)
  const [success, setSuccess]         = useState(false)
  const [error, setError]             = useState('')

  // Unique centre names for the selected jatha_type
  const uniqueCentreNames = [...new Set(jathaCentreOptions.map(r => r.centre_name))]
  // Departments for the selected centre
  const deptOptions = jathaCentreOptions
    .filter(r => r.centre_name === jathaCentre)
    .map(r => r.department)

  // Load jatha centre options when type changes
  useEffect(() => {
    if (!jathaType) { setJathaCentreOptions([]); setJathaCentre(''); setJathaDept(''); return }
    supabase.from('jatha_centres')
      .select('centre_name, department')
      .eq('jatha_type', jathaType)
      .eq('is_active', true)
      .order('centre_name').order('department')
      .then(({ data }) => {
        setJathaCentreOptions(data || [])
        setJathaCentre('')
        setJathaDept('')
      })
  }, [jathaType])

  // Recalc satsang days whenever dates change
  useEffect(() => {
    const err = validateJathaRange(dateFrom, dateTo)
    setDateError(err || '')
    if (!err && dateFrom && dateTo) {
      setSatsangDays(countSatsangDays(dateFrom, dateTo))
    } else {
      setSatsangDays(0)
    }
  }, [dateFrom, dateTo])

  async function searchBadge() {
    const term = badgeInput.trim()
    if (!term) return
    setSearching(true)
    const { data } = await supabase.from('sewadars')
      .select('*')
      .or(`badge_number.ilike.%${term.toUpperCase()}%,sewadar_name.ilike.%${term}%`)
      .limit(10)
    setSearchResults(data || [])
    setSearching(false)
  }

  function selectSewadar(s) {
    setSelected(s)
    setSearchResults([])
    setBadgeInput(s.badge_number)
    setSuccess(false)
    setError('')
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
      badge_number:      selected.badge_number,
      sewadar_name:      selected.sewadar_name,
      centre:            selected.centre,
      department:        selected.department || null,
      jatha_type:        jathaType,
      jatha_centre:      jathaCentre,
      jatha_dept:        jathaDept,
      date_from:         dateFrom,
      date_to:           dateTo,
      satsang_days:      satsangDays,
      remarks:           remarks.trim() || null,
      flag:              flagEntry,
      flag_reason:       flagEntry ? flagReason.trim() : null,
      submitted_by:      profile.badge_number,
      submitted_name:    profile.name,
      submitted_centre:  profile.centre,
    })
    await supabase.from('logs').insert({
      user_badge: profile.badge_number,
      action: 'JATHA_ATTENDANCE',
      details: `Jatha submitted for ${selected.badge_number} → ${jathaCentre} (${jathaType}) ${dateFrom}–${dateTo}`,
      timestamp: new Date().toISOString()
    })
    setSubmitting(false)
    if (dbErr) { setError(dbErr.message); return }
    setSuccess(true)
    // Reset form (keep sewadar selected for quick re-entry)
    setDateFrom(''); setDateTo(''); setJathaType(''); setJathaCentre('')
    setJathaDept(''); setRemarks(''); setFlagEntry(false); setFlagReason('')
    setSatsangDays(0)
  }

  return (
    <div className="page pb-nav" style={{ maxWidth: 600 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>Jatha Attendance</h2>
        <p className="text-muted text-xs mt-1">Record sewadar jatha at Major Centre or Beas</p>
      </div>

      {/* ── Step 1: Badge search ── */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          1 · Find Sewadar
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <div className="search-box" style={{ flex: 1 }}>
            <Search size={14} />
            <input
              type="text" placeholder="Badge number or name…"
              value={badgeInput}
              onChange={e => { setBadgeInput(e.target.value); setSelected(null) }}
              onKeyDown={e => e.key === 'Enter' && searchBadge()}
            />
            {badgeInput && (
              <button onClick={() => { setBadgeInput(''); setSelected(null); setSearchResults([]) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={14} />
              </button>
            )}
          </div>
          <button className="btn btn-gold" onClick={searchBadge} disabled={searching}>
            {searching ? '…' : 'Search'}
          </button>
        </div>

        {/* Search results */}
        {searchResults.length > 0 && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {searchResults.map((s, i) => (
              <button key={s.badge_number} onClick={() => selectSewadar(s)}
                style={{
                  display: 'flex', width: '100%', alignItems: 'center', gap: '0.75rem',
                  padding: '0.7rem 0.85rem', background: 'none', border: 'none',
                  borderBottom: i < searchResults.length - 1 ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer', textAlign: 'left'
                }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--gold-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <User size={15} color="var(--gold)" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{s.sewadar_name}</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{s.centre} · {s.department || '—'}</div>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gold)' }}>{s.badge_number}</span>
              </button>
            ))}
          </div>
        )}

        {/* Selected sewadar chip */}
        {selected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'var(--gold-bg)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 8, padding: '0.6rem 0.85rem', marginTop: searchResults.length ? '0.5rem' : 0 }}>
            <CheckCircle size={16} color="var(--gold)" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{selected.sewadar_name}</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{selected.badge_number} · {selected.centre} · {selected.department || '—'}</div>
            </div>
            <button onClick={() => { setSelected(null); setBadgeInput('') }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
              <X size={15} />
            </button>
          </div>
        )}
      </div>

      {/* ── Step 2: Dates ── */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          2 · Jatha Dates
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.6rem' }}>
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={dateFrom}
              onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={dateTo}
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
            <strong>{satsangDays}</strong> satsang {satsangDays === 1 ? 'day' : 'days'}
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 2 }}>
              (Sundays &amp; Wednesdays in range)
            </span>
          </div>
        )}
      </div>

      {/* ── Step 3: Jatha destination ── */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          3 · Jatha Destination
        </div>

        {/* Type selector */}
        <label className="label">Type</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.85rem' }}>
          {[JATHA_TYPE.MAJOR_CENTRE, JATHA_TYPE.BEAS].map(t => (
            <button key={t} onClick={() => setJathaType(t)}
              style={{
                padding: '0.6rem', border: `2px solid ${jathaType === t ? 'var(--gold)' : 'var(--border)'}`,
                borderRadius: 8, background: jathaType === t ? 'var(--gold-bg)' : 'var(--bg)',
                color: jathaType === t ? 'var(--gold)' : 'var(--text-secondary)',
                fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                transition: 'all 0.12s'
              }}>
              {JATHA_TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        {/* Centre (only for major_centre) */}
        {jathaType === JATHA_TYPE.MAJOR_CENTRE && (
          <>
            <label className="label">Major Centre</label>
            <div style={{ position: 'relative', marginBottom: '0.85rem' }}>
              <select className="input" value={jathaCentre}
                onChange={e => { setJathaCentre(e.target.value); setJathaDept('') }}
                style={{ appearance: 'none', paddingRight: '2.5rem' }}>
                <option value="">Select centre…</option>
                {uniqueCentreNames.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={15} style={{ position: 'absolute', right: '0.85rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </>
        )}

        {/* For beas, set centre automatically */}
        {jathaType === JATHA_TYPE.BEAS && !jathaCentre && uniqueCentreNames.length > 0 && (() => {
          // auto-select Beas centre on next render
          setTimeout(() => setJathaCentre(uniqueCentreNames[0]), 0)
          return null
        })()}

        {/* Department */}
        {jathaType && (jathaCentre || jathaType === JATHA_TYPE.BEAS) && deptOptions.length > 0 && (
          <>
            <label className="label">Department at {jathaType === JATHA_TYPE.BEAS ? 'Beas' : jathaCentre}</label>
            <div style={{ position: 'relative' }}>
              <select className="input" value={jathaDept} onChange={e => setJathaDept(e.target.value)}
                style={{ appearance: 'none', paddingRight: '2.5rem' }}>
                <option value="">Select department…</option>
                {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <ChevronDown size={15} style={{ position: 'absolute', right: '0.85rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </>
        )}

        {jathaType && jathaCentreOptions.length === 0 && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            No centres configured. Ask Super Admin to add entries under Jatha Centres.
          </p>
        )}
      </div>

      {/* ── Step 4: Remarks & Flag ── */}
      <div className="card mb-3" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          4 · Remarks &amp; Flag
        </div>
        <label className="label">Remarks <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>(optional)</span></label>
        <textarea className="input" rows={2} placeholder="Any notes about this jatha…"
          value={remarks} onChange={e => setRemarks(e.target.value)}
          style={{ resize: 'none', marginBottom: '0.85rem' }} />

        <button onClick={() => setFlagEntry(f => !f)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
            background: flagEntry ? 'rgba(198,40,40,0.08)' : 'var(--bg)',
            border: `1.5px solid ${flagEntry ? 'rgba(198,40,40,0.35)' : 'var(--border)'}`,
            borderRadius: 8, padding: '0.6rem 0.85rem',
            cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.12s'
          }}>
          <Flag size={15} color={flagEntry ? 'var(--red)' : 'var(--text-muted)'} />
          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: flagEntry ? 'var(--red)' : 'var(--text-secondary)' }}>
            Flag this entry
          </span>
          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {flagEntry ? 'ON' : 'OFF'}
          </span>
        </button>

        {flagEntry && (
          <div style={{ marginTop: '0.75rem' }}>
            <label className="label">Flag reason <span style={{ color: 'var(--red)' }}>*</span></label>
            <textarea className="input" rows={2} placeholder="Describe the issue…"
              value={flagReason} onChange={e => setFlagReason(e.target.value)}
              style={{ resize: 'none', borderColor: 'rgba(198,40,40,0.35)' }} />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(198,40,40,0.08)', border: '1px solid rgba(198,40,40,0.25)', borderRadius: 8, padding: '0.7rem 0.85rem', marginBottom: '0.85rem', color: 'var(--red)', fontSize: '0.85rem' }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* Success */}
      {success && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', borderRadius: 8, padding: '0.7rem 0.85rem', marginBottom: '0.85rem', color: 'var(--green)', fontSize: '0.85rem', fontWeight: 600 }}>
          <CheckCircle size={15} /> Jatha attendance recorded successfully!
        </div>
      )}

      {/* Submit */}
      <button className="btn btn-gold btn-full" onClick={submitJatha}
        disabled={submitting || !selected || !!dateError || !jathaType || !jathaCentre || !jathaDept}
        style={{ padding: '0.85rem', fontSize: '0.95rem', fontWeight: 700 }}>
        {submitting ? 'Saving…' : 'Submit Jatha Attendance'}
      </button>
    </div>
  )
}
