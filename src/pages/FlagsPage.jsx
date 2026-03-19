import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, FLAG_TYPES, FLAG_STATUS } from '../lib/supabase'
import {
  Flag, MessageSquare, CheckCircle, RefreshCw,
  ChevronDown, ChevronUp, Send, Search, X, ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react'
import TablePagination from '../components/TablePagination'
import SkeletonRows from '../components/SkeletonRows'
import EmptyState from '../components/EmptyState'
import { showSuccess, showError } from '../components/Toast'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE = 300

export default function FlagsPage() {
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE_USER
  const isScSpUser = profile?.role === ROLES.SC_SP_USER

  const [allFlags, setAllFlags] = useState([])
  const [loading, setLoading] = useState(true)
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
    loadChildCentres()
    fetchFlags()
    fetchStats()
  }, [statusFilter, profile])

  async function loadChildCentres() {
    if (isAso || !profile?.centre) return
    const { data } = await supabase.from('centres').select('centre_name').eq('parent_centre', profile.centre)
    const children = data?.map(c => c.centre_name) || []
    setChildCentres([profile.centre, ...children])
  }

  async function fetchStats() {
    const scope = getScope()
    let query = supabase.from('queries').select('status', { count: 'exact', head: true })
    if (scope.length > 0) query = query.in('raised_by_centre', scope)
    const { count } = await query
    const s = { open: 0, in_progress: 0, resolved: 0, total: 0 }
    if (scope.length > 0) {
      const [open, ip, res] = await Promise.all([
        supabase.from('queries').select('id', { count: 'exact', head: true }).in('raised_by_centre', scope).eq('status', 'open'),
        supabase.from('queries').select('id', { count: 'exact', head: true }).in('raised_by_centre', scope).eq('status', 'in_progress'),
        supabase.from('queries').select('id', { count: 'exact', head: true }).in('raised_by_centre', scope).eq('status', 'resolved'),
      ])
      s.open = open.count || 0
      s.in_progress = ip.count || 0
      s.resolved = res.count || 0
      s.total = (open.count || 0) + (ip.count || 0) + (res.count || 0)
    } else {
      const [open, ip, res] = await Promise.all([
        supabase.from('queries').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('queries').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
        supabase.from('queries').select('id', { count: 'exact', head: true }).eq('status', 'resolved'),
      ])
      s.open = open.count || 0
      s.in_progress = ip.count || 0
      s.resolved = res.count || 0
      s.total = (open.count || 0) + (ip.count || 0) + (res.count || 0)
    }
    setStats(s)
  }

  function getScope() {
    if (isAso) return []
    if (isCentreUser) return childCentres.length > 0 ? childCentres : [profile?.centre]
    if (isScSpUser) return [profile?.centre]
    return []
  }

  async function fetchFlags() {
    setLoading(true)
    const scope = getScope()
    let query = supabase
      .from('queries')
      .select(`
        *,
        attendance(badge_number, sewadar_name, type, scan_time, centre, department, scanner_name),
        query_replies(id, replied_by_badge, replied_by_name, replied_by_centre, replied_by_role, reply_text, created_at)
      `, { count: 'exact' })
      .order(sortCol === 'created_at' ? 'created_at' : sortCol, { ascending: sortDir === 'asc' })

    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (scope.length > 0) query = query.in('raised_by_centre', scope)
    query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

    const { data, error } = await query
    if (error) { showError('Failed to load flags'); setLoading(false); return }

    let flags = data || []
    if (flagTypeFilter) flags = flags.filter(f => f.flag_type === flagTypeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      flags = flags.filter(f =>
        (f.raised_by_name || '').toLowerCase().includes(q) ||
        (f.raised_by_badge || '').toLowerCase().includes(q) ||
        (f.issue_description || '').toLowerCase().includes(q) ||
        (f.attendance?.badge_number || '').toLowerCase().includes(q) ||
        (f.attendance?.sewadar_name || '').toLowerCase().includes(q) ||
        (f.raised_by_centre || '').toLowerCase().includes(q)
      )
    }

    setAllFlags(flags)
    setLoading(false)
  }

  // FIX: Single useEffect with all dependencies to prevent double API calls
  useEffect(() => { 
    fetchFlags() 
  }, [page, statusFilter, flagTypeFilter, search, sortCol, sortDir, childCentres])

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
      reply_text: text,
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

  async function resolveFlag(flagId) {
    await supabase.from('queries').update({
      status: FLAG_STATUS.RESOLVED,
      resolved_at: new Date().toISOString(),
      resolved_by: profile.badge_number,
      updated_at: new Date().toISOString()
    }).eq('id', flagId)
    supabase.from('logs').insert({
      user_badge: profile.badge_number, action: 'RESOLVE_FLAG',
      details: `Resolved flag #${flagId}`, timestamp: new Date().toISOString()
    }).then(() => {}).catch(e => console.warn('Log failed:', e))
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

  function timeFmt(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  function dateFmt(iso) {
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
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Flags</h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>{scopeLabel}</p>
        </div>
        <button className="btn btn-ghost" onClick={() => { fetchFlags(); fetchStats() }} style={{ padding: '0.4rem 0.6rem' }}>
          <RefreshCw size={14} /> Refresh
        </button>
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
              <SortTh col="id" label="#" align="right" />
              <SortTh col="flag_type" label="Type" />
              <SortTh col="status" label="Status" />
              <SortTh col="attendance.badge_number" label="Badge" />
              <SortTh col="attendance.sewadar_name" label="Name" />
              <SortTh col="raised_by_centre" label="Centre" />
              <SortTh col="raised_by_name" label="Raised By" />
              <SortTh col="created_at" label="Date" />
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={8} cols={9} />
            ) : allFlags.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '2rem', textAlign: 'center' }}>
                  <EmptyState
                    icon={Flag}
                    title="No flags found"
                    message={search ? `No results for "${search}"` : `No ${statusFilter !== 'all' ? statusFilter : ''} flags`}
                  />
                </td>
              </tr>
            ) : (
              allFlags.map((flag, idx) => {
                const isExpanded = expandedId === flag.id
                const replies = flag.query_replies || []
                const canReply = isAso || isCentreUser || (isScSpUser && flag.raised_by_badge === profile?.badge_number)
                const canResolve = (isAso || isCentreUser) && flag.status !== FLAG_STATUS.RESOLVED

                return (
                  <React.Fragment key={flag.id}>
                    <tr onClick={() => setExpandedId(isExpanded ? null : flag.id)}
                      style={{
                        cursor: 'pointer',
                        borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                        background: isExpanded ? 'var(--bg)' : idx % 2 === 0 ? 'var(--surface)' : 'transparent',
                      }}>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)', paddingRight: 8, fontSize: '0.75rem' }}>#{flag.id}</td>
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
                      <td style={{ fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.78rem', fontWeight: 600 }}>
                        {flag.attendance?.badge_number || '—'}
                      </td>
                      <td style={{ fontWeight: 500, padding: '0.45rem 0.5rem' }}>
                        {flag.attendance?.sewadar_name || '—'}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', padding: '0.45rem 0.5rem' }}>
                        {flag.raised_by_centre || '—'}
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
                        {dateFmt(flag.created_at)}
                      </td>
                      <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center' }}>
                        {isExpanded ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                      </td>
                    </tr>

                    {/* Expanded thread */}
                    {isExpanded && (
                      <tr key={`${flag.id}-thread`}>
                        <td colSpan={9} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)', padding: '0.75rem 1rem' }}>
                          <div style={{ maxWidth: 600 }}>
                            {/* Issue */}
                            <div style={{ marginBottom: '0.6rem' }}>
                              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Issue</span>
                              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{flag.issue_description || '—'}</p>
                            </div>

                            {/* Attendance ref */}
                            {flag.attendance && (
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Record</span>
                                <span style={{
                                  fontSize: '0.7rem', fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                                  background: flag.attendance.type === 'IN' ? 'var(--green-bg)' : 'var(--red-bg)',
                                  color: flag.attendance.type === 'IN' ? 'var(--green)' : 'var(--red)',
                                }}>{flag.attendance.type}</span>
                                <span style={{ fontWeight: 600, fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.8rem' }}>{flag.attendance.badge_number}</span>
                                <span style={{ fontWeight: 500 }}>{flag.attendance.sewadar_name}</span>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{flag.attendance.centre}</span>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{timeFmt(flag.attendance.scan_time)}</span>
                              </div>
                            )}

                            {/* Replies */}
                            <div style={{ marginBottom: '0.6rem' }}>
                              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                                {replies.length} {replies.length === 1 ? 'Reply' : 'Replies'}
                              </div>
                              {replies.length === 0 && (
                                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>No replies yet.</p>
                              )}
                              {replies.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map(reply => {
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
                                        {reply.replied_by_role && (
                                          <span style={{ marginLeft: 6, fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400, background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>
                                            {reply.replied_by_role === 'aso' ? 'ASO' : reply.replied_by_role === 'centre_user' ? 'Centre User' : reply.replied_by_role === 'sc_sp_user' ? 'SC/SP User' : reply.replied_by_role}
                                          </span>
                                        )}
                                      </span>
                                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{timeFmt(reply.created_at)}</span>
                                    </div>
                                    <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>{reply.reply_text}</p>
                                  </div>
                                )
                              })}
                            </div>

                            {/* Reply input */}
                            {canReply && flag.status !== FLAG_STATUS.RESOLVED && (
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                                <textarea
                                  className="input"
                                  placeholder="Write a reply…"
                                  rows={2}
                                  value={replyTexts[flag.id] || ''}
                                  onChange={e => setReplyTexts(prev => ({ ...prev, [flag.id]: e.target.value }))}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault()
                                      submitReply(flag.id)
                                    }
                                  }}
                                  style={{ fontSize: '0.82rem', resize: 'none' }}
                                />
                                <button className="btn btn-primary" onClick={() => submitReply(flag.id)}
                                  disabled={submitting || !(replyTexts[flag.id] || '').trim()}
                                  style={{ padding: '0.4rem 0.75rem', flexShrink: 0 }}>
                                  <Send size={14} />
                                </button>
                              </div>
                            )}

                            {/* Actions */}
                            {(isAso || isCentreUser) && (
                              <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.5rem' }}>
                                {canResolve && (
                                  <button className="btn btn-ghost" onClick={() => resolveFlag(flag.id)}
                                    style={{ fontSize: '0.8rem', color: 'var(--green)', padding: '0.35rem 0.75rem' }}>
                                    <CheckCircle size={13} /> Mark Resolved
                                  </button>
                                )}
                                {flag.status === FLAG_STATUS.RESOLVED && isAso && (
                                  <button className="btn btn-ghost" onClick={() => reopenFlag(flag.id)}
                                    style={{ fontSize: '0.8rem', color: 'var(--amber)', padding: '0.35rem 0.75rem' }}>
                                    Reopen Flag
                                  </button>
                                )}
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
          total={allFlags.length}
          onPageChange={p => setPage(p)}
        />
      )}
    </div>
  )
}
