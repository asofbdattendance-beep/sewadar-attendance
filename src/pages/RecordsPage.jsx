import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES } from '../lib/supabase'
import { Search, Download, Calendar, Filter } from 'lucide-react'

export default function RecordsPage() {
  const { profile } = useAuth()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [centreFilter, setCentreFilter] = useState('')
  const [centres, setCentres] = useState([])

  const isAdmin = [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(profile?.role)

  useEffect(() => {
    fetchRecords()
    if (isAdmin) fetchCentres()
  }, [dateFilter, centreFilter])

  async function fetchCentres() {
    const { data } = await supabase.from('centres').select('centre_name').order('centre_name')
    setCentres(data?.map(c => c.centre_name) || [])
  }

  async function fetchRecords() {
    setLoading(true)
    
    let query = supabase
      .from('attendance')
      .select('*')
      .order('scan_time', { ascending: false })

    if (dateFilter) {
      const start = new Date(dateFilter)
      start.setHours(0, 0, 0, 0)
      const end = new Date(dateFilter)
      end.setHours(23, 59, 59, 999)
      query = query.gte('scan_time', start.toISOString()).lte('scan_time', end.toISOString())
    }

    if (!isAdmin && profile?.centre) {
      query = query.eq('centre', profile.centre)
    } else if (centreFilter) {
      query = query.eq('centre', centreFilter)
    }

    const { data } = await query.limit(500)
    
    // Group by badge_number and date
    const grouped = {}
    data?.forEach(r => {
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
          out_scanner: null
        }
      }
      if (r.type === 'IN' && !grouped[key].in_time) {
        grouped[key].in_time = r.scan_time
        grouped[key].in_scanner = r.scanner_name
      }
      if (r.type === 'OUT' && !grouped[key].out_time) {
        grouped[key].out_time = r.scan_time
        grouped[key].out_scanner = r.scanner_name
      }
    })

    let filteredRecords = Object.values(grouped)
    
    if (searchTerm) {
      const term = searchTerm.toUpperCase()
      filteredRecords = filteredRecords.filter(r => 
        r.badge_number.includes(term) || 
        r.sewadar_name.toUpperCase().includes(term)
      )
    }

    setRecords(filteredRecords)
    setLoading(false)
  }

  function exportToExcel() {
    const csv = [
      ['Badge Number', 'Name', 'Centre', 'Department', 'Date', 'IN Time', 'OUT Time', 'IN By', 'OUT By'].join(','),
      ...records.map(r => [
        r.badge_number,
        `"${r.sewadar_name}"`,
        r.centre,
        r.department || '',
        r.date,
        r.in_time ? new Date(r.in_time).toLocaleTimeString('en-IN') : '',
        r.out_time ? new Date(r.out_time).toLocaleTimeString('en-IN') : '',
        r.in_scanner || '',
        r.out_scanner || ''
      ].join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance_records_${dateFilter || 'all'}.csv`
    a.click()
  }

  function formatTime(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 1100 }}>
      <div className="header">
        <h2>Attendance Records</h2>
        <p className="text-muted text-xs">IN/OUT overview per day</p>
      </div>

      <div className="records-filters">
        <div className="search-box">
          <Search size={16} />
          <input 
            type="text" 
            placeholder="Search badge or name..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="filter-group">
          <Calendar size={16} />
          <input 
            type="date" 
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
          />
        </div>

        {isAdmin && (
          <div className="filter-group">
            <Filter size={16} />
            <select value={centreFilter} onChange={e => setCentreFilter(e.target.value)}>
              <option value="">All Centres</option>
              {centres.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        <button className="btn-export" onClick={exportToExcel}>
          <Download size={16} /> Export
        </button>
      </div>

      {loading ? (
        <div className="spinner" style={{ margin: '2rem auto' }} />
      ) : (
        <div className="records-table-wrap">
          <table className="records-table">
            <thead>
              <tr>
                <th>Badge</th>
                <th>Name</th>
                <th>Centre</th>
                <th>Date</th>
                <th>IN</th>
                <th>OUT</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'monospace', color: 'var(--gold)' }}>{r.badge_number}</td>
                  <td style={{ fontWeight: 500 }}>{r.sewadar_name}</td>
                  <td style={{ fontSize: '0.85rem' }}>{r.centre}</td>
                  <td style={{ fontSize: '0.85rem' }}>{new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                  <td>
                    <span className={`time-cell ${r.in_time ? 'has-time' : ''}`}>
                      {formatTime(r.in_time)}
                    </span>
                  </td>
                  <td>
                    <span className={`time-cell ${r.out_time ? 'has-time' : ''}`}>
                      {formatTime(r.out_time)}
                    </span>
                  </td>
                  <td>
                    {r.in_time && r.out_time ? (
                      <span className="status-complete">Complete</span>
                    ) : r.in_time ? (
                      <span className="status-in-only">IN Only</span>
                    ) : r.out_time ? (
                      <span className="status-out-only">OUT Only</span>
                    ) : (
                      <span className="status-none">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No records found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
