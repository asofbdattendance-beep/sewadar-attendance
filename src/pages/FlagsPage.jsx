import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, FLAG_TYPES, FLAG_STATUS } from '../lib/supabase'
import {
  Flag, MessageSquare, CheckCircle, Clock, AlertCircle,
  ChevronDown, ChevronUp, Send, Filter, RefreshCw
} from 'lucide-react'

export default function FlagsPage() {
  const { profile } = useAuth()
  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('open')
  const [expandedId, setExpandedId] = useState(null)
  const [replyTexts, setReplyTexts] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [childCentres, setChildCentres] = useState([])

  const isAdmin = [ROLES.AREA_SECRETARY, ROLES.CENTRE_USER].includes(profile?.role)
  const isAreaSecretary = profile?.role === ROLES.AREA_SECRETARY

  useEffect(() => {
    loadChildCentres().then(fetchFlags)
  }, [statusFilter, profile])

  async function loadChildCentres() {
    if (!profile?.centre || isAreaSecretary) return
    const { data } = await supabase
      .from('centres')
      .select('centre_name')
      .eq('parent_centre', profile.centre)
    const children = data?.map(c => c.centre_name) || []
    setChildCentres([profile.centre, ...children])
  }

  async function fetchFlags() {
    setLoading(true)
    let query = supabase
      .from('queries')
      .select(`
        *,
        attendance(badge_number, sewadar_name, type, scan_time, centre, department, scanner_name),
        query_replies(id, replied_by_badge, replied_by_name, replied_by_centre, reply_text, created_at)
      `)
      .order('created_at', { ascending: false })

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    const { data, error } = await query
    if (error) { setLoading(false); return }

    let filtered = data || []

    // Scope: sc_sp_user sees only their own flags
    if (profile?.role === ROLES.SC_SP_USER) {
      filtered = filtered.filter(f => f.raised_by_centre === profile.centre)
    }
    // Centre User sees parent + children
    else if (profile?.role === ROLES.CENTRE_USER) {
      const scope = childCentres.length > 0 ? childCentres : [profile.centre]
      filtered = filtered.filter(f =>
        scope.includes(f.raised_by_centre) || scope.includes(f.target_centre)
      )
    }
    // area_secretary sees all

    setFlags(filtered)
    setLoading(false)
  }

  async function submitReply(flagId) {
    const text = (replyTexts[flagId] || '').trim()
    if (!text) return
    setSubmitting(true)

    await supabase.from('query_replies').insert({
      query_id: flagId,
      replied_by_badge: profile.badge_number,
      replied_by_name: profile.name,
      replied_by_centre: profile.centre,
      reply_text: text,
      created_at: new Date().toISOString()
    })

    // If admin/area_secretary replies, move to in_progress if still open
    const flag = flags.find(f => f.id === flagId)
    if (isAdmin && flag?.status === FLAG_STATUS.OPEN) {
      await supabase.from('queries')
        .update({ status: FLAG_STATUS.IN_PROGRESS, updated_at: new Date().toISOString() })
        .eq('id', flagId)
    }

    setReplyTexts(prev => ({ ...prev, [flagId]: '' }))
    setSubmitting(false)
    fetchFlags()
  }

  async function resolveFlag(flagId) {
    await supabase.from('queries').update({
      status: FLAG_STATUS.RESOLVED,
      resolved_at: new Date().toISOString(),
      resolved_by: profile.badge_number,
      updated_at: new Date().toISOString()
    }).eq('id', flagId)
    await supabase.from('logs').insert({
      user_badge: profile.badge_number,
      action: 'RESOLVE_FLAG',
      details: `Resolved flag #${flagId}`,
      timestamp: new Date().toISOString()
    })
    fetchFlags()
  }

  async function reopenFlag(flagId) {
    await supabase.from('queries').update({
      status: FLAG_STATUS.OPEN,
      resolved_at: null,
      resolved_by: null,
      updated_at: new Date().toISOString()
    }).eq('id', flagId)
    fetchFlags()
  }

  function timeFmt(iso) {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  const statusConfig = {
    open: { label: 'Open', cls: 'flag-status-open' },
    in_progress: { label: 'In Progress', cls: 'flag-status-progress' },
    resolved: { label: 'Resolved', cls: 'flag-status-resolved' },
  }

  const flagTypeLabel = (val) => FLAG_TYPES.find(f => f.value === val)?.label || val

  return (
    <div className="page pb-nav" style={{ maxWidth: 600 }}>
      <div className="flags-page-header">
        <div>
          <h2 className="flags-page-title">Flags</h2>
          <p className="flags-page-sub">
            {isAreaSecretary ? 'All centres' : profile?.role === ROLES.CENTRE_USER ? `${profile.centre} + sub-centres` : 'My flags'}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={fetchFlags} style={{ padding: '0.5rem' }}>
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flags-filter-row">
        {['open', 'in_progress', 'resolved', 'all'].map(s => (
          <button
            key={s}
            className={`flags-filter-btn ${statusFilter === s ? 'active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center" style={{ padding: '3rem 0' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : flags.length === 0 ? (
        <div className="flags-empty">
          <Flag size={36} color="var(--text-muted)" />
          <p>No {statusFilter !== 'all' ? statusFilter : ''} flags</p>
        </div>
      ) : (
        <div className="flags-list">
          {flags.map(flag => {
            const isExpanded = expandedId === flag.id
            const replies = flag.query_replies || []
            const canReply =
              isAreaSecretary ||
              (profile?.role === ROLES.CENTRE_USER) ||
              (profile?.role === ROLES.SC_SP_USER && flag.raised_by_badge === profile.badge_number)
            const canResolve = isAdmin && flag.status !== FLAG_STATUS.RESOLVED

            return (
              <div key={flag.id} className={`flag-card ${flag.status}`}>
                {/* Flag header */}
                <div className="flag-card-top" onClick={() => setExpandedId(isExpanded ? null : flag.id)}>
                  <div className="flag-card-left">
                    <span className={`flag-status-badge ${statusConfig[flag.status]?.cls}`}>
                      {statusConfig[flag.status]?.label}
                    </span>
                    <span className="flag-type-label">{flagTypeLabel(flag.flag_type)}</span>
                  </div>
                  <div className="flag-card-right">
                    <span className="flag-time">{timeFmt(flag.created_at)}</span>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* Issue description */}
                <div className="flag-description">{flag.issue_description}</div>

                {/* Raised by */}
                <div className="flag-meta">
                  <span>Raised by</span>
                  <strong>{flag.raised_by_name}</strong>
                  <span className="flag-meta-centre">({flag.raised_by_centre || 'Unknown'})</span>
                </div>

                {/* Attendance record */}
                {flag.attendance && (
                  <div className="flag-attendance-ref">
                    <span className={`flag-type-pill ${flag.attendance.type === 'IN' ? 'pill-in' : 'pill-out'}`}>
                      {flag.attendance.type}
                    </span>
                    <span className="flag-att-name">{flag.attendance.sewadar_name}</span>
                    <span className="flag-att-badge">{flag.attendance.badge_number}</span>
                    <span className="flag-att-time">{timeFmt(flag.attendance.scan_time)}</span>
                  </div>
                )}

                {/* Expanded thread */}
                {isExpanded && (
                  <div className="flag-thread">
                    <div className="flag-thread-divider">
                      <MessageSquare size={12} />
                      <span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
                    </div>

                    {replies.length > 0 && (
                      <div className="flag-replies">
                        {replies
                          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
                          .map(reply => {
                            const isOwn = reply.replied_by_badge === profile.badge_number
                            const isAdminReply = reply.replied_by_badge !== flag.raised_by_badge
                            return (
                              <div key={reply.id} className={`flag-reply ${isOwn ? 'reply-own' : ''} ${isAdminReply ? 'reply-admin' : ''}`}>
                                <div className="reply-header">
                                  <span className="reply-author">
                                    {reply.replied_by_name}
                                    {isAdminReply && <span className="reply-admin-badge">Admin</span>}
                                  </span>
                                  <span className="reply-time">{timeFmt(reply.created_at)}</span>
                                </div>
                                <div className="reply-text">{reply.reply_text}</div>
                              </div>
                            )
                          })}
                      </div>
                    )}

                    {/* Reply input */}
                    {canReply && flag.status !== FLAG_STATUS.RESOLVED && (
                      <div className="flag-reply-input">
                        <textarea
                          className="flag-reply-textarea"
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
                        />
                        <button
                          className="flag-reply-send"
                          onClick={() => submitReply(flag.id)}
                          disabled={submitting || !(replyTexts[flag.id] || '').trim()}
                        >
                          <Send size={15} />
                        </button>
                      </div>
                    )}

                    {/* Resolve / Reopen */}
                    {isAdmin && (
                      <div className="flag-actions">
                        {canResolve && (
                          <button className="flag-resolve-btn" onClick={() => resolveFlag(flag.id)}>
                            <CheckCircle size={14} /> Mark Resolved
                          </button>
                        )}
                        {flag.status === FLAG_STATUS.RESOLVED && isSuperAdmin && (
                          <button className="flag-reopen-btn" onClick={() => reopenFlag(flag.id)}>
                            Reopen
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}