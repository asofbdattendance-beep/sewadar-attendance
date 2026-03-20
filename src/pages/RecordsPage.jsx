import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, FLAG_TYPES } from '../lib/supabase'
import { todayDateStr } from '../lib/offline'
import {
  Search, Download, Flag, X, RefreshCw,
  ChevronDown, Trash2, FileSpreadsheet, BarChart2,
  Calendar, Users, Plane, FileText, Columns
} from 'lucide-react'
import DateRangePicker from '../components/DateRangePicker'
import CentreComboBox from '../components/CentreComboBox'
import SkeletonRows from '../components/SkeletonRows'
import QuickFilterChips from '../components/QuickFilterChips'
import TablePagination from '../components/TablePagination'
import EmptyState from '../components/EmptyState'
import ConfirmModal from '../components/ConfirmModal'
import { showSuccess, showError } from '../components/Toast'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE = 300
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2]

// IST offset in minutes
const IST_OFFSET = 5 * 60 + 30

function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata'
  })
}

// Convert a YYYY-MM-DD date string to UTC ISO string at IST start-of-day (00:00 IST = prev day 18:30 UTC)
function istDayStart(dateStr) {
  // dateStr like "2025-03-19"
  // 00:00:00 IST = 00:00:00+05:30
  return `${dateStr}T00:00:00.000+05:30`
}

// Convert a YYYY-MM-DD date string to UTC ISO string at IST end-of-day (23:59:59.999 IST)
function istDayEnd(dateStr) {
  return `${dateStr}T23:59:59.999+05:30`
}

// Parse scan_time and return YYYY-MM-DD in IST
function scanTimeToISTDate(isoString) {
  const d = new Date(isoString)
  // shift to IST then take date portion
  const istTime = new Date(d.getTime() + IST_OFFSET * 60000)
  return istTime.toISOString().split('T')[0]
}

// Format a bare YYYY-MM-DD for display without timezone shift
function formatDateStr(dateStr) {
  // Append noon IST to avoid any local-tz shift on display
  return new Date(dateStr + 'T12:00:00+05:30').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  })
}

