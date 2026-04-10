import React, { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, FLAG_TYPES, FLAG_STATUS } from '../lib/supabase'
import {
  Flag, MessageSquare, CheckCircle, RefreshCw,
  ChevronDown, ChevronUp, Send, Search, X, ArrowUpDown, ArrowUp, ArrowDown, Plus, Download
} from 'lucide-react'
import TablePagination from '../components/TablePagination'
import SkeletonRows from '../components/SkeletonRows'
import EmptyState from '../components/EmptyState'
import { showSuccess, showError } from '../components/Toast'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE = 300

export default function FlagsPage() {
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('id')
  
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE || profile?.role === ROLES.SC_SP_USER

  const [allFlags, setAllFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [highlightedId, setHighlightedId] = useState(highlightId)
  const highlightRef = useRef(null)
  const [statusFilter, setStatusFilter] = useState('open')
  const [flagTypeFilter, setFlagTypeFilter] = useState(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)
  const [stats, setStats] = useState({ open: 0, in_progress: 0, resolved: 0, total: 0 })
  const [expandedId, setExpandedId] = useState(null)
  const [replyTexts, setReplyTexts] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [childCentres, setChildCentres] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [sewadarMap, setSewadarMap] = useState({})
  const [raiseModal, setRaiseModal] = useState(false)
  const [raiseType, setRaiseType] = useState('other')
  const [raiseNote, setRaiseNote] = useState('')
  const [raising, setRaising] = useState(false)
  const searchTimer = useRef(null)

  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, SEARCH_DEBOUNCE)
    return () => clearTimeout(searchTimer.current)
  }, [searchInput])

  useEffect(() => {
    async function init() {
      await loadChildCentres()
      fetchStats()
    }
    init()
  }, [statusFilter, profile])

  async function loadChildCentres() {
    if (isAso || !profile?.centre) return
    const { data } = await supabase.from('centres').select('centre_name').eq('parent_centre', profile.centre)
    const children = data?.map(c => c.centre_name) || []
    setChildCentres([profile.centre, ...children])
  }

  async function fetchStats() {
    const scope = getScope()
    let q = supabase.from('queries').select('status', { count: 'exact' })
    if (scope.length > 0) q = q.in('raised_by_centre', scope)
    
    // Get all statuses (up to 10000)
    const { data, count } = await q.range(0, 9999)
    
    const s = { open: 0, in_progress: 0, resolved: 0, total: count || 0 }
    if (data) {
      for (const item of data) {
        if (item.status === 'open') s.open++
        else if (item.status === 'in_progress') s.in_progress++
        else if (item.status === 'resolved') s.resolved++
      }
    }
    setStats(s)
  }

  function getScope() {
    if (isAso) return []
    if (isCentreUser) return childCentres.length > 0 ? childCentres : profile?.centre ? [profile.centre] : []
    return []
  }

  async function fetchFlags() {
    setLoading(true)
    const scope = getScope()
    let query = supabase
      .from('queries')
      .select(`
        *,
        attendance(id, badge_number, type, scan_time, scanner_name),
        query_replies(id, replied_by_badge, replied_by_name, replied_by_centre, replied_by_role, message, created_at)
      `, { count: 'exact' })
      .order(sortCol === 'created_at' ? 'created_at' : sortCol, { ascending: sortDir === 'asc' })

    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (scope.length > 0) query = query.in('raised_by_centre', scope)
    if (flagTypeFilter) query = query.eq('flag_type', flagTypeFilter)
    
    // Apply search filters on server for better performance
    if (search.trim()) {
      const q = search.toLowerCase()
      query = query.or(`raised_by_name.ilike.%${q}%,raised_by_badge.ilike.%${q}%,issue_description.ilike.%${q}%,raised_by_centre.ilike.%${q}%`)
    }
    
    query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

    const { data, count, error } = await query
    if (error) { showError('Failed to load flags'); setLoading(false); return }
    setTotalCount(count || 0)
    
    // Fetch sewadar info for all badge numbers
    const badgeNumbers = [...new Set((data || []).map(f => f.badge_number || f.attendance?.badge_number).filter(Boolean))]
    if (badgeNumbers.length > 0) {
      const { data: sewadars } = await supabase
        .from('sewadars')
        .select('badge_number, sewadar_name, centre, department')
        .in('badge_number', badgeNumbers)
      setSewadarMap(Object.fromEntries((sewadars || []).map(s => [s.badge_number, s])))
    } else {
      setSewadarMap({})
    }

    let flags = data || []
    
    // Fetch session data for flags that have session_id
    const sessionIds = flags
      .map(f => f.session_id)
      .filter(id => id && typeof id === 'number')
    
    if (sessionIds.length > 0) {
      try {
        const { data: sessionsData, error: sessionError } = await supabase
          .from('attendance_sessions')
          .select('id, badge_number, in_time, out_time, duty_type, date_ist')
          .in('id', sessionIds)
        
        if (!sessionError && sessionsData) {
          const sessionsMap = Object.fromEntries(sessionsData.map(s => [s.id, s]))
          for (const flag of flags) {
            if (flag.session_id && sessionsMap[flag.session_id]) {
              flag.attendance_sessions = sessionsMap[flag.session_id]
            }
          }
        }
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[Flags] Session fetch error:', e)
      }
    }

    // Client-side sort for attendance-related columns (not directly queryable)
    flags.sort((a, b) => {
      let aVal, bVal
      if (sortCol === 'attendance.badge_number') {
        aVal = (a.attendance?.badge_number || '').toLowerCase()
        bVal = (b.attendance?.badge_number || '').toLowerCase()
      } else if (sortCol === 'attendance.sewadar_name') {
        aVal = (a.attendance?.sewadar_name || '').toLowerCase()
        bVal = (b.attendance?.sewadar_name || '').toLowerCase()
      } else if (sortCol === 'created_at') {
        aVal = a.created_at || ''
        bVal = b.created_at || ''
      } else if (sortCol === 'flag_type') {
        aVal = a.flag_type || ''
        bVal = b.flag_type || ''
      } else if (sortCol === 'status') {
        aVal = a.status || ''
        bVal = b.status || ''
      } else if (sortCol === 'raised_by_centre') {
        aVal = (a.raised_by_centre || '').toLowerCase()
        bVal = (b.raised_by_centre || '').toLowerCase()
      } else if (sortCol === 'raised_by_name') {
        aVal = (a.raised_by_name || '').toLowerCase()
        bVal = (b.raised_by_name || '').toLowerCase()
      } else {
        aVal = (a[sortCol] || '').toString().toLowerCase()
        bVal = (b[sortCol] || '').toString().toLowerCase()
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    setAllFlags(flags)
    setLoading(false)
  }

  useEffect(() => { 
    fetchFlags() 
  }, [page, statusFilter, flagTypeFilter, search, sortCol, sortDir, childCentres, profile])

  // Scroll to highlighted flag when page loads
  useEffect(() => {
    if (highlightedId && highlightRef.current) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        highlightRef.current?.classList.add('flag-highlight')
        setTimeout(() => {
          highlightRef.current?.classList.remove('flag-highlight')
        }, 3000)
      }, 500)
    }
  }, [allFlags, highlightedId])

  // Real-time updates
  useEffect(() => {
    let timer = null
    const channel = supabase.channel('flags-realtime')
    
    channel.on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'queries' 
    }, (payload) => {
      if (import.meta.env.DEV) console.log('[RT] queries changed', payload)
      clearTimeout(timer)
      timer = setTimeout(() => fetchFlags(), 300)
    })
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'query_replies' 
    }, (payload) => {
      if (import.meta.env.DEV) console.log('[RT] query_replies changed', payload)
      clearTimeout(timer)
      timer = setTimeout(() => fetchFlags(), 300)
    })
    .subscribe((status) => {
      if (import.meta.env.DEV) console.log('[RT] Flags channel status:', status)
    })

    return () => { 
      clearTimeout(timer)
      supabase.removeChannel(channel) 
    }
  }, [])

  async function submitReply(flagId) {
    const text = (replyTexts[flagId] || '').trim()
    if (!text) return
    setSubmitting(true)
    const { error } = await supabase.from('query_replies').insert({
      query_id: flagId,
      replied_by_badge: profile.badge_number,
      replied_by_name: profile.name,
      replied_by_centre: profile.centre,
      replied_by_role: profile.role,
      message: text,
      created_at: new Date().toISOString()
    })
    if (error) { showError('Failed to send reply'); setSubmitting(false); return }

    const flag = allFlags.find(f => f.id === flagId)
    if ((isAso || isCentreUser) && flag?.status === FLAG_STATUS.OPEN) {
      await supabase.from('queries').update({ status: FLAG_STATUS.IN_PROGRESS, updated_at: new Date().toISOString() }).eq('id', flagId)
    }
    setReplyTexts(prev => ({ ...prev, [flagId]: '' }))
    setSubmitting(false)
    fetchFlags()
    fetchStats()
  }

  async function updateStatus(flagId, newStatus) {
    await supabase.from('queries').update({ 
      status: newStatus, 
      updated_at: new Date().toISOString() 
    }).eq('id', flagId)
    try {
      await supabase.from('logs').insert({
        user_badge: profile.badge_number, 
        action: 'FLAG_STATUS_UPDATE',
        details: `Flag #${flagId} status changed to ${newStatus}`, 
        timestamp: new Date().toISOString()
      })
    } catch (e) {
      if (import.meta.env.DEV) console.warn('Log insert failed:', e)
    }
    fetchFlags()
    fetchStats()
  }

  async function resolveFlag(flagId) {
    await supabase.from('queries').update({
      status: FLAG_STATUS.RESOLVED,
      resolved_at: new Date().toISOString(),
      resolved_by: profile.badge_number,
      updated_at: new Date().toISOString()
    }).eq('id', flagId)
    try {
      await supabase.from('logs').insert({
        user_badge: profile.badge_number, action: 'RESOLVE_FLAG',
        details: `Resolved flag #${flagId}`, timestamp: new Date().toISOString()
      })
    } catch (e) {
      if (import.meta.env.DEV) console.warn('Log insert failed:', e)
    }
    fetchFlags()
    fetchStats()
    showSuccess('Flag resolved')
  }

  async function reopenFlag(flagId) {
    await supabase.from('queries').update({
      status: FLAG_STATUS.OPEN,
      resolved_at: null,
      resolved_by: null,
      updated_at: new Date().toISOString()
    }).eq('id', flagId)
    fetchFlags()
    fetchStats()
    showSuccess('Flag reopened')
  }

  async function submitRaiseFlag() {
    if (!raiseNote.trim()) return
    setRaising(true)
    const { error } = await supabase.from('queries').insert({
      raised_by_badge: profile.badge_number,
      raised_by_name: profile.name,
      raised_by_centre: profile.centre,
      raised_by_role: profile.role,
      flag_type: raiseType,
      issue_description: raiseNote.trim(),
      status: FLAG_STATUS.OPEN,
    })
    setRaising(false)
    if (error) { showError('Failed to raise flag'); return }
    setRaiseModal(false)
    setRaiseNote('')
    setRaiseType('other')
    fetchFlags()
    fetchStats()
    showSuccess('Flag raised successfully')
  }

  function formatTime(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  }

  function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  function flagTypeLabel(val) {
    return FLAG_TYPES.find(f => f.value === val)?.label || val || 'Other'
  }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
    setPage(1)
  }

  async function exportFlagsCSV() {
    showSuccess('Preparing export...')
    
    try {
      const scope = getScope()
      let q = supabase
        .from('queries')
        .select(`
          *,
          attendance:attendance_id(id, badge_number, type, scan_time, scanner_name)
        `)
        .order(sortCol === 'created_at' ? 'created_at' : sortCol, { ascending: sortDir === 'asc' })

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (scope.length > 0) q = q.in('raised_by_centre', scope)
      if (flagTypeFilter) q = q.eq('flag_type', flagTypeFilter)

      const { data: allFlags } = await q

      if (!allFlags?.length) {
        showError('No flags to export')
        return
      }

      // Get sewadar info for all badge numbers
      const badgeNumbers = [...new Set(allFlags.map(f => f.badge_number || f.attendance?.badge_number).filter(Boolean))]
      const { data: sewadars } = await supabase
        .from('sewadars')
        .select('badge_number, sewadar_name, centre')
        .in('badge_number', badgeNumbers)
      
      const sewadarMap = Object.fromEntries((sewadars || []).map(s => [s.badge_number, s]))

      const header = ['ID', 'Badge', 'Name', 'Centre', 'Raised By', 'Reason', 'Status', 'Flag Type', 'Created', 'Resolved At', 'Resolved By']
      const rows = allFlags.map(f => {
        const badge = f.badge_number || f.attendance?.badge_number
        const sewadar = sewadarMap[badge] || {}
        return [
          f.id,
          badge || '',
          sewadar.sewadar_name || '',
          f.raised_by_centre || '',
          f.raised_by_name || '',
          f.issue_description || f.reason || '',
          f.status || '',
          f.flag_type || '',
          formatDate(f.created_at),
          f.resolved_at ? formatDate(f.resolved_at) : '',
          f.resolved_by || ''
        ]
      })
      
      const csv = [header, ...rows].map(r => r.map(v => {
        const str = String(v || '')
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return '"' + str.replace(/"/g, '""') + '"'
        }
        return str
      }).join(',')).join('\n')
      
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      a.download = `flags_export_${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      showSuccess(`Exported ${allFlags.length} flags`)
    } catch (err) {
      showError('Export failed: ' + err.message)
    }
  }

  function SortTh({ col, label, align = 'left' }) {
    const active = sortCol === col
    return (
      <th style={{ textAlign: align, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }} onClick={() => handleSort(col)}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {label}
          {active ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
        </span>
      </th>
    )
  }

  const statusConfig = {
    open: { label: 'Open', cls: 'flag-status-open' },
    in_progress: { label: 'In Progress', cls: 'flag-status-progress' },
    resolved: { label: 'Resolved', cls: 'flag-status-resolved' },
  }

  const scopeLabel = isAso ? 'All centres' : isCentreUser ? `${profile?.centre} + sub-centres` : 'My flags'

  return (
    <div className="page pb-nav">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Query / Flags</h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
            {scopeLabel} · Track & resolve attendance issues
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={() => { fetchFlags(); fetchStats() }} style={{ padding: '0.4rem 0.6rem' }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-ghost" onClick={exportFlagsCSV} style={{ padding: '0.4rem 0.6rem' }}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* How it works - collapsible help */}
      <div style={{ background: 'var(--blue-bg)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Flag size={14} style={{ color: 'var(--blue)' }} />
          <span style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--blue)' }}>How Query System Works</span>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <strong>1. Raise:</strong> Flag issues like wrong scan, duplicate entry, or mark not present from Records page.<br/>
          <strong>2. Track:</strong> See all flags here with who raised it and when.<br/>
          <strong>3. Resolve:</strong> Add replies to discuss, then mark as In Progress &rarr; Resolved.
        </div>
      </div>

      {/* Stats cards */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        {[
          { key: 'open', label: 'Open', color: 'var(--red)', bg: 'var(--red-bg)' },
          { key: 'in_progress', label: 'In Progress', color: 'var(--amber)', bg: 'var(--amber-bg)' },
          { key: 'resolved', label: 'Resolved', color: 'var(--green)', bg: 'var(--green-bg)' },
          { key: 'total', label: 'Total', color: 'var(--text-secondary)', bg: 'var(--bg)' },
        ].map(s => (
          <div key={s.key} style={{
            flex: '1 1 80px', minWidth: 70, padding: '0.5rem 0.75rem',
            background: s.bg, borderRadius: 8, border: `1px solid ${s.color}30`,
          }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: s.color }}>{stats[s.key]}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Status tabs */}
        <div style={{ display: 'flex', background: 'var(--bg)', borderRadius: 8, padding: 2, border: '1px solid var(--border)' }}>
          {['open', 'in_progress', 'resolved', 'all'].map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
              style={{
                padding: '0.3rem 0.7rem', fontSize: '0.78rem', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: statusFilter === s ? 'var(--excel-green)' : 'transparent',
                color: statusFilter === s ? 'white' : 'var(--text-secondary)',
                fontWeight: statusFilter === s ? 600 : 400,
                transition: 'all 0.15s',
              }}>
              {s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Flag type filter */}
        <select
          value={flagTypeFilter || ''}
          onChange={e => { setFlagTypeFilter(e.target.value || null); setPage(1) }}
          style={{
            padding: '0.35rem 0.6rem', fontSize: '0.78rem', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg)', color: 'var(--text-primary)', cursor: 'pointer',
          }}
        >
          <option value="">All Types</option>
          {FLAG_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
        </select>

        {/* Search */}
        <div style={{ flex: '1 1 180px', position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder="Search badge, name, centre…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{
              width: '100%', padding: '0.35rem 0.6rem 0.35rem 2rem', fontSize: '0.78rem',
              borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)',
              color: 'var(--text-primary)', boxSizing: 'border-box',
            }}
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearch(''); setPage(1) }}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
              <SortTh col="attendance.badge_number" label="Badge" />
              <SortTh col="attendance.sewadar_name" label="Name" />
              <SortTh col="raised_by_centre" label="Centre" />
              <SortTh col="raised_by_name" label="Raised By" />
              <SortTh col="created_at" label="Date" />
              <SortTh col="flag_type" label="Type" />
              <SortTh col="status" label="Status" />
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={8} cols={8} />
            ) : allFlags.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '2rem', textAlign: 'center' }}>
                  <EmptyState
                    icon={Flag}
                    title="No flags found"
                    message={search ? `No results for "${search}"` : `No ${statusFilter !== 'all' ? statusFilter : ''} flags`}
                  />
                </td>
              </tr>
            ) : (
              allFlags.map((flag, idx) => {
                const isHighlighted = flag.id === highlightedId
                const isExpanded = expandedId === flag.id || isHighlighted
                const replies = flag.query_replies || []
                const canReply = isAso || isCentreUser || flag.raised_by_badge === profile?.badge_number
                const canResolve = (isAso || isCentreUser) && flag.status !== FLAG_STATUS.RESOLVED
                const badgeNum = flag.badge_number || flag.attendance?.badge_number
                const sewadar = sewadarMap[badgeNum] || {}

                return (
                  <React.Fragment key={flag.id}>
                    <tr 
                      ref={isHighlighted ? highlightRef : null}
                      onClick={() => { setExpandedId(isExpanded ? null : flag.id); setHighlightedId(null) }}
                      className={isHighlighted ? 'flag-highlight' : ''}
                      style={{
                        cursor: 'pointer',
                        borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                        background: isExpanded ? 'var(--bg)' : idx % 2 === 0 ? 'var(--surface)' : 'transparent',
                        transition: 'background 0.3s ease',
                      }}>
                      <td style={{ fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.78rem', fontWeight: 600 }}>
                        {badgeNum || '—'}
                      </td>
                      <td style={{ fontWeight: 500, padding: '0.45rem 0.5rem' }}>
                        {sewadar.sewadar_name || '—'}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', padding: '0.45rem 0.5rem' }}>
                        {sewadar.centre || flag.raised_by_centre || '—'}
                      </td>
                      <td style={{ padding: '0.45rem 0.5rem' }}>
                        <span style={{ fontWeight: 500 }}>{flag.raised_by_name || '—'}</span>
                        {replies.length > 0 && (
                          <span style={{ marginLeft: 4, fontSize: '0.7rem', color: 'var(--text-muted)', background: 'var(--bg)', borderRadius: 4, padding: '0 4px' }}>
                            <MessageSquare size={9} style={{ display: 'inline', verticalAlign: 'middle' }} /> {replies.length}
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', padding: '0.45rem 0.5rem', whiteSpace: 'nowrap' }}>
                        {formatDate(flag.created_at)}
                      </td>
                      <td style={{ padding: '0.45rem 0.5rem' }}>
                        <span style={{ fontSize: '0.72rem', background: 'var(--amber-bg)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, padding: '1px 6px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {flagTypeLabel(flag.flag_type)}
                        </span>
                      </td>
                      <td style={{ padding: '0.45rem 0.5rem' }}>
                        <span className={`flag-status-badge ${statusConfig[flag.status]?.cls}`} style={{ fontSize: '0.72rem' }}>
                          {statusConfig[flag.status]?.label}
                        </span>
                      </td>
                      <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center' }}>
                        {isExpanded ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                      </td>
                    </tr>

                    {/* Expanded thread */}
                    {isExpanded && (
                      <tr key={`${flag.id}-thread`}>
                        <td colSpan={8} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)', padding: '0.75rem 1rem' }}>
                          <div style={{ maxWidth: 600 }}>
                            {/* Issue Description */}
                            <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.75rem', background: 'var(--red-bg)', borderRadius: 8, border: '1px solid rgba(220,38,38,0.2)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                                <Flag size={12} style={{ color: 'var(--red)' }} />
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase' }}>Issue Reported</span>
                              </div>
                              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{flag.issue_description || '—'}</p>
                              <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                By <strong>{flag.raised_by_name}</strong> ({flag.raised_by_role === 'aso' ? 'ASO' : flag.raised_by_role === 'centre' ? 'Centre' : 'SC/SP'}) from <strong>{flag.raised_by_centre}</strong> on {formatTime(flag.created_at)}
                              </div>
                            </div>

                            {/* Attendance reference (if linked) */}
                            {(flag.attendance || flag.badge_number || flag.attendance_sessions) && (
                              <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.75rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                                  <Flag size={12} style={{ color: 'var(--text-muted)' }} />
                                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Related Attendance Record</span>
                                </div>
                                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                  {flag.attendance && (
                                    <>
                                      <span style={{
                                        fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                                        background: flag.attendance.type === 'IN' ? 'var(--green-bg)' : 'var(--red-bg)',
                                        color: flag.attendance.type === 'IN' ? 'var(--green)' : 'var(--red)',
                                      }}>{flag.attendance.type}</span>
                                      <span style={{ fontFamily: 'monospace', color: 'var(--gold)', fontWeight: 600 }}>{flag.attendance.badge_number}</span>
                                      <span style={{ fontWeight: 500 }}>{sewadar.sewadar_name || '—'}</span>
                                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>· {sewadar.centre || '—'}</span>
                                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>· {flag.attendance.scan_time ? `${formatDate(flag.attendance.scan_time)} ${formatTime(flag.attendance.scan_time)}` : '—'}</span>
                                    </>
                                  )}
                                  {flag.attendance_sessions && !flag.attendance && (
                                    <>
                                      <span style={{
                                        fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                                        background: 'var(--amber-bg)',
                                        color: 'var(--amber)',
                                      }}>{flag.flag_type === 'forgot_out' ? 'FORGOT OUT' : 'SESSION'}</span>
                                      <span style={{ fontFamily: 'monospace', color: 'var(--gold)', fontWeight: 600 }}>{flag.attendance_sessions.badge_number || flag.badge_number}</span>
                                      <span style={{ fontWeight: 500 }}>{sewadar.sewadar_name || flag.attendance_sessions.sewadar_name || '—'}</span>
                                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>· {flag.attendance_sessions.date_ist || '—'}</span>
                                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>· {formatTime(flag.attendance_sessions.in_time)} → {flag.attendance_sessions.out_time ? formatTime(flag.attendance_sessions.out_time) : 'Open'}</span>
                                    </>
                                  )}
                                  {!flag.attendance && !flag.attendance_sessions && flag.badge_number && (
                                    <>
                                      <span style={{ fontFamily: 'monospace', color: 'var(--gold)', fontWeight: 600 }}>{flag.badge_number}</span>
                                      <span style={{ fontWeight: 500 }}>{sewadar.sewadar_name || '—'}</span>
                                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>· {flag.centre || '—'}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Resolution status */}
                            {flag.status === FLAG_STATUS.RESOLVED && (
                              <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.75rem', background: 'var(--green-bg)', borderRadius: 8, border: '1px solid rgba(22,163,74,0.2)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                                  <CheckCircle size={12} style={{ color: 'var(--green)' }} />
                                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase' }}>Resolved</span>
                                  {flag.resolved_by && (
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                      by {flag.resolved_by} on {formatTime(flag.resolved_at)}
                                    </span>
                                  )}
                                </div>
                                {flag.resolution_note && (
                                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{flag.resolution_note}</p>
                                )}
                              </div>
                            )}

                            {/* Action buttons */}
                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                              {flag.status !== FLAG_STATUS.RESOLVED && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); updateStatus(flag.id, flag.status === FLAG_STATUS.OPEN ? FLAG_STATUS.IN_PROGRESS : FLAG_STATUS.RESOLVED) }}
                                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', borderRadius: 6, border: '1px solid', cursor: 'pointer', fontWeight: 600, background: 'transparent' }}
                                  className="btn btn-ghost"
                                >
                                  {flag.status === FLAG_STATUS.OPEN ? 'Mark In Progress' : flag.status === FLAG_STATUS.IN_PROGRESS ? 'Resolve' : ''}
                                </button>
                              )}
                              {flag.status === FLAG_STATUS.RESOLVED && (
                                <button onClick={(e) => { e.stopPropagation(); reopenFlag(flag.id) }} className="btn btn-ghost" style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}>
                                  Reopen
                                </button>
                              )}
                            </div>

                            {/* Reply thread */}
                            <div style={{ marginBottom: '0.6rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                                <MessageSquare size={12} style={{ color: 'var(--text-muted)' }} />
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                  Discussion ({replies.length} {replies.length === 1 ? 'reply' : 'replies'})
                                </span>
                              </div>
                              {replies.length === 0 && (
                                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: '0 0 0.5rem' }}>No replies yet. Add a reply below to discuss.</p>
                              )}
                              {[...replies].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map(reply => {
                                const isOwn = reply.replied_by_badge === profile?.badge_number
                                return (
                                  <div key={reply.id} style={{
                                    padding: '0.5rem 0.75rem', borderRadius: 8, marginBottom: '0.35rem',
                                    background: isOwn ? 'var(--green-bg)' : 'var(--surface)',
                                    border: `1px solid ${isOwn ? 'rgba(22,163,74,0.2)' : 'var(--border)'}`,
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                      <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>
                                        {reply.replied_by_name}
                                        <span style={{ marginLeft: 6, fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400, background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>
                                          {reply.replied_by_role === 'aso' ? 'ASO' : reply.replied_by_role === 'centre' ? 'Centre' : reply.replied_by_role === 'sc_sp_user' ? 'SC/SP' : reply.replied_by_role}
                                        </span>
                                        {isOwn && <span style={{ marginLeft: 4, fontSize: '0.6rem', color: 'var(--green)', fontWeight: 600 }}>You</span>}
                                      </span>
                                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{formatTime(reply.created_at)}</span>
                                    </div>
                                    <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>{reply.message}</p>
                                  </div>
                                )
                              })}
                            </div>

                            {/* Reply input */}
                            {canReply && (
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginTop: '0.75rem' }}>
                                <textarea
                                  className="input"
                                  placeholder="Add a reply or update…"
                                  rows={2}
                                  value={replyTexts[flag.id] || ''}
                                  onChange={e => setReplyTexts(prev => ({ ...prev, [flag.id]: e.target.value }))}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault()
                                      submitReply(flag.id)
                                    }
                                  }}
                                  style={{ fontSize: '0.82rem', resize: 'none', flex: 1 }}
                                />
                                <button className="btn btn-primary" onClick={() => submitReply(flag.id)}
                                  disabled={submitting || !(replyTexts[flag.id] || '').trim()}
                                  style={{ padding: '0.4rem 0.75rem', flexShrink: 0, alignSelf: 'flex-end' }}>
                                  <Send size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })
            )}
          </tbody>
        </table>
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

      {/* Raise Flag Modal */}
      {raiseModal && (
        <div className="overlay" onClick={() => setRaiseModal(false)}>
          <div className="overlay-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Raise Flag</h3>
              <button onClick={() => setRaiseModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={18} />
              </button>
            </div>

            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>Flag Type</label>
            <select
              value={raiseType}
              onChange={e => setRaiseType(e.target.value)}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.88rem', marginBottom: '0.85rem', boxSizing: 'border-box' }}
            >
              {FLAG_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
            </select>

            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>Description</label>
            <textarea
              value={raiseNote}
              onChange={e => setRaiseNote(e.target.value)}
              placeholder="Describe the issue clearly…"
              rows={4}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.88rem', marginBottom: '1rem', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
            />

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setRaiseModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1, opacity: (!raiseNote.trim() || raising) ? 0.5 : 1 }}
                disabled={!raiseNote.trim() || raising}
                onClick={submitRaiseFlag}
              >
                {raising ? 'Submitting…' : 'Submit Flag'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}