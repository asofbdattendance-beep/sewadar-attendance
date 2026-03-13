import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES } from '../lib/supabase'
import { Search, Download, Calendar, Clock, User, Users, Activity } from 'lucide-react'

export default function AdminPage() {
  const { profile } = useAuth()
  const [searchBadge, setSearchBadge] = useState('')
  const [searchName, setSearchName] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selectedSewadar, setSelectedSewadar] = useState(null)
  const [attendanceHistory, setAttendanceHistory] = useState([])
  const [stats, setStats] = useState({ totalDays: 0, satsangs: 0, totalScans: 0 })
  const [dateRange, setDateRange] = useState({ from: '', to: '' })
  const [loading, setLoading] = useState(false)

  const isAdmin = [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(profile?.role)

  async function searchSewadars() {
    if (!searchBadge.trim() && !searchName.trim()) return
    setLoading(true)

    let query = supabase.from('sewadars').select('*')

    if (searchBadge.trim()) {
      query = query.ilike('badge_number', `%${searchBadge.trim().toUpperCase()}%`)
    }
    if (searchName.trim()) {
      query = query.ilike('sewadar_name', `%${searchName.trim()}%`)
    }

    const { data } = await query.limit(20)
    setSearchResults(data || [])
    setLoading(false)
  }

  async function loadHistory(sewadar) {
    setSelectedSewadar(sewadar)
    setLoading(true)

    let query = supabase
      .from('attendance')
      .select('*')
      .eq('badge_number', sewadar.badge_number)
      .order('scan_time', { ascending: false })

    if (dateRange.from) {
      const start = new Date(dateRange.from)
      start.setHours(0, 0, 0, 0)
      query = query.gte('scan_time', start.toISOString())
    }
    if (dateRange.to) {
      const end = new Date(dateRange.to)
      end.setHours(23, 59, 59, 999)
      query = query.lte('scan_time', end.toISOString())
    }

    const { data } = await query
    setAttendanceHistory(data || [])

    // Calculate stats
    const daysSet = new Set()
    let satsangs = 0
    data?.forEach(r => {
      const date = new Date(r.scan_time).toISOString().split('T')[0]
      daysSet.add(date)
      if (r.type === 'IN') satsangs++
    })
    setStats({
      totalDays: daysSet.size,
      satsangs,
      totalScans: data?.length || 0
    })

    setLoading(false)
  }

  function groupByDate(records) {
    const grouped = {}
    records.forEach(r => {
      const date = new Date(r.scan_time).toISOString().split('T')[0]
      if (!grouped[date]) grouped[date] = []
      grouped[date].push(r)
    })
    return Object.entries(grouped).sort((a, b) => new Date(b[0]) - new Date(a[0]))
  }

  function exportHistory() {
    if (!selectedSewadar || attendanceHistory.length === 0) return

    const csv = [
      ['Date', 'Time', 'Type', 'Scanner', 'Session'].join(','),
      ...attendanceHistory.map(r => [
        new Date(r.scan_time).toLocaleDateString('en-IN'),
        new Date(r.scan_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        r.type,
        r.scanner_name,
        r.session_id || ''
      ].join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance_${selectedSewadar.badge_number}_${dateRange.from || 'all'}.csv`
    a.click()
  }

  function timeFmt(iso) {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 900 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>
          Sewadar History
        </h2>
        <p className="text-muted text-xs mt-1">Search and view attendance history</p>
      </div>

      {/* Search Section */}
      <div className="card mb-3">
        <div className="flex gap-2 mb-2">
          <div className="search-box flex-1">
            <Search size={15} />
            <input
              type="text"
              placeholder="Search by badge number..."
              value={searchBadge}
              onChange={e => setSearchBadge(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchSewadars()}
              style={{ textTransform: 'uppercase' }}
            />
          </div>
          <div className="search-box flex-1">
            <User size={15} />
            <input
              type="text"
              placeholder="Search by name..."
              value={searchName}
              onChange={e => setSearchName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchSewadars()}
            />
          </div>
          <button className="btn btn-gold" onClick={searchSewadars}>
            Search
          </button>
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="search-results">
            {searchResults.map(s => (
              <div
                key={s.id}
                className="search-result-item"
                onClick={() => loadHistory(s)}
              >
                <span className="badge" style={{ fontFamily: 'monospace', color: 'var(--gold)' }}>{s.badge_number}</span>
                <span>{s.sewadar_name}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.centre}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sewadar History Section */}
      {selectedSewadar && (
        <div>
          {/* Sewadar Info & Stats */}
          <div className="card mb-3">
            <div className="flex items-center justify-between">
              <div>
                <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{selectedSewadar.sewadar_name}</div>
                <div className="flex gap-3 mt-1" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--gold)' }}>{selectedSewadar.badge_number}</span>
                  <span>•</span>
                  <span>{selectedSewadar.centre}</span>
                  <span>•</span>
                  <span>{selectedSewadar.department || '—'}</span>
                </div>
              </div>
              <button className="btn btn-outline" onClick={exportHistory} disabled={attendanceHistory.length === 0}>
                <Download size={14} /> Export
              </button>
            </div>

            {/* Stats Cards */}
            <div className="stats-grid-3 mt-3" style={{ padding: '0.5rem 0' }}>
              <div className="stat-card mini">
                <div className="stat-number">{stats.totalDays}</div>
                <div className="stat-label">Total Days</div>
              </div>
              <div className="stat-card mini">
                <div className="stat-number" style={{ color: 'var(--green)' }}>{stats.satsangs}</div>
                <div className="stat-label">Satsangs Attended</div>
              </div>
              <div className="stat-card mini">
                <div className="stat-number">{stats.totalScans}</div>
                <div className="stat-label">Total Scans</div>
              </div>
            </div>

            {/* Date Range Filter */}
            <div className="flex items-center gap-2 mt-3">
              <Calendar size={14} />
              <input
                type="date"
                value={dateRange.from}
                onChange={e => setDateRange({ ...dateRange, from: e.target.value })}
                style={{ width: 120 }}
              />
              <span style={{ color: 'var(--text-muted)' }}>to</span>
              <input
                type="date"
                value={dateRange.to}
                onChange={e => setDateRange({ ...dateRange, to: e.target.value })}
                style={{ width: 120 }}
              />
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setDateRange({ from: '', to: '' })
                  loadHistory(selectedSewadar)
                }}
              >
                Clear
              </button>
              <button
                className="btn btn-gold btn-sm"
                onClick={() => loadHistory(selectedSewadar)}
              >
                Apply
              </button>
            </div>
          </div>

          {/* Attendance History Grouped by Date */}
          {loading ? (
            <div className="text-center py-4">
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          ) : attendanceHistory.length > 0 ? (
            <div className="card">
              <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Attendance History
              </h3>
              <div className="history-list">
                {groupByDate(attendanceHistory).map(([date, records]) => (
                  <div key={date} className="history-date-group">
                    <div className="history-date-header">
                      <Calendar size={14} />
                      <span>{new Date(date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                    <div className="history-records">
                      {records.map(r => (
                        <div key={r.id} className="history-record">
                          <Clock size={12} />
                          <span style={{ width: 60, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {new Date(r.scan_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className={`badge ${r.type === 'IN' ? 'badge-green' : 'badge-red'}`} style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}>
                            {r.type}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            by {r.scanner_name}
                          </span>
                          {r.session_id && (
                            <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>
                              {r.session_id}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card text-center py-4">
              <Users size={32} color="var(--text-muted)" style={{ margin: '0 auto 1rem' }} />
              <p className="text-muted">No attendance records found for this sewadar.</p>
            </div>
          )}
        </div>
      )}

      {/* Initial State */}
      {!selectedSewadar && !loading && searchResults.length === 0 && (
        <div className="card text-center py-5">
          <Search size={40} color="var(--text-muted)" style={{ margin: '0 auto 1rem' }} />
          <p className="text-muted">Search for a sewadar by badge number or name to view their attendance history.</p>
        </div>
      )}
    </div>
  )
}
