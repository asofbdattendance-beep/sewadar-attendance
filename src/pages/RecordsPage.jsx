import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, FLAG_TYPES } from '../lib/supabase'
import {
  Search, Download, Flag, X, RefreshCw,
  ChevronDown, Trash2, FileSpreadsheet, BarChart2,
  Calendar, Users, Plane, FileText
} from 'lucide-react'
import DateRangePicker from '../components/DateRangePicker'
import CentreComboBox from '../components/CentreComboBox'
import SkeletonRows from '../components/SkeletonRows'
import QuickFilterChips from '../components/QuickFilterChips'
import TablePagination from '../components/TablePagination'
import EmptyState from '../components/EmptyState'
import { showSuccess, showError } from '../components/Toast'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE = 300
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2]

function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function todayDateStr() {
  return new Date().toISOString().split('T')[0]
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

  const searchTimerRef = useRef(null)
  const tableRef = useRef(null)
  const highlightedRowRef = useRef(-1)

  // Load centres + recent searches
  useEffect(() => {
    fetchCentres().catch(console.error)
    const saved = localStorage.getItem('records_recent_searches')
    if (saved) setRecentSearches(JSON.parse(saved))
    const savedSettings = localStorage.getItem('records_settings')
    if (savedSettings) {
      const s = JSON.parse(savedSettings)
      if (s.sortCol) setSortCol(s.sortCol)
      if (s.sortDir) setSortDir(s.sortDir)
      if (s.page) setPage(s.page)
    }
  }, [])

  // Save settings
  useEffect(() => {
    localStorage.setItem('records_settings', JSON.stringify({ sortCol, sortDir, page }))
  }, [sortCol, sortDir, page])

  // Debounced search
  useEffect(() => {
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setSearchTerm(searchInput)
      setPage(1)
    }, SEARCH_DEBOUNCE)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchInput])

  // Fetch records
  useEffect(() => {
    fetchRecords().catch(console.error)
  }, [page, sortCol, sortDir, searchTerm, dateRange, centreFilter, quickFilter, profile, centres])

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

    const fromDate = new Date(dateRange.from + 'T00:00:00')
    const toDate = new Date(dateRange.to + 'T23:59:59.999')

    let q = supabase.from('attendance')
      .select('*', { count: 'exact' })
      .gte('scan_time', fromDate.toISOString())
      .lte('scan_time', toDate.toISOString())
      .order(
        sortCol === 'badge_number'
          ? 'badge_number'
          : 'scan_time',
        { ascending: sortDir === 'asc' }
      )

    // Centre filter
    if (profile?.role === ROLES.SC_SP_USER && profile?.centre) {
      q = q.eq('centre', profile.centre)
    } else if (isCentreUser) {
      const scope = [profile.centre]
      const childData = centres
        .filter(c => c.parent_centre === profile.centre)
        .map(c => c.centre_name)

      scope.push(...childData)
      q = q.in('centre', scope)
    } else if (centreFilter) {
      q = q.eq('centre', centreFilter)
    }

    // Search
    if (searchTerm.trim()) {
      q = q.or(
        `badge_number.ilike.%${searchTerm.trim()}%,sewadar_name.ilike.%${searchTerm.trim()}%`
      )
    }

    // NOTE: keeping your UI-only approach (no backend change)
    const { data, error } = await q.limit(2000)

    setLoading(false)
    if (error) return

    // ───── GROUPING ─────
    const grouped = {}

      ; (data || []).forEach(r => {
        const date = new Date(r.scan_time).toISOString().split('T')[0]
        const key = `${r.badge_number}-${date}`

        if (!grouped[key]) {
          grouped[key] = {
            badge_number: r.badge_number,
            sewadar_name: r.sewadar_name,
            centre: r.centre,
            department: r.department,
            date,
            in_time: null,
            out_time: null,
            in_scanner: null,
            out_scanner: null,
            in_id: null,
            out_id: null,
            raw_in: null,
            raw_out: null,
            manual_entry: false,
          }
        }

        if (r.type === 'IN') {
          grouped[key].in_time = r.scan_time
          grouped[key].in_scanner = r.scanner_name
          grouped[key].in_id = r.id
          grouped[key].raw_in = r
          if (r.manual_entry) grouped[key].manual_entry = true
        }

        if (r.type === 'OUT') {
          grouped[key].out_time = r.scan_time
          grouped[key].out_scanner = r.scanner_name
          grouped[key].out_id = r.id
          grouped[key].raw_out = r
          if (r.manual_entry) grouped[key].manual_entry = true
        }
      })

    let rows = Object.values(grouped)

    // ───── FETCH FLAGS FOR CURRENT PAGE ─────
    const { flaggedCount } = await fetchFlagsForCurrentPage(rows)

    // ───── QUICK FILTER COUNTS ─────
    setQuickFilterCounts({
      all: rows.length,
      in: rows.filter(r => r.in_time && !r.out_time).length,
      out: rows.filter(r => r.out_time && !r.in_time).length,
      manual: rows.filter(r => r.manual_entry).length,
      flagged: flaggedCount,
    })

    // ───── APPLY QUICK FILTERS ─────
    if (quickFilter === 'in') {
      rows = rows.filter(r => r.in_time && !r.out_time)
    } else if (quickFilter === 'out') {
      rows = rows.filter(r => r.out_time && !r.in_time)
    } else if (quickFilter === 'manual') {
      rows = rows.filter(r => r.manual_entry)
    } else if (quickFilter === 'flagged') {
      rows = rows.filter(r =>
        (r.raw_in && flagDetails[r.raw_in.id]) ||
        (r.raw_out && flagDetails[r.raw_out.id])
      )
    }

    // ───── PAGINATION ─────
    setTotalCount(rows.length)

    const start = (page - 1) * PAGE_SIZE
    setRecords(rows.slice(start, start + PAGE_SIZE))
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
      console.error(error)
      return { flagMap: {}, flaggedCount: 0 }
    }

    const newMap = {}
    ;(data || []).forEach(q => {
      newMap[q.attendance_id] = {
        flag_type: q.flag_type,
        issue_description: q.issue_description,
        raised_by_name: q.raised_by_name,
        raised_by_badge: q.raised_by_badge,
        created_at: q.created_at,
        status: q.status,
      }
    })

    const flaggedCount = rows.filter(r =>
      (r.raw_in && newMap[r.raw_in.id]) ||
      (r.raw_out && newMap[r.raw_out.id])
    ).length

    setFlagDetails(prev => ({ ...prev, ...newMap }))
    return { flagMap: newMap, flaggedCount }
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
    setTimeout(() => {
      setFlagModal(null); setFlagSuccess(false)
      setFlagType('error_entry'); setFlagNote('')
    }, 1500)
  }

  async function deleteRecord(id, badge, type) {
    if (!id) return
    if (!confirm(`Delete ${type} record for ${badge}?\n\nThis cannot be undone.`)) return
    const { error } = await supabase.from('attendance').delete().eq('id', id)
    if (error) { showError('Delete failed: ' + error.message); return }
    await supabase.from('logs').insert({
      user_badge: profile.badge_number, action: 'DELETE_ATTENDANCE',
      details: `Deleted ${type} id=${id} badge=${badge}`, timestamp: new Date().toISOString()
    }).catch(() => { })
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
            onFocus={() => {
              if (recentSearches.length > 0 && !searchInput) {
                // Show recent searches dropdown
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

      {/* Quick filter chips + Refresh */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <QuickFilterChips
          value={quickFilter}
          onChange={val => { setQuickFilter(val); setPage(1) }}
          counts={quickFilterCounts}
        />
        <button className="btn btn-ghost" onClick={fetchRecords} style={{ padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}>
          <RefreshCw size={13} /> Refresh
        </button>
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

      {/* Full-width table on desktop — breaks out of page container */}
      <div className="records-page-content">
        {/* Table */}
        <div className="records-table-wrap">
          {loading ? (
            <SkeletonRows rows={15} cols={isAdmin ? 8 : 7} />
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
                  <th style={{ width: '200px' }}>Centre</th>
                  <th style={{ width: '120px' }}>Date</th>
                  <th style={{ width: '140px' }}>IN</th>
                  <th style={{ width: '140px' }}>OUT</th>
                  <th style={{ width: '160px' }}>Status</th>
                  <th style={{ width: '100px' }}></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr
                    key={`${r.badge_number}-${r.date}`}
                    ref={highlightedRowRef.current === i ? tableRef : null}
                    style={{
                      background: highlightedRowRef.current === i
                        ? 'var(--green-bg)'
                        : (r.raw_in && flagDetails[r.raw_in.id]) || (r.raw_out && flagDetails[r.raw_out.id])
                          ? 'rgba(220,38,38,0.04)'
                          : 'transparent',
                      outline: highlightedRowRef.current === i ? '2px solid var(--excel-green)' : 'none',
                      outlineOffset: -2,
                    }}
                  >
                    <td style={{ fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.03em', lineHeight: 1.4 }}>{r.badge_number}</td>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{r.sewadar_name}</div>
                      {r.manual_entry && (
                        <span style={{ fontSize: '0.65rem', background: 'var(--gold-bg)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 999, padding: '1px 6px', fontWeight: 700, marginTop: 2, display: 'inline-block' }}>MANUAL</span>
                      )}
                    </td>
                    {isAdmin && <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{r.centre}</td>}
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {new Date(r.date + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td>
                      <span className={`time-cell ${r.in_time ? 'has-time' : ''}`} style={{ fontSize: '0.82rem' }}>{formatTime(r.in_time)}</span>
                      {r.in_scanner && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{r.in_scanner}</div>}
                    </td>
                    <td>
                      <span className={`time-cell ${r.out_time ? 'has-time out-time' : ''}`}>{formatTime(r.out_time)}</span>
                      {r.out_scanner && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1 }}>{r.out_scanner}</div>}
                    </td>
                    <td>
                      {(() => {
                        const inFlag = r.raw_in ? flagDetails[r.raw_in.id] : null
                        const outFlag = r.raw_out ? flagDetails[r.raw_out.id] : null
                        const flagInfo = inFlag || outFlag
                        if (r.in_time && r.out_time && !flagInfo)
                          return <span className="status-complete">Complete</span>
                        if (r.in_time && !r.out_time && !flagInfo)
                          return <span className="status-in-only">IN only</span>
                        if (r.out_time && !r.in_time && !flagInfo)
                          return <span className="status-out-only">OUT only</span>
                        if (!r.in_time && !r.out_time && !flagInfo)
                          return <span className="status-none">—</span>
                        const flagTypeLabel = FLAG_TYPES.find(f => f.value === flagInfo?.flag_type)?.label || flagInfo?.flag_type || 'Flag'
                        const remark = flagInfo?.issue_description?.trim() || flagTypeLabel
                        const flagStatusLabel = r.in_time && r.out_time ? 'Complete' : r.in_time ? 'IN only' : r.out_time ? 'OUT only' : '—'
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span className={flagStatusLabel === 'Complete' ? 'status-complete' : flagStatusLabel === 'IN only' ? 'status-in-only' : flagStatusLabel === 'OUT only' ? 'status-out-only' : 'status-none'}>
                              {flagStatusLabel}
                            </span>
                            <span
                              title={`${flagTypeLabel}${flagInfo?.issue_description ? '\nRemark: ' + flagInfo.issue_description : ''}\nBy: ${flagInfo?.raised_by_name || flagInfo?.raised_by_badge || '—'}\nOn: ${flagInfo?.created_at ? new Date(flagInfo.created_at).toLocaleDateString('en-IN') : '—'}\nStatus: ${flagInfo?.status || 'open'}`}
                              style={{
                                display: 'inline-flex', alignItems: 'flex-start', gap: '4px',
                                fontSize: '0.72rem', fontWeight: 600,
                                color: 'var(--red)', background: 'var(--red-bg)',
                                border: '1px solid rgba(220,38,38,0.25)',
                                borderRadius: 4, padding: '2px 6px',
                                cursor: 'pointer', maxWidth: '100%',
                              }}
                            >
                              <Flag size={11} style={{ flexShrink: 0, marginTop: '1px' }} />
                              <span style={{ lineHeight: 1.4, wordBreak: 'break-word' }}>{remark}</span>
                            </span>
                          </div>
                        )
                      })()}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <button className="records-flag-btn" title="Raise flag"
                          onClick={() => { setFlagModal(r); setFlagType('error_entry'); setFlagNote('') }}>
                          <Flag size={13} />
                        </button>
                        {isAso && r.in_id && (
                          <button className="records-delete-btn" title="Delete IN"
                            onClick={() => deleteRecord(r.in_id, r.badge_number, 'IN')}>
                            <Trash2 size={12} /><span style={{ fontSize: '0.65rem', marginLeft: 1 }}>IN</span>
                          </button>
                        )}
                        {isAso && r.out_id && (
                          <button className="records-delete-btn" title="Delete OUT"
                            onClick={() => deleteRecord(r.out_id, r.badge_number, 'OUT')}>
                            <Trash2 size={12} /><span style={{ fontSize: '0.65rem', marginLeft: 1 }}>OUT</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

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
              const today = todayDateStr()
              const csv = [
                ['Badge Number', 'Name', 'Centre', 'Department', 'Date', 'IN Time', 'OUT Time', 'Status', 'Manual Entry'].join(','),
                ...records.map(r => [
                  r.badge_number, `"${r.sewadar_name}"`, r.centre, r.department || '',
                  r.date,
                  r.in_time ? formatTime(r.in_time) : '',
                  r.out_time ? formatTime(r.out_time) : '',
                  r.in_time && r.out_time ? 'Complete' : r.in_time ? 'IN only' : r.out_time ? 'OUT only' : '',
                  r.manual_entry ? 'Yes' : 'No'
                ].join(','))
              ].join('\n')
              const a = document.createElement('a')
              a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
              a.download = `attendance_${dateRange.from}_to_${dateRange.to}.csv`
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
                    <span>{new Date(flagModal.date + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
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

  async function runCentreWiseReport() {
    setLoading(true); setActiveReport('centrewise'); setReportData(null)
    const centreNames = await getCentreNames()
    const start = dateFrom ? new Date(dateFrom + 'T00:00:00').toISOString() : new Date(yearFilter + '-01-01T00:00:00').toISOString()
    const end = dateTo ? new Date(dateTo + 'T23:59:59.999').toISOString() : new Date(yearFilter + '-12-31T23:59:59.999').toISOString()
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
    const start = `${yearFilter}-01-01T00:00:00.000Z`
    const end = `${yearFilter}-12-31T23:59:59.999Z`
    let attQ = supabase.from('attendance').select('badge_number, sewadar_name, centre, department, scan_time, type').gte('scan_time', start).lte('scan_time', end).eq('type', 'IN')
    let jathaQ = supabase.from('jatha_attendance').select('badge_number, sewadar_name, centre, department, date_from, satsang_days').gte('date_from', `${yearFilter}-01-01`).lte('date_from', `${yearFilter}-12-31`)
    if (centreNames) { attQ = attQ.in('centre', centreNames); jathaQ = jathaQ.in('centre', centreNames) }
    const [attRes, jathaRes] = await Promise.all([attQ.limit(50000), jathaQ.limit(10000)])
    const sewadarMap = {}
      ; (attRes.data || []).forEach(r => {
        const d = new Date(r.scan_time).toISOString().split('T')[0]
        const day = new Date(d + 'T12:00:00').getDay()
        if (!sewadarMap[r.badge_number]) sewadarMap[r.badge_number] = { badge: r.badge_number, name: r.sewadar_name, centre: r.centre, dept: r.department, dutyDays: new Set(), satsangDaysAtt: new Set(), jathaSatsangDays: 0, jathaCount: 0 }
        sewadarMap[r.badge_number].dutyDays.add(d)
        if (day === 0 || day === 3) sewadarMap[r.badge_number].satsangDaysAtt.add(d)
      })
      ; (jathaRes.data || []).forEach(r => {
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
    let q = supabase.from('jatha_attendance').select('*').gte('date_from', `${yearFilter}-01-01`).lte('date_from', `${yearFilter}-12-31`).order('date_from', { ascending: false })
    if (centreNames) q = q.in('centre', centreNames)
    const { data } = await q.limit(10000)
    setReportData({ type: 'jatha', rows: data || [], year: yearFilter })
    setLoading(false)
  }

  async function runSewadarCountReport() {
    setLoading(true); setActiveReport('sewadarcount'); setReportData(null)
    const centreNames = await getCentreNames()
    const start = dateFrom ? new Date(dateFrom + 'T00:00:00').toISOString() : new Date(yearFilter + '-01-01T00:00:00').toISOString()
    const end = dateTo ? new Date(dateTo + 'T23:59:59.999').toISOString() : new Date(yearFilter + '-12-31T23:59:59.999').toISOString()
    let q = supabase.from('attendance').select('badge_number, sewadar_name, centre, department, type, scan_time').gte('scan_time', start).lte('scan_time', end)
    if (centreNames) q = q.in('centre', centreNames)
    const { data } = await q.limit(50000)
    if (!data) { setLoading(false); return }
    const map = {}
    data.forEach(r => {
      if (!map[r.badge_number]) map[r.badge_number] = { badge: r.badge_number, name: r.sewadar_name, centre: r.centre, dept: r.department, ins: 0, outs: 0, days: new Set() }
      if (r.type === 'IN') map[r.badge_number].ins++
      else map[r.badge_number].outs++
      map[r.badge_number].days.add(new Date(r.scan_time).toISOString().split('T')[0])
    })
    const rows = Object.values(map).map(s => ({ ...s, totalDays: s.days.size })).sort((a, b) => b.totalDays - a.totalDays)
    setReportData({ type: 'sewadarcount', rows, start, end })
    setLoading(false)
  }

  function exportCurrentReport() {
    if (!reportData) return
    if (reportData.type === 'centrewise') {
      const h = ['Centre', 'Total Scans', 'IN Count', 'OUT Count', 'Unique Sewadars']
      dlCSV([h, ...reportData.rows.map(r => [r.centre, r.totalScans, r.ins, r.outs, r.uniqueCount])].map(r => r.join(',')).join('\n'), `centre_wise_${yearFilter}.csv`)
    } else if (reportData.type === 'satsang') {
      const h = ['Badge', 'Name', 'Centre', 'Department', 'Duty Days', 'Satsang Days (Daily)', 'Jathas', 'Satsang Days (Jatha)', 'Total Satsang Days']
      dlCSV([h, ...reportData.rows.map(r => [r.badge, `"${r.name}"`, r.centre, r.dept || '', r.dutyDays, r.satsangDaysAtt, r.jathaCount, r.jathaSatsangDays, r.totalSatsangDays])].map(r => r.join(',')).join('\n'), `yearly_satsang_${reportData.year}.csv`)
    } else if (reportData.type === 'jatha') {
      const h = ['Badge', 'Name', 'Centre', 'Jatha Type', 'Destination', 'Department', 'From', 'To', 'Satsang Days', 'Flagged', 'Remarks']
      dlCSV([h, ...reportData.rows.map(r => [r.badge_number, `"${r.sewadar_name}"`, r.centre, r.jatha_type, r.jatha_centre, r.jatha_dept, r.date_from, r.date_to, r.satsang_days, r.flag ? 'Yes' : 'No', `"${r.remarks || ''}"`])].map(r => r.join(',')).join('\n'), `jatha_${reportData.year}.csv`)
    } else if (reportData.type === 'sewadarcount') {
      const h = ['Badge', 'Name', 'Centre', 'Department', 'IN Scans', 'OUT Scans', 'Days Present']
      dlCSV([h, ...reportData.rows.map(r => [r.badge, `"${r.name}"`, r.centre, r.dept || '', r.ins, r.outs, r.totalDays])].map(r => r.join(',')).join('\n'), `sewadar_count_${yearFilter}.csv`)
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
        <button onClick={ensureCentres} style={{ display: 'none' }} />
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
          <button key={id} onClick={() => { ensureCentres(); action() }}
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