function csvEscape(val) {
  if (val === null || val === undefined) return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

// ─────────────────────────────────────────────
//  ATTENDANCE TAB — Paginated, server-searched
// ─────────────────────────────────────────────
function AttendanceTab() {
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE_USER
  const isAdmin = isAso || isCentreUser

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [sortCol, setSortCol] = useState('scan_time')
  const [sortDir, setSortDir] = useState('desc')
  const [searchTerm, setSearchTerm] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [dateRange, setDateRange] = useState({ from: todayDateStr(), to: todayDateStr() })
  const [centreFilter, setCentreFilter] = useState(null)
  const [quickFilter, setQuickFilter] = useState('all')
  const [quickFilterCounts, setQuickFilterCounts] = useState({ all: 0, in: 0, out: 0, flagged: 0, manual: 0 })
  const [flagDetails, setFlagDetails] = useState({})
  const [recentSearches, setRecentSearches] = useState([])
  const [centres, setCentres] = useState([])
  const [flagModal, setFlagModal] = useState(null)
  const [flagType, setFlagType] = useState('error_entry')
  const [flagNote, setFlagNote] = useState('')
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [flagSuccess, setFlagSuccess] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showColMenu, setShowColMenu] = useState(false)
  const colMenuRef = useRef(null)
  const [colToggle, setColToggle] = useState(() => {
    const saved = localStorage.getItem('records_col_toggle')
    if (saved) {
      try { return JSON.parse(saved) } catch (e) { console.warn('Failed to parse saved column toggle, using defaults:', e) }
    }
    return { badge: true, name: true, centre: true, date: true, in: true, out: true, status: true }
  })
  const [expandedRows, setExpandedRows] = useState(() => new Set())

  const searchTimerRef = useRef(null)
  const tableRef = useRef(null)
  const highlightedRowRef = useRef(-1)
  const flagSuccessTimerRef = useRef(null)

  // Load centres + recent searches
  useEffect(() => {
    fetchCentres().catch(console.error)
    const saved = localStorage.getItem('records_recent_searches')
    if (saved) {
      try { setRecentSearches(JSON.parse(saved)) }
      catch (e) { console.warn('Failed to parse recent searches:', e) }
    }
    const savedSettings = localStorage.getItem('records_settings')
    if (savedSettings) {
      try {
        const s = JSON.parse(savedSettings)
        if (s.sortCol) setSortCol(s.sortCol)
        if (s.sortDir) setSortDir(s.sortDir)
      } catch (e) {
        console.warn('Failed to parse records settings:', e)
      }
    }
  }, [])

  // Save column toggle
  useEffect(() => {
    localStorage.setItem('records_col_toggle', JSON.stringify(colToggle))
  }, [colToggle])

  // Close col menu on outside click
  useEffect(() => {
    if (!showColMenu) return
    function handler(e) {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setShowColMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColMenu])
  useEffect(() => {
    localStorage.setItem('records_settings', JSON.stringify({ sortCol, sortDir }))
  }, [sortCol, sortDir])

  // Debounced search
  useEffect(() => {
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setSearchTerm(searchInput)
      setPage(1)
    }, SEARCH_DEBOUNCE)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchInput])

  // Cleanup flag success timer on unmount
  useEffect(() => {
    return () => clearTimeout(flagSuccessTimerRef.current)
  }, [])

  // Fetch records
  useEffect(() => {
    fetchRecords().catch(console.error)
  }, [page, sortCol, sortDir, searchTerm, dateRange, centreFilter, quickFilter, profile])

  async function fetchCentres() {
    let q = supabase.from('centres').select('centre_name, parent_centre').order('centre_name')
    if (isCentreUser) {
      q = supabase.from('centres').select('centre_name, parent_centre')
        .or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
        .order('centre_name')
    }
    const { data } = await q
    setCentres(data || [])
  }

  async function fetchRecords() {
    setLoading(true)

    const start = istDayStart(dateRange.from)
    const end   = istDayEnd(dateRange.to)

    // ── Build centre scope ──
    let centreScope = null
    if (profile?.role === ROLES.SC_SP_USER && profile?.centre) {
      centreScope = [profile.centre]
    } else if (isCentreUser) {
      centreScope = [
        profile.centre,
        ...centres.filter(c => c.parent_centre === profile.centre).map(c => c.centre_name)
      ]
    } else if (centreFilter) {
      centreScope = [centreFilter]
    }

    // ── Direct query with client-side grouping ──
    let q = supabase
      .from('attendance')
      .select('id, badge_number, sewadar_name, centre, department, scan_time, type, scanner_name, manual_entry')
      .gte('scan_time', start)
      .lte('scan_time', end)
      .order('scan_time', { ascending: false })

    if (centreScope?.length) q = q.in('centre', centreScope)
    if (searchTerm.trim()) q = q.or(`badge_number.ilike.%${searchTerm.trim()}%,sewadar_name.ilike.%${searchTerm.trim()}%`)

    const { data, error } = await q.limit(5000)

    setLoading(false)
    if (error) {
      console.warn('[Records] Query error:', error?.message || error?.code || error)
      return
    }

    // ── Group by badge_number + IST date, then build sessions ──
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
    const dayMap = {}   // key → { meta, scans[] }
    for (const r of (data || [])) {
      const istDate = new Date(new Date(r.scan_time).getTime() + IST_OFFSET_MS).toISOString().split('T')[0]
      const key = `${r.badge_number}::${istDate}`
      if (!dayMap[key]) {
        dayMap[key] = {
          badge_number: r.badge_number, sewadar_name: r.sewadar_name,
          centre: r.centre, department: r.department, date: istDate,
          scans: []
        }
      }
      dayMap[key].scans.push({ id: r.id, type: r.type, scan_time: r.scan_time, scanner_name: r.scanner_name, manual_entry: r.manual_entry })
    }

    // For each day-group, sort scans chronologically and pair them into sessions
    // Session = { in_time, in_id, in_scanner, out_time, out_id, out_scanner, manual_entry }
    // Algorithm: walk sorted scans, each IN starts a new session, next OUT closes it.
    // Any orphaned INs or OUTs get their own session with the other side null.
    function buildSessions(scans) {
      const sorted = [...scans].sort((a, b) => new Date(a.scan_time) - new Date(b.scan_time))
      const sessions = []
      let current = null
      for (const s of sorted) {
        if (s.type === 'IN') {
          // Close any open session that has no OUT yet
          if (current) sessions.push(current)
          current = { in_time: s.scan_time, in_id: s.id, in_scanner: s.scanner_name,
                      out_time: null, out_id: null, out_scanner: null,
                      manual_entry: !!s.manual_entry }
        } else { // OUT
          if (current && !current.out_time) {
            // Close current session
            current.out_time = s.scan_time
            current.out_id   = s.id
            current.out_scanner = s.scanner_name
            if (s.manual_entry) current.manual_entry = true
            sessions.push(current)
            current = null
          } else {
            // Orphan OUT — no matching IN
            sessions.push({ in_time: null, in_id: null, in_scanner: null,
                            out_time: s.scan_time, out_id: s.id, out_scanner: s.scanner_name,
                            manual_entry: !!s.manual_entry })
          }
        }
      }
      if (current) sessions.push(current)  // trailing IN with no OUT
      return sessions
    }

    const rpcData = Object.values(dayMap).map(g => {
      const sessions = buildSessions(g.scans)
      const firstIn  = sessions.find(s => s.in_time)
      const lastOut  = [...sessions].reverse().find(s => s.out_time)
      const anyManual = sessions.some(s => s.manual_entry)
      return {
        badge_number: g.badge_number, sewadar_name: g.sewadar_name,
        centre: g.centre, department: g.department, date: g.date,
        in_time:     firstIn?.in_time   || null,
        in_id:       firstIn?.in_id     || null,
        in_scanner:  firstIn?.in_scanner|| null,
        out_time:    lastOut?.out_time  || null,
        out_id:      lastOut?.out_id    || null,
        out_scanner: lastOut?.out_scanner || null,
        manual_entry: anyManual,
        sessions,   // ← all sessions for this badge+day
      }
    })

    // ── Normalise: attach raw_in/raw_out stubs for flag lookups ──
    let rows = rpcData.map(r => ({
      badge_number: r.badge_number,
      sewadar_name: r.sewadar_name,
      centre:       r.centre,
      department:   r.department,
      date:         r.date,
      in_time:      r.in_time  || null,
      out_time:     r.out_time || null,
      in_scanner:   r.in_scanner  || null,
      out_scanner:  r.out_scanner || null,
      in_id:        r.in_id  || null,
      out_id:       r.out_id || null,
      manual_entry: r.manual_entry || false,
      sessions:     r.sessions || [],   // all IN/OUT sessions for this badge+day
      raw_in:  r.in_id  ? { id: r.in_id  } : null,
      raw_out: r.out_id ? { id: r.out_id } : null,
    }))

    // ───── FETCH FLAGS FOR CURRENT PAGE ─────
    const { flaggedCount, flagMap } = await fetchFlagsForCurrentPage(rows)

    // ───── APPLY QUICK FILTERS (done before counts so chips match table) ─────
    if (quickFilter === 'in') {
      rows = rows.filter(r => r.in_time && !r.out_time)
    } else if (quickFilter === 'out') {
      rows = rows.filter(r => r.out_time && !r.in_time)
    } else if (quickFilter === 'manual') {
      rows = rows.filter(r => r.manual_entry)
    } else if (quickFilter === 'flagged') {
      rows = rows.filter(r =>
        (r.raw_in?.id && flagMap[r.raw_in.id]) ||
        (r.raw_out?.id && flagMap[r.raw_out.id])
      )
    }

    // ───── QUICK FILTER COUNTS — server-side RPC scoped to centres + search ─────
    let serverCounts = {}
    try {
      const { data: countData } = await supabase.rpc('get_attendance_counts', {
        p_start: start,
        p_end: end,
        p_centres: centreScope,
        p_search: searchTerm.trim() || null,
      })
      serverCounts = countData?.[0] || {}
    } catch (e) {
      console.warn('[Records] Counts RPC failed, computing locally:', e)
      const unfilteredRows = rpcData
      const inOnly = unfilteredRows.filter(r => r.in_time && !r.out_time).length
      const outOnly = unfilteredRows.filter(r => r.out_time && !r.in_time).length
      const manual = unfilteredRows.filter(r => r.manual_entry).length
      serverCounts = { total: unfilteredRows.length, in_only: inOnly, out_only: outOnly, manual }
    }
    setQuickFilterCounts({
      all: serverCounts.total || rows.length,
      in: serverCounts.in_only || 0,
      out: serverCounts.out_only || 0,
      manual: serverCounts.manual || 0,
      flagged: flaggedCount,
    })

    // ───── PAGINATION ─────
    setTotalCount(rows.length)
    const pageStart = (page - 1) * PAGE_SIZE
    setRecords(rows.slice(pageStart, pageStart + PAGE_SIZE))
  }

  // Returns { flagMap: {attendance_id→flagInfo}, flaggedCount: number }
  async function fetchFlagsForCurrentPage(rows) {
    if (!rows || rows.length === 0) {
      setFlagDetails({})
      return { flagMap: {}, flaggedCount: 0 }
    }

    const ids = []
    rows.forEach(r => {
      if (r.raw_in?.id) ids.push(r.raw_in.id)
      if (r.raw_out?.id) ids.push(r.raw_out.id)
    })

    if (ids.length === 0) {
      setFlagDetails({})
      return { flagMap: {}, flaggedCount: 0 }
    }

    let q = supabase
      .from('queries')
      .select('attendance_id, flag_type, issue_description, raised_by_name, raised_by_badge, created_at, status')
      .in('attendance_id', ids)
      .eq('status', 'open')

    if (isCentreUser && profile?.centre) {
      const scope = [profile.centre]
      const childData = centres
        .filter(c => c.parent_centre === profile.centre)
        .map(c => c.centre_name)
      scope.push(...childData)
      q = q.in('target_centre', scope)
    }

    const { data, error } = await q

    if (error) {
      console.warn('[Records] Flag fetch failed:', error)
      return { flagMap: {}, flaggedCount: 0 }
    }

    const flagMap = {}
    ;(data || []).forEach(q => {
      flagMap[q.attendance_id] = {
        flag_type: q.flag_type,
        issue_description: q.issue_description,
        raised_by_name: q.raised_by_name,
        raised_by_badge: q.raised_by_badge,
        created_at: q.created_at,
        status: q.status,
      }
    })

    const flaggedCount = rows.filter(r =>
      (r.raw_in && flagMap[r.raw_in.id]) ||
      (r.raw_out && flagMap[r.raw_out.id])
    ).length

    setFlagDetails(flagMap)
    return { flagMap, flaggedCount }
  }

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('desc')
    }
    setPage(1)
  }

  function addRecentSearch(term) {
    if (!term.trim()) return
    const updated = [term, ...recentSearches.filter(s => s !== term)].slice(0, 5)
    setRecentSearches(updated)
    localStorage.setItem('records_recent_searches', JSON.stringify(updated))
  }

  async function submitFlag() {
    if (!flagModal || !profile) return
    setFlagSubmitting(true)
    const record = flagModal.raw_in || flagModal.raw_out
    const { error } = await supabase.from('queries').insert({
      raised_by_badge: profile.badge_number,
      raised_by_name: profile.name,
      raised_by_centre: profile.centre,
      raised_by_role: profile.role,
      attendance_id: record?.id || null,
      issue_description: flagNote.trim() || FLAG_TYPES.find(f => f.value === flagType)?.label || flagType,
      flag_type: flagType,
      target_centre: flagModal.centre,
      status: 'open',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    if (error) { showError('Failed to raise flag: ' + error.message); setFlagSubmitting(false); return }
    if (record?.id) {
      setFlagDetails(prev => ({
        ...prev,
        [record.id]: {
          flag_type: flagType,
          issue_description: flagNote.trim() || FLAG_TYPES.find(f => f.value === flagType)?.label || flagType,
          raised_by_name: profile.name,
          raised_by_badge: profile.badge_number,
          created_at: new Date().toISOString(),
          status: 'open',
        }
      }))
      setQuickFilterCounts(prev => ({ ...prev, flagged: (prev.flagged || 0) + 1 }))
    }
    setFlagSubmitting(false)
    setFlagSuccess(true)
    clearTimeout(flagSuccessTimerRef.current)
    flagSuccessTimerRef.current = setTimeout(() => {
      setFlagModal(null); setFlagSuccess(false)
      setFlagType('error_entry'); setFlagNote('')
    }, 1500)
  }

  async function deleteRecord(id, badge, type) {
    if (!id) return
    setDeleteConfirm({ id, badge, type })
  }

  async function doDelete() {
    const { id, badge, type } = deleteConfirm
    if (!id) return
    setDeleteConfirm(null)
    const { error } = await supabase.from('attendance').delete().eq('id', id)
    if (error) { showError('Delete failed: ' + error.message); return }
    try {
      await supabase.from('logs').insert({
        user_badge: profile.badge_number, action: 'DELETE_ATTENDANCE',
        details: `Deleted ${type} id=${id} badge=${badge}`, timestamp: new Date().toISOString()
      })
    } catch (e) {
      console.warn('Log insert failed:', e)
    }
    showSuccess(`${type} record deleted`)
    fetchRecords()
  }

  function SortHeader({ col, label }) {
    return (
      <th
        onClick={() => handleSort(col)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
        title={`Sort by ${label}`}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {label}
          {sortCol === col && (
            <span style={{ color: 'var(--excel-green)', fontSize: '0.6rem' }}>
              {sortDir === 'asc' ? '▲' : '▼'}
            </span>
          )}
        </div>
      </th>
    )
  }

  return (
    <div>
      {/* Search + Filters row */}
      <div style={{
        display: 'flex',
        gap: '0.75rem',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: '0.75rem',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 10
      }}>
        {/* Search box */}
        <div className="search-box" style={{
          flex: 1,
          minWidth: 260,
          maxWidth: 400,
          position: 'relative'
        }}>
          <Search size={15} />
          <input
            type="text"
            placeholder="Search badge or name…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                addRecentSearch(searchInput)
                setSearchTerm(searchInput)
                setPage(1)
              }
            }}
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearchTerm(''); setPage(1) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
              <X size={13} />
            </button>
          )}
        </div>

        {/* Centre filter — ASO only */}
        {isAso && (
          <CentreComboBox
            value={centreFilter}
            onChange={val => { setCentreFilter(val); setPage(1) }}
            centres={centres}
            includeAll={true}
          />
        )}

        {/* Date range */}
        <DateRangePicker
          value={dateRange}
          onChange={val => { setDateRange(val); setPage(1) }}
        />
      </div>

      {/* Quick filter chips + Refresh + Column toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <QuickFilterChips
          value={quickFilter}
          onChange={val => { setQuickFilter(val); setPage(1) }}
          counts={quickFilterCounts}
        />
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          {/* Column toggle — mobile only */}
          <div style={{ position: 'relative' }} ref={colMenuRef}>
              <button className="btn btn-ghost rec-col-toggle" onClick={() => setShowColMenu(v => !v)} style={{ padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}>
              <Columns size={13} /> Columns
            </button>
            {showColMenu && (
              <div style={{
                position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '0.5rem', minWidth: 160,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)'
              }}>
                {[
                  { key: 'badge', label: 'Badge' },
                  { key: 'name', label: 'Name' },
                  ...(isAdmin ? [{ key: 'centre', label: 'Centre' }] : []),
                  { key: 'date', label: 'Date' },
                  { key: 'in', label: 'IN Time' },
                  { key: 'out', label: 'OUT Time' },
                  { key: 'status', label: 'Status' },
                ].map(c => (
                  <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.25rem', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-primary)', borderRadius: 6 }}>
                    <input type="checkbox" checked={!!colToggle[c.key]} onChange={() => setColToggle(t => ({ ...t, [c.key]: !t[c.key] }))} style={{ accentColor: 'var(--gold)' }} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-ghost" onClick={fetchRecords} style={{ padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* Recent searches */}
      {recentSearches.length > 0 && searchInput === '' && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', alignSelf: 'center' }}>Recent:</span>
          {recentSearches.map(s => (
            <button key={s} onClick={() => { setSearchInput(s); setSearchTerm(s) }}
              style={{
                fontSize: '0.72rem', padding: '0.2rem 0.5rem', background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 999, cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'inherit'
              }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {deleteMsg && (
        <div style={{
          background: 'rgba(76,175,125,0.1)', border: '1px solid rgba(76,175,125,0.2)',
          borderRadius: 'var(--radius)', padding: '0.6rem 1rem', marginBottom: '0.75rem',
          color: 'var(--green)', fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <span>{deleteMsg}</span>
          <button onClick={() => setDeleteMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {/* Table */}
      <div className="records-page-content">
        <div className="records-table-wrap">
          {loading ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {/* ── FIX: col count matches thead ── */}
                <SkeletonRows rows={15} cols={isAdmin ? 8 : 7} />
              </tbody>
            </table>
          ) : records.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={searchTerm ? `No results for "${searchTerm}"` : 'No records found'}
              message={
                searchTerm
                  ? 'Try a different search term or adjust your date range'
                  : 'No attendance records in the selected date range'
              }
              searchTerm={searchTerm}
              action={() => { setSearchInput(''); setSearchTerm(''); setDateRange({ from: todayDateStr(), to: todayDateStr() }) }}
              actionLabel="Clear filters"
            />
          ) : (
            <table className="records-table records-table-desktop" ref={tableRef} tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  highlightedRowRef.current = Math.min(highlightedRowRef.current + 1, records.length - 1)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  highlightedRowRef.current = Math.max(highlightedRowRef.current - 1, 0)
                }
              }}
            >
              <thead>
                <tr>
                  <th style={{ width: '120px' }}>Badge</th>
                  <th style={{ width: '220px' }}>Name</th>
                  {/* ── FIX: conditional Centre column in thead ── */}
                  {isAdmin && <th style={{ width: '200px' }}>Centre</th>}
                  <th style={{ width: '120px' }}>Date</th>
                  <th style={{ width: '140px' }}>IN</th>
                  <th style={{ width: '140px' }}>OUT</th>
                  <th style={{ width: '160px' }}>Status</th>
                  <th style={{ width: '100px' }}></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => {
                  const rowKey = `${r.badge_number}-${r.date}`
                  const hasMultiSessions = r.sessions && r.sessions.length > 1
                  const isExpanded = expandedRows.has(rowKey)
                  const inFlag = r.raw_in ? flagDetails[r.raw_in.id] : null
                  const outFlag = r.raw_out ? flagDetails[r.raw_out.id] : null
                  const flagInfo = inFlag || outFlag

                  function statusCell(inTime, outTime, fInfo) {
                    if (inTime && outTime && !fInfo) return <span className="status-complete">Complete</span>
                    if (inTime && !outTime && !fInfo) return <span className="status-in-only">IN only</span>
                    if (outTime && !inTime && !fInfo) return <span className="status-out-only">OUT only</span>
                    if (!inTime && !outTime && !fInfo) return <span className="status-none">—</span>
                    const ftLabel = FLAG_TYPES.find(f => f.value === fInfo?.flag_type)?.label || fInfo?.flag_type || 'Flag'
                    const remark = fInfo?.issue_description?.trim() || ftLabel
                    const sl = inTime && outTime ? 'Complete' : inTime ? 'IN only' : outTime ? 'OUT only' : '—'
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span className={sl === 'Complete' ? 'status-complete' : sl === 'IN only' ? 'status-in-only' : sl === 'OUT only' ? 'status-out-only' : 'status-none'}>{sl}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '4px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--red)', background: 'var(--red-bg)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 4, padding: '2px 6px', maxWidth: '100%' }}>
                          <Flag size={11} style={{ flexShrink: 0, marginTop: '1px' }} />
                          <span style={{ lineHeight: 1.4, wordBreak: 'break-word' }}>{remark}</span>
                        </span>
                      </div>
                    )
                  }

                  return (
                    <React.Fragment key={rowKey}>
                      {/* ── Primary row ── */}
                      <tr
                        ref={highlightedRowRef.current === i ? tableRef : null}
                        style={{
                          background: highlightedRowRef.current === i
                            ? 'var(--green-bg)'
                            : flagInfo ? 'rgba(220,38,38,0.04)' : 'transparent',
                          outline: highlightedRowRef.current === i ? '2px solid var(--excel-green)' : 'none',
                          outlineOffset: -2,
                        }}
                      >
                        <td style={{ fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.03em', lineHeight: 1.4 }}>
                          {r.badge_number}
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{r.sewadar_name}</div>
                          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: 2 }}>
                            {r.manual_entry && (
                              <span style={{ fontSize: '0.65rem', background: 'var(--gold-bg)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 999, padding: '1px 6px', fontWeight: 700 }}>MANUAL</span>
                            )}
                            {hasMultiSessions && (
                              <button
                                onClick={() => setExpandedRows(prev => {
                                  const next = new Set(prev)
                                  next.has(rowKey) ? next.delete(rowKey) : next.add(rowKey)
                                  return next
                                })}
                                style={{ fontSize: '0.65rem', background: isExpanded ? 'rgba(33,115,70,0.12)' : 'var(--blue-bg)', color: isExpanded ? 'var(--excel-green)' : 'var(--blue)', border: `1px solid ${isExpanded ? 'rgba(33,115,70,0.3)' : 'rgba(21,101,192,0.3)'}`, borderRadius: 999, padding: '1px 7px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                              >
                                {r.sessions.length} sessions {isExpanded ? '▲' : '▼'}
                              </button>
                            )}
                          </div>
                        </td>
                        {isAdmin && (
                          <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{r.centre}</td>
                        )}
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {formatDateStr(r.date)}
                        </td>
                        <td>
                          <span className={`time-cell ${r.in_time ? 'has-time' : ''}`} style={{ fontSize: '0.82rem' }}>
                            {formatTime(r.in_time)}
                          </span>
                          {r.in_scanner && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{r.in_scanner}</div>}
                        </td>
                        <td>
                          <span className={`time-cell ${r.out_time ? 'has-time out-time' : ''}`}>
                            {formatTime(r.out_time)}
                          </span>
                          {r.out_scanner && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1 }}>{r.out_scanner}</div>}
                        </td>
                        <td>{statusCell(r.in_time, r.out_time, flagInfo)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                            <button className="records-flag-btn" title="Raise flag"
                              onClick={() => { setFlagModal(r); setFlagType('error_entry'); setFlagNote('') }}>
                              <Flag size={13} />
                            </button>
                            {isAso && r.in_id && (
                              <button className="records-delete-btn" title="Delete first IN"
                                onClick={() => setDeleteConfirm({ id: r.in_id, badge: r.badge_number, type: 'IN' })}>
                                <Trash2 size={12} /><span style={{ fontSize: '0.65rem', marginLeft: 1 }}>IN</span>
                              </button>
                            )}
                            {isAso && r.out_id && (
                              <button className="records-delete-btn" title="Delete last OUT"
                                onClick={() => setDeleteConfirm({ id: r.out_id, badge: r.badge_number, type: 'OUT' })}>
                                <Trash2 size={12} /><span style={{ fontSize: '0.65rem', marginLeft: 1 }}>OUT</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* ── Session sub-rows (only when expanded and multi-session) ── */}
                      {isExpanded && hasMultiSessions && r.sessions.map((s, si) => (
                        <tr key={`${rowKey}-s${si}`} style={{ background: 'rgba(33,115,70,0.03)', borderLeft: '3px solid var(--excel-green)' }}>
                          <td colSpan={isAdmin ? 3 : 2} style={{ paddingLeft: '2rem' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                              Session {si + 1}
                            </span>
                            {s.manual_entry && (
                              <span style={{ marginLeft: 6, fontSize: '0.62rem', background: 'var(--gold-bg)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 999, padding: '1px 5px', fontWeight: 700 }}>MANUAL</span>
                            )}
                          </td>
                          <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            {formatDateStr(r.date)}
                          </td>
                          <td>
                            <span className={`time-cell ${s.in_time ? 'has-time' : ''}`} style={{ fontSize: '0.82rem' }}>
                              {formatTime(s.in_time)}
                            </span>
                            {s.in_scanner && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1 }}>{s.in_scanner}</div>}
                          </td>
                          <td>
                            <span className={`time-cell ${s.out_time ? 'has-time out-time' : ''}`}>
                              {formatTime(s.out_time)}
                            </span>
                            {s.out_scanner && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1 }}>{s.out_scanner}</div>}
                          </td>
                          <td>{statusCell(s.in_time, s.out_time, null)}</td>
                          <td>
                            {isAso && (
                              <div style={{ display: 'flex', gap: 2 }}>
                                {s.in_id && (
                                  <button className="records-delete-btn" title="Delete this IN"
                                    onClick={() => setDeleteConfirm({ id: s.in_id, badge: r.badge_number, type: 'IN' })}>
                                    <Trash2 size={12} /><span style={{ fontSize: '0.65rem', marginLeft: 1 }}>IN</span>
                                  </button>
                                )}
                                {s.out_id && (
                                  <button className="records-delete-btn" title="Delete this OUT"
                                    onClick={() => setDeleteConfirm({ id: s.out_id, badge: r.badge_number, type: 'OUT' })}>
                                    <Trash2 size={12} /><span style={{ fontSize: '0.65rem', marginLeft: 1 }}>OUT</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Mobile card view — uses colToggle */}
        {!loading && records.length > 0 && (
          <div className="rec-mobile-cards">
            {records.map((r, i) => {
              const inFlag = r.raw_in ? flagDetails[r.raw_in.id] : null
              const outFlag = r.raw_out ? flagDetails[r.raw_out.id] : null
              const flagInfo = inFlag || outFlag
              return (
                <div key={`${r.badge_number}-${r.date}-${i}`} className="rec-mobile-card" style={{
                  background: flagInfo ? 'rgba(220,38,38,0.04)' : 'var(--bg-elevated)',
                  border: `1px solid ${flagInfo ? 'rgba(220,38,38,0.2)' : 'var(--border)'}`,
                }}>
                  {/* Header: badge + name */}
                  {(colToggle.badge || colToggle.name) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div>
                        {colToggle.badge && <div style={{ fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.82rem', fontWeight: 700 }}>{r.badge_number}</div>}
                        {colToggle.name && <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{r.sewadar_name}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {r.manual_entry && <span style={{ fontSize: '0.62rem', background: 'var(--gold-bg)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 999, padding: '1px 6px', fontWeight: 700 }}>MANUAL</span>}
                        {r.sessions?.length > 1 && (
                          <button
                            onClick={() => setExpandedRows(prev => {
                              const k = `${r.badge_number}-${r.date}`
                              const next = new Set(prev)
                              next.has(k) ? next.delete(k) : next.add(k)
                              return next
                            })}
                            style={{ fontSize: '0.62rem', background: expandedRows.has(`${r.badge_number}-${r.date}`) ? 'rgba(33,115,70,0.12)' : 'var(--blue-bg)', color: expandedRows.has(`${r.badge_number}-${r.date}`) ? 'var(--excel-green)' : 'var(--blue)', border: '1px solid rgba(21,101,192,0.25)', borderRadius: 999, padding: '1px 7px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            {r.sessions.length} sessions {expandedRows.has(`${r.badge_number}-${r.date}`) ? '▲' : '▼'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem 0.75rem', fontSize: '0.78rem' }}>
                    {colToggle.date && (
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Date</div>
                        <div style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{formatDateStr(r.date)}</div>
                      </div>
                    )}
                    {colToggle.centre && isAdmin && (
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Centre</div>
                        <div style={{ color: 'var(--text-secondary)' }}>{r.centre}</div>
                      </div>
                    )}
                    {colToggle.in && (
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>IN</div>
                        <div>
                          <span className={`time-cell ${r.in_time ? 'has-time' : ''}`} style={{ fontSize: '0.75rem' }}>{formatTime(r.in_time)}</span>
                          {r.in_scanner && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1 }}>{r.in_scanner}</div>}
                        </div>
                      </div>
                    )}
                    {colToggle.out && (
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>OUT</div>
                        <div>
                          <span className={`time-cell ${r.out_time ? 'out-time' : ''}`} style={{ fontSize: '0.75rem' }}>{formatTime(r.out_time)}</span>
                          {r.out_scanner && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1 }}>{r.out_scanner}</div>}
                        </div>
                      </div>
                    )}
                  </div>

                  {colToggle.status && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Status</div>
                      {flagInfo ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                          <span className={`status-${r.in_time && r.out_time ? 'complete' : r.in_time ? 'in-only' : r.out_time ? 'out-only' : 'none'}`}>
                            {r.in_time && r.out_time ? 'Complete' : r.in_time ? 'IN only' : r.out_time ? 'OUT only' : '—'}
                          </span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--red)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <Flag size={10} /> {FLAG_TYPES.find(f => f.value === flagInfo?.flag_type)?.label || flagInfo?.flag_type || 'Flag'}
                          </span>
                        </div>
                      ) : (
                        <span className={`status-${r.in_time && r.out_time ? 'complete' : r.in_time ? 'in-only' : r.out_time ? 'out-only' : 'none'}`}>
                          {r.in_time && r.out_time ? 'Complete' : r.in_time ? 'IN only' : r.out_time ? 'OUT only' : '—'}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.6rem', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
                    <button className="records-flag-btn" title="Raise flag" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                      onClick={() => { setFlagModal(r); setFlagType('error_entry'); setFlagNote('') }}>
                      <Flag size={12} /> Flag
                    </button>
                    {isAso && r.in_id && (
                      <button className="records-delete-btn" title="Delete first IN" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        onClick={() => setDeleteConfirm({ id: r.in_id, badge: r.badge_number, type: 'IN' })}>
                        <Trash2 size={11} /> IN
                      </button>
                    )}
                    {isAso && r.out_id && (
                      <button className="records-delete-btn" title="Delete last OUT" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        onClick={() => setDeleteConfirm({ id: r.out_id, badge: r.badge_number, type: 'OUT' })}>
                        <Trash2 size={11} /> OUT
                      </button>
                    )}
                  </div>

                  {/* ── Session breakdown (shown when expanded) ── */}
                  {expandedRows.has(`${r.badge_number}-${r.date}`) && r.sessions?.length > 1 && (
                    <div style={{ marginTop: '0.6rem', borderTop: '2px solid var(--excel-green)', paddingTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--excel-green)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.1rem' }}>
                        All Sessions
                      </div>
                      {r.sessions.map((s, si) => (
                        <div key={si} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.3rem 0.5rem', background: 'rgba(33,115,70,0.04)', border: '1px solid rgba(33,115,70,0.12)', borderRadius: 6, padding: '0.4rem 0.6rem', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>IN</div>
                            <span className={`time-cell ${s.in_time ? 'has-time' : ''}`} style={{ fontSize: '0.75rem' }}>
                              {formatTime(s.in_time)}
                            </span>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>OUT</div>
                            <span className={`time-cell ${s.out_time ? 'has-time out-time' : ''}`} style={{ fontSize: '0.75rem' }}>
                              {formatTime(s.out_time)}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700 }}>#{si + 1}</span>
                            {s.manual_entry && <span style={{ fontSize: '0.55rem', background: 'var(--gold-bg)', color: 'var(--gold)', borderRadius: 999, padding: '0 4px', fontWeight: 700 }}>M</span>}
                            {isAso && (
                              <div style={{ display: 'flex', gap: 2 }}>
                                {s.in_id && <button className="records-delete-btn" style={{ padding: '2px 4px', fontSize: '0.6rem' }} onClick={() => setDeleteConfirm({ id: s.in_id, badge: r.badge_number, type: 'IN' })}><Trash2 size={9} /></button>}
                                {s.out_id && <button className="records-delete-btn" style={{ padding: '2px 4px', fontSize: '0.6rem' }} onClick={() => setDeleteConfirm({ id: s.out_id, badge: r.badge_number, type: 'OUT' })}><Trash2 size={9} /></button>}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {!loading && (
          <TablePagination
            page={page}
            pageSize={PAGE_SIZE}
            total={totalCount}
            onPageChange={p => setPage(p)}
          />
        )}

        {/* Export */}
        {!loading && records.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button className="btn btn-ghost" onClick={() => {
              if (page > 1) { showInfo('Exporting current page only. Clear filters for full export.'); }
              const from = dateRange.from || todayDateStr()
              const to = dateRange.to || todayDateStr()
              const csv = [
                ['Badge Number', 'Name', 'Centre', 'Department', 'Date', 'IN Time', 'OUT Time', 'Status', 'Manual Entry'].join(','),
                ...records.map(r => [
                  r.badge_number, csvEscape(r.sewadar_name), csvEscape(r.centre), csvEscape(r.department || ''),
                  r.date,
                  r.in_time ? formatTime(r.in_time) : '',
                  r.out_time ? formatTime(r.out_time) : '',
                  r.in_time && r.out_time ? 'Complete' : r.in_time ? 'IN only' : r.out_time ? 'OUT only' : '',
                  r.manual_entry ? 'Yes' : 'No'
                ].join(','))
              ].join('\n')
              const a = document.createElement('a')
              a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
              a.download = `attendance_${from}_to_${to}.csv`
              a.click()
            }} style={{ fontSize: '0.82rem' }}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        )}
      </div>

      {/* Flag Modal */}
      {flagModal && (
        <div className="overlay" onClick={() => { setFlagModal(null); setFlagSuccess(false) }}>
          <div className="overlay-sheet flag-modal" onClick={e => e.stopPropagation()}>
            {flagSuccess ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <div style={{ width: 52, height: 52, background: 'var(--green-bg)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <p style={{ fontWeight: 600, color: 'var(--green)' }}>Flag raised successfully</p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Flag size={18} color="var(--red)" /><h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Raise Flag</h3>
                  </div>
                  <button onClick={() => setFlagModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
                </div>
                <div className="flag-modal-record">
                  <div className="flag-modal-record-name">{flagModal.sewadar_name}</div>
                  <div className="flag-modal-record-meta">
                    <span style={{ fontFamily: 'monospace', color: 'var(--gold)' }}>{flagModal.badge_number}</span>
                    <span>·</span>
                    <span>{formatDateStr(flagModal.date)}</span>
                    {flagModal.in_time && <><span>·</span><span className="flag-modal-in">IN {formatTime(flagModal.in_time)}</span></>}
                    {flagModal.out_time && <><span>·</span><span className="flag-modal-out">OUT {formatTime(flagModal.out_time)}</span></>}
                    {flagModal.manual_entry && <><span>·</span><span style={{ color: 'var(--gold)', fontWeight: 700 }}>MANUAL</span></>}
                  </div>
                </div>
                <div style={{ marginBottom: '1rem' }}>
                  <label className="label">Reason</label>
                  <div style={{ position: 'relative' }}>
                    <select className="input" value={flagType} onChange={e => setFlagType(e.target.value)} style={{ appearance: 'none', paddingRight: '2.5rem' }}>
                      {FLAG_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <ChevronDown size={16} style={{ position: 'absolute', right: '0.85rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
                  </div>
                </div>
                <div style={{ marginBottom: '1.25rem' }}>
                  <label className="label">Note <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                  <textarea className="input" rows={3} placeholder="Add details…"
                    value={flagNote} onChange={e => setFlagNote(e.target.value)} style={{ resize: 'none' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <button className="btn btn-outline btn-full" onClick={() => setFlagModal(null)}>Cancel</button>
                  <button className="btn btn-full flag-submit-btn" onClick={submitFlag} disabled={flagSubmitting}>
                    {flagSubmitting ? 'Submitting…' : 'Submit Flag'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteConfirm}
        onConfirm={doDelete}
        onCancel={() => setDeleteConfirm(null)}
        title={`Delete ${deleteConfirm?.type} Record?`}
        message={`Delete ${deleteConfirm?.type} record for ${deleteConfirm?.badge}?\nThis cannot be undone.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  )
}

// ─────────────────────────────────────────────
//  REPORTS TAB
// ─────────────────────────────────────────────
function ReportsTab() {
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE_USER
  const isAdmin = isAso || isCentreUser

  const [activeReport, setActiveReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [reportData, setReportData] = useState(null)
  const [yearFilter, setYearFilter] = useState(CURRENT_YEAR)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [centreFilter, setCentreFilter] = useState('')
  const [centres, setCentres] = useState([])
  const [centresLoaded, setCentresLoaded] = useState(false)

  useEffect(() => { ensureCentres() }, [])

  if (!isAdmin) return (
    <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
      <FileSpreadsheet size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.3, display: 'block' }} />
      <p>Reports are available for Centre User and ASO roles.</p>
    </div>
  )

  async function ensureCentres() {
    if (centresLoaded) return
    let q = supabase.from('centres').select('centre_name').order('centre_name')
    if (isCentreUser) q = supabase.from('centres').select('centre_name').or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`).order('centre_name')
    const { data } = await q
    setCentres(data?.map(c => c.centre_name) || [])
    setCentresLoaded(true)
  }

  function dlCSV(csvStr, filename) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csvStr], { type: 'text/csv' }))
    a.download = filename; a.click()
  }

  async function getCentreNames() {
    if (isAso && !centreFilter) return null
    if (centreFilter) return [centreFilter]
    if (isCentreUser) {
      const { data } = await supabase.from('centres').select('centre_name').or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
      return data?.map(c => c.centre_name) || [profile.centre]
    }
    return [profile.centre]
  }

  // ── Reports use IST boundaries too ──
  function getReportRange() {
    if (dateFrom && dateTo) {
      return {
        start: istDayStart(dateFrom),
        end: istDayEnd(dateTo),
      }
    }
    return {
      start: istDayStart(`${yearFilter}-01-01`),
      end: istDayEnd(`${yearFilter}-12-31`),
    }
  }

  async function runCentreWiseReport() {
    setLoading(true); setActiveReport('centrewise'); setReportData(null)
    const centreNames = await getCentreNames()
    const { start, end } = getReportRange()
    let q = supabase.from('attendance').select('centre, badge_number, type, scan_time').gte('scan_time', start).lte('scan_time', end)
    if (centreNames) q = q.in('centre', centreNames)
    const { data } = await q.limit(50000)
    if (!data) { setLoading(false); return }
    const centreMap = {}
    data.forEach(r => {
      if (!centreMap[r.centre]) centreMap[r.centre] = { centre: r.centre, totalScans: 0, ins: 0, outs: 0, uniqueSewadars: new Set() }
      centreMap[r.centre].totalScans++
      if (r.type === 'IN') centreMap[r.centre].ins++
      else centreMap[r.centre].outs++
      centreMap[r.centre].uniqueSewadars.add(r.badge_number)
    })
    const rows = Object.values(centreMap).map(c => ({ ...c, uniqueCount: c.uniqueSewadars.size })).sort((a, b) => b.totalScans - a.totalScans)
    setReportData({ type: 'centrewise', rows, start, end })
    setLoading(false)
  }

  async function runYearlySatsangReport() {
    setLoading(true); setActiveReport('satsang'); setReportData(null)
    const centreNames = await getCentreNames()
    const { start, end } = getReportRange()
    // jatha uses date fields (no time), keep as plain date strings
    const jathaFrom = dateFrom || `${yearFilter}-01-01`
    const jathaTo   = dateTo   || `${yearFilter}-12-31`
    let attQ = supabase.from('attendance').select('badge_number, sewadar_name, centre, department, scan_time, type').gte('scan_time', start).lte('scan_time', end).eq('type', 'IN')
    let jathaQ = supabase.from('jatha_attendance').select('badge_number, sewadar_name, centre, department, date_from, satsang_days').gte('date_from', jathaFrom).lte('date_from', jathaTo)
    if (centreNames) { attQ = attQ.in('centre', centreNames); jathaQ = jathaQ.in('centre', centreNames) }
    const [attRes, jathaRes] = await Promise.all([attQ.limit(50000), jathaQ.limit(10000)])
    const sewadarMap = {}
    ;(attRes.data || []).forEach(r => {
      // use IST date for satsang day classification
      const d = scanTimeToISTDate(r.scan_time)
      const day = new Date(d + 'T12:00:00+05:30').getDay()
      if (!sewadarMap[r.badge_number]) sewadarMap[r.badge_number] = { badge: r.badge_number, name: r.sewadar_name, centre: r.centre, dept: r.department, dutyDays: new Set(), satsangDaysAtt: new Set(), jathaSatsangDays: 0, jathaCount: 0 }
      sewadarMap[r.badge_number].dutyDays.add(d)
      if (day === 0 || day === 3) sewadarMap[r.badge_number].satsangDaysAtt.add(d)
    })
    ;(jathaRes.data || []).forEach(r => {
      if (!sewadarMap[r.badge_number]) sewadarMap[r.badge_number] = { badge: r.badge_number, name: r.sewadar_name, centre: r.centre, dept: r.department, dutyDays: new Set(), satsangDaysAtt: new Set(), jathaSatsangDays: 0, jathaCount: 0 }
      sewadarMap[r.badge_number].jathaSatsangDays += (r.satsang_days || 0)
      sewadarMap[r.badge_number].jathaCount++
    })
    const rows = Object.values(sewadarMap).map(s => ({ badge: s.badge, name: s.name, centre: s.centre, dept: s.dept, dutyDays: s.dutyDays.size, satsangDaysAtt: s.satsangDaysAtt.size, jathaCount: s.jathaCount, jathaSatsangDays: s.jathaSatsangDays, totalSatsangDays: s.satsangDaysAtt.size + s.jathaSatsangDays })).sort((a, b) => b.totalSatsangDays - a.totalSatsangDays)
    setReportData({ type: 'satsang', rows, year: yearFilter })
    setLoading(false)
  }

  async function runJathaReport() {
    setLoading(true); setActiveReport('jatha'); setReportData(null)
    const centreNames = await getCentreNames()
    const jathaFrom = dateFrom || `${yearFilter}-01-01`
    const jathaTo   = dateTo   || `${yearFilter}-12-31`
    let q = supabase.from('jatha_attendance').select('*').gte('date_from', jathaFrom).lte('date_from', jathaTo).order('date_from', { ascending: false })
    if (centreNames) q = q.in('centre', centreNames)
    const { data } = await q.limit(10000)
    setReportData({ type: 'jatha', rows: data || [], year: yearFilter })
    setLoading(false)
  }

  async function runSewadarCountReport() {
    setLoading(true); setActiveReport('sewadarcount'); setReportData(null)
    const centreNames = await getCentreNames()
    const { start, end } = getReportRange()
    let q = supabase.from('attendance').select('badge_number, sewadar_name, centre, department, type, scan_time').gte('scan_time', start).lte('scan_time', end)
    if (centreNames) q = q.in('centre', centreNames)
    const { data } = await q.limit(50000)
    if (!data) { setLoading(false); return }
    const map = {}
    data.forEach(r => {
      if (!map[r.badge_number]) map[r.badge_number] = { badge: r.badge_number, name: r.sewadar_name, centre: r.centre, dept: r.department, ins: 0, outs: 0, days: new Set() }
      if (r.type === 'IN') map[r.badge_number].ins++
      else map[r.badge_number].outs++
      // use IST date for counting unique days
      map[r.badge_number].days.add(scanTimeToISTDate(r.scan_time))
    })
    const rows = Object.values(map).map(s => ({ ...s, totalDays: s.days.size })).sort((a, b) => b.totalDays - a.totalDays)
    setReportData({ type: 'sewadarcount', rows, start, end })
    setLoading(false)
  }

  function exportCurrentReport() {
    if (!reportData) return
    if (reportData.type === 'centrewise') {
      const h = ['Centre', 'Total Scans', 'IN Count', 'OUT Count', 'Unique Sewadars']
      dlCSV([h, ...reportData.rows.map(r => [csvEscape(r.centre), r.totalScans, r.ins, r.outs, r.uniqueCount]).map(r => r.join(','))].join('\n'), `centre_wise_${yearFilter}.csv`)
    } else if (reportData.type === 'satsang') {
      const h = ['Badge', 'Name', 'Centre', 'Department', 'Duty Days', 'Satsang Days (Daily)', 'Jathas', 'Satsang Days (Jatha)', 'Total Satsang Days']
      dlCSV([h, ...reportData.rows.map(r => [r.badge, csvEscape(r.name), csvEscape(r.centre), csvEscape(r.dept || ''), r.dutyDays, r.satsangDaysAtt, r.jathaCount, r.jathaSatsangDays, r.totalSatsangDays]).map(r => r.join(','))].join('\n'), `yearly_satsang_${reportData.year}.csv`)
    } else if (reportData.type === 'jatha') {
      const h = ['Badge', 'Name', 'Centre', 'Jatha Type', 'Destination', 'Department', 'From', 'To', 'Satsang Days', 'Flagged', 'Remarks']
      dlCSV([h, ...reportData.rows.map(r => [r.badge_number, csvEscape(r.sewadar_name), csvEscape(r.centre), r.jatha_type, csvEscape(r.jatha_centre), csvEscape(r.jatha_dept), r.date_from, r.date_to, r.satsang_days, r.flag ? 'Yes' : 'No', csvEscape(r.remarks || '')]).map(r => r.join(','))].join('\n'), `jatha_${reportData.year}.csv`)
    } else if (reportData.type === 'sewadarcount') {
      const h = ['Badge', 'Name', 'Centre', 'Department', 'IN Scans', 'OUT Scans', 'Days Present']
      dlCSV([h, ...reportData.rows.map(r => [r.badge, csvEscape(r.name), csvEscape(r.centre), csvEscape(r.dept || ''), r.ins, r.outs, r.totalDays]).map(r => r.join(','))].join('\n'), `sewadar_count_${yearFilter}.csv`)
    }
  }

  const reportCards = [
    { id: 'centrewise', label: 'Centre-wise Count', desc: 'Total scans per centre', icon: BarChart2, action: runCentreWiseReport },
    { id: 'satsang', label: 'Yearly Satsang Days', desc: 'Daily + jatha combined', icon: Calendar, action: runYearlySatsangReport },
    { id: 'jatha', label: 'Jatha Summary', desc: 'All jatha records', icon: Plane, action: runJathaReport },
    { id: 'sewadarcount', label: 'Sewadar Count', desc: 'Days present per sewadar', icon: Users, action: runSewadarCountReport },
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.75rem', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.82rem' }}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.75rem' }}>
          <Calendar size={13} color="var(--text-muted)" />
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ border: 'none', background: 'none', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }} />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>→</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ border: 'none', background: 'none', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }} />
        </div>
        {centresLoaded && centres.length > 1 && (
          <select value={centreFilter} onChange={e => setCentreFilter(e.target.value)}
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.75rem', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.82rem' }}>
            <option value="">All Centres</option>
            {centres.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1.25rem' }}>
        {reportCards.map(({ id, label, desc, icon: Icon, action }) => (
          <button key={id} onClick={action}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem',
              padding: '0.85rem', border: `1.5px solid ${activeReport === id ? 'var(--gold)' : 'var(--border)'}`,
              borderRadius: 10, background: activeReport === id ? 'var(--gold-bg)' : 'var(--bg-elevated)',
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s', fontFamily: 'inherit'
            }}>
            <Icon size={18} color={activeReport === id ? 'var(--gold)' : 'var(--text-muted)'} />
            <span style={{ fontWeight: 700, fontSize: '0.82rem', color: activeReport === id ? 'var(--gold)' : 'var(--text-primary)' }}>{label}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{desc}</span>
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem 0' }}>
          <div className="spinner" style={{ marginRight: '0.75rem' }} />
          <span className="text-muted">Generating report…</span>
        </div>
      )}

      {!loading && reportData && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontWeight: 700, marginBottom: '0.2rem', fontSize: '0.95rem' }}>
                {reportData.type === 'centrewise' && 'Centre-wise Attendance'}
                {reportData.type === 'satsang' && `Yearly Satsang Days — ${reportData.year}`}
                {reportData.type === 'jatha' && `Jatha Summary — ${reportData.year}`}
                {reportData.type === 'sewadarcount' && 'Sewadar Attendance Count'}
              </h3>
              <p className="text-muted text-xs">{reportData.rows.length} rows</p>
            </div>
            <button className="btn btn-ghost" onClick={exportCurrentReport} style={{ fontSize: '0.82rem' }}>
              <Download size={14} /> Download CSV
            </button>
          </div>

          <div className="table-wrap" style={{ border: 'none' }}>
            {reportData.type === 'centrewise' && (
              <table>
                <thead><tr><th>Centre</th><th>Total</th><th>IN</th><th>OUT</th><th>Unique</th></tr></thead>
                <tbody>{reportData.rows.map(r => (
                  <tr key={r.centre}>
                    <td style={{ fontWeight: 500 }}>{r.centre}</td>
                    <td>{r.totalScans.toLocaleString()}</td>
                    <td><span className="badge badge-green">{r.ins}</span></td>
                    <td><span className="badge badge-red">{r.outs}</span></td>
                    <td style={{ fontWeight: 600, color: 'var(--blue)' }}>{r.uniqueCount}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {reportData.type === 'satsang' && (
              <table>
                <thead><tr><th>Badge</th><th>Name</th><th>Centre</th><th>Duty Days</th><th>Satsang (Daily)</th><th>Jathas</th><th>Satsang (Jatha)</th><th style={{ background: 'var(--gold-bg)', color: 'var(--gold)' }}>Total</th></tr></thead>
                <tbody>{reportData.rows.map(r => (
                  <tr key={r.badge}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gold)' }}>{r.badge}</td>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{r.centre}</td>
                    <td>{r.dutyDays}</td>
                    <td><span className="badge badge-green">{r.satsangDaysAtt}</span></td>
                    <td>{r.jathaCount}</td>
                    <td><span className="badge" style={{ background: 'var(--gold-bg)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)' }}>{r.jathaSatsangDays}</span></td>
                    <td><strong style={{ color: 'var(--gold)', fontSize: '1rem' }}>{r.totalSatsangDays}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {reportData.type === 'jatha' && (
              <table>
                <thead><tr><th>Badge</th><th>Name</th><th>Centre</th><th>Destination</th><th>From</th><th>To</th><th>Satsang Days</th><th>Flag</th></tr></thead>
                <tbody>{reportData.rows.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gold)' }}>{r.badge_number}</td>
                    <td style={{ fontWeight: 500 }}>{r.sewadar_name}</td>
                    <td style={{ fontSize: '0.82rem' }}>{r.centre}</td>
                    <td style={{ fontSize: '0.82rem' }}>{r.jatha_centre} <span style={{ color: 'var(--text-muted)' }}>· {r.jatha_dept}</span></td>
                    <td style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{r.date_from}</td>
                    <td style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{r.date_to}</td>
                    <td><span className="badge badge-green">{r.satsang_days}</span></td>
                    <td>{r.flag ? <span className="badge badge-red">Yes</span> : '—'}</td>
                  </tr>
                ))}
                  {reportData.rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No jatha records.</td></tr>}
                </tbody>
              </table>
            )}
            {reportData.type === 'sewadarcount' && (
              <table>
                <thead><tr><th>Badge</th><th>Name</th><th>Centre</th><th>Dept</th><th>IN</th><th>OUT</th><th>Days</th></tr></thead>
                <tbody>{reportData.rows.map(r => (
                  <tr key={r.badge}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gold)' }}>{r.badge}</td>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td style={{ fontSize: '0.82rem' }}>{r.centre}</td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{r.dept || '—'}</td>
                    <td><span className="badge badge-green">{r.ins}</span></td>
                    <td><span className="badge badge-red">{r.outs}</span></td>
                    <td style={{ fontWeight: 700, color: 'var(--blue)' }}>{r.totalDays}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {!loading && !reportData && (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
          <FileSpreadsheet size={40} style={{ margin: '0 auto 0.75rem', opacity: 0.3, display: 'block' }} />
          <p style={{ fontSize: '0.9rem' }}>Pick a report type above to generate data</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
//  MAIN PAGE
// ─────────────────────────────────────────────
export default function RecordsPage() {
  const [tab, setTab] = useState('records')

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: '100%', padding: '0 1rem' }}>
      <div className="flex items-center justify-between mt-2 mb-3">
        <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>Records</h2>
      </div>

      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', background: 'var(--bg-elevated)', borderRadius: 10, padding: '0.25rem', border: '1px solid var(--border)' }}>
        {[
          { key: 'records', label: 'Attendance' },
          { key: 'reports', label: 'Excel Reports' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '0.55rem', borderRadius: 8, border: 'none',
              background: tab === t.key ? 'var(--bg)' : 'transparent',
              color: tab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: tab === t.key ? 700 : 400, fontSize: '0.88rem',
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
              transition: 'all 0.12s'
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'records' && <AttendanceTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  )
}