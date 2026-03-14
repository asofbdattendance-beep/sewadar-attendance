// ReportsPage.jsx — Advanced Excel Reports
// Centre-wise attendance count, yearly satsang summary per sewadar, jatha summary, combined exports

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, JATHA_TYPE_LABEL, countSatsangDays } from '../lib/supabase'
import { Download, RefreshCw, FileSpreadsheet, Calendar, Users, Plane, BarChart2, Filter } from 'lucide-react'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2]

export default function ReportsPage() {
  const { profile } = useAuth()
  const [activeReport, setActiveReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [reportData, setReportData] = useState(null)
  const [yearFilter, setYearFilter] = useState(CURRENT_YEAR)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [centreFilter, setCentreFilter] = useState('')
  const [centres, setCentres] = useState([])
  const [centresLoaded, setCentresLoaded] = useState(false)

  const isAreaSecretary = profile?.role === ROLES.AREA_SECRETARY
  const isCentreUser   = profile?.role === ROLES.CENTRE_USER
  const isAdminOrAbove = isAreaSecretary || isCentreUser

  if (!isAdminOrAbove) return (
    <div className="page text-center mt-3"><p className="text-muted">Access denied.</p></div>
  )

  async function ensureCentres() {
    if (centresLoaded) return
    let q = supabase.from('centres').select('centre_name').order('centre_name')
    if (isCentreUser) q = q.or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
    const { data } = await q
    setCentres(data?.map(c => c.centre_name) || [])
    setCentresLoaded(true)
  }

  // ── Utility ──
  function dlCSV(csvStr, filename) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csvStr], { type: 'text/csv' }))
    a.download = filename; a.click()
  }

  function buildCentreScope() {
    // returns array of centre names to scope query, or null for super_admin all
    return null  // handled per query
  }

  async function getCentreNames() {
    if (isAreaSecretary && !centreFilter) return null  // no filter = all
    if (centreFilter) return [centreFilter]
    if (isCentreUser) {
      const { data } = await supabase.from('centres').select('centre_name')
        .or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
      return data?.map(c => c.centre_name) || [profile.centre]
    }
    return [profile.centre]
  }

  // ── REPORT 1: Centre-wise Attendance Count ──
  async function runCentreWiseReport() {
    setLoading(true); setActiveReport('centrewise'); setReportData(null)
    const centreNames = await getCentreNames()

    const start = dateFrom ? new Date(dateFrom + 'T00:00:00').toISOString() : new Date(yearFilter + '-01-01T00:00:00').toISOString()
    const end   = dateTo   ? new Date(dateTo   + 'T23:59:59.999').toISOString() : new Date(yearFilter + '-12-31T23:59:59.999').toISOString()

    let q = supabase.from('attendance').select('centre, badge_number, type, scan_time')
      .gte('scan_time', start).lte('scan_time', end)
    if (centreNames) q = q.in('centre', centreNames)

    const { data } = await q.limit(50000)
    if (!data) { setLoading(false); return }

    // Group by centre
    const centreMap = {}
    const badgesPerCentre = {}
    data.forEach(r => {
      if (!centreMap[r.centre]) {
        centreMap[r.centre] = { centre: r.centre, totalScans: 0, ins: 0, outs: 0, uniqueSewadars: new Set() }
        badgesPerCentre[r.centre] = new Set()
      }
      centreMap[r.centre].totalScans++
      if (r.type === 'IN') centreMap[r.centre].ins++
      else centreMap[r.centre].outs++
      centreMap[r.centre].uniqueSewadars.add(r.badge_number)
    })

    const rows = Object.values(centreMap)
      .map(c => ({ ...c, uniqueCount: c.uniqueSewadars.size }))
      .sort((a, b) => b.totalScans - a.totalScans)

    setReportData({ type: 'centrewise', rows, start, end })
    setLoading(false)
  }

  function exportCentreWise() {
    if (!reportData?.rows) return
    const header = ['Centre', 'Total Scans', 'IN Count', 'OUT Count', 'Unique Sewadars']
    const rows = reportData.rows.map(r => [r.centre, r.totalScans, r.ins, r.outs, r.uniqueCount])
    dlCSV([header, ...rows].map(r => r.join(',')).join('\n'), `centre_wise_attendance_${yearFilter}.csv`)
  }

  // ── REPORT 2: Yearly Satsang Days per Sewadar ──
  async function runYearlySatsangReport() {
    setLoading(true); setActiveReport('satsang'); setReportData(null)
    const centreNames = await getCentreNames()

    const start = `${yearFilter}-01-01T00:00:00.000Z`
    const end   = `${yearFilter}-12-31T23:59:59.999Z`

    // Get all attendance for the year
    let attQ = supabase.from('attendance').select('badge_number, sewadar_name, centre, department, scan_time, type')
      .gte('scan_time', start).lte('scan_time', end).eq('type', 'IN')
    if (centreNames) attQ = attQ.in('centre', centreNames)

    // Get all jatha for the year
    let jathaQ = supabase.from('jatha_attendance').select('badge_number, sewadar_name, centre, department, date_from, satsang_days')
      .gte('date_from', `${yearFilter}-01-01`).lte('date_from', `${yearFilter}-12-31`)
    if (centreNames) jathaQ = jathaQ.in('centre', centreNames)

    const [attRes, jathaRes] = await Promise.all([attQ.limit(50000), jathaQ.limit(10000)])

    // Group attendance by badge — count distinct satsang days (Sun/Wed)
    const sewadarMap = {}

    ;(attRes.data || []).forEach(r => {
      const d = new Date(r.scan_time).toISOString().split('T')[0]
      const day = new Date(d + 'T12:00:00').getDay()
      if (!sewadarMap[r.badge_number]) {
        sewadarMap[r.badge_number] = { badge: r.badge_number, name: r.sewadar_name, centre: r.centre, dept: r.department, dutyDays: new Set(), satsangDaysAtt: new Set(), jathaSatsangDays: 0, jathaCount: 0 }
      }
      sewadarMap[r.badge_number].dutyDays.add(d)
      if (day === 0 || day === 3) sewadarMap[r.badge_number].satsangDaysAtt.add(d)
    })

    ;(jathaRes.data || []).forEach(r => {
      if (!sewadarMap[r.badge_number]) {
        sewadarMap[r.badge_number] = { badge: r.badge_number, name: r.sewadar_name, centre: r.centre, dept: r.department, dutyDays: new Set(), satsangDaysAtt: new Set(), jathaSatsangDays: 0, jathaCount: 0 }
      }
      sewadarMap[r.badge_number].jathaSatsangDays += (r.satsang_days || 0)
      sewadarMap[r.badge_number].jathaCount++
    })

    const rows = Object.values(sewadarMap).map(s => ({
      badge: s.badge, name: s.name, centre: s.centre, dept: s.dept,
      dutyDays: s.dutyDays.size,
      satsangDaysAtt: s.satsangDaysAtt.size,
      jathaCount: s.jathaCount,
      jathaSatsangDays: s.jathaSatsangDays,
      totalSatsangDays: s.satsangDaysAtt.size + s.jathaSatsangDays
    })).sort((a, b) => b.totalSatsangDays - a.totalSatsangDays)

    setReportData({ type: 'satsang', rows, year: yearFilter })
    setLoading(false)
  }

  function exportYearlySatsang() {
    if (!reportData?.rows) return
    const header = ['Badge', 'Name', 'Centre', 'Department', 'Duty Days', 'Satsang Days (Daily)', 'Jatha Count', 'Satsang Days (Jatha)', 'Total Satsang Days']
    const rows = reportData.rows.map(r => [r.badge, `"${r.name}"`, r.centre, r.dept||'', r.dutyDays, r.satsangDaysAtt, r.jathaCount, r.jathaSatsangDays, r.totalSatsangDays])
    dlCSV([header, ...rows].map(r => r.join(',')).join('\n'), `yearly_satsang_days_${yearFilter}.csv`)
  }

  // ── REPORT 3: Jatha Summary ──
  async function runJathaReport() {
    setLoading(true); setActiveReport('jatha'); setReportData(null)
    const centreNames = await getCentreNames()

    const start = dateFrom || `${yearFilter}-01-01`
    const end   = dateTo   || `${yearFilter}-12-31`

    let q = supabase.from('jatha_attendance').select('*')
      .gte('date_from', start).lte('date_from', end)
      .order('date_from', { ascending: false })
    if (centreNames) q = q.in('centre', centreNames)

    const { data } = await q.limit(10000)
    setReportData({ type: 'jatha', rows: data || [], year: yearFilter })
    setLoading(false)
  }

  function exportJatha() {
    if (!reportData?.rows) return
    const header = ['Badge', 'Name', 'Home Centre', 'Dept', 'Jatha Type', 'Destination', 'Jatha Dept', 'From', 'To', 'Total Days', 'Satsang Days', 'Flagged', 'Submitted By']
    const rows = reportData.rows.map(r => {
      const from = new Date(r.date_from + 'T12:00:00')
      const to   = new Date(r.date_to   + 'T12:00:00')
      const totalDays = Math.round((to - from) / 86400000) + 1
      return [r.badge_number, `"${r.sewadar_name}"`, r.centre, r.department||'',
        JATHA_TYPE_LABEL[r.jatha_type]||r.jatha_type, r.jatha_centre, r.jatha_dept,
        r.date_from, r.date_to, totalDays, r.satsang_days, r.flag?'Yes':'No', r.submitted_name||r.submitted_by]
    })
    dlCSV([header, ...rows].map(r => r.join(',')).join('\n'), `jatha_report_${yearFilter}.csv`)
  }

  // ── REPORT 4: Sewadar-wise attendance count ──
  async function runSewadarCountReport() {
    setLoading(true); setActiveReport('sewadarcount'); setReportData(null)
    const centreNames = await getCentreNames()

    const start = dateFrom ? new Date(dateFrom + 'T00:00:00').toISOString() : new Date(yearFilter + '-01-01T00:00:00').toISOString()
    const end   = dateTo   ? new Date(dateTo   + 'T23:59:59.999').toISOString() : new Date(yearFilter + '-12-31T23:59:59.999').toISOString()

    let q = supabase.from('attendance').select('badge_number, sewadar_name, centre, department, scan_time, type')
      .gte('scan_time', start).lte('scan_time', end)
    if (centreNames) q = q.in('centre', centreNames)

    const { data } = await q.limit(50000)
    if (!data) { setLoading(false); return }

    const sewadarMap = {}
    data.forEach(r => {
      if (!sewadarMap[r.badge_number]) {
        sewadarMap[r.badge_number] = { badge: r.badge_number, name: r.sewadar_name, centre: r.centre, dept: r.department, ins: 0, outs: 0, days: new Set() }
      }
      const d = new Date(r.scan_time).toISOString().split('T')[0]
      sewadarMap[r.badge_number].days.add(d)
      if (r.type === 'IN') sewadarMap[r.badge_number].ins++
      else sewadarMap[r.badge_number].outs++
    })

    const rows = Object.values(sewadarMap)
      .map(s => ({ ...s, totalDays: s.days.size }))
      .sort((a, b) => b.ins - a.ins)

    setReportData({ type: 'sewadarcount', rows })
    setLoading(false)
  }

  function exportSewadarCount() {
    if (!reportData?.rows) return
    const header = ['Badge', 'Name', 'Centre', 'Department', 'IN Scans', 'OUT Scans', 'Total Days Present']
    const rows = reportData.rows.map(r => [r.badge, `"${r.name}"`, r.centre, r.dept||'', r.ins, r.outs, r.totalDays])
    dlCSV([header, ...rows].map(r => r.join(',')).join('\n'), `sewadar_attendance_count_${yearFilter}.csv`)
  }

  const reportCards = [
    {
      id: 'centrewise', icon: BarChart2, color: 'var(--blue)',
      title: 'Centre-wise Attendance',
      desc: 'Total scans, IN/OUT counts and unique sewadars per centre',
      run: runCentreWiseReport
    },
    {
      id: 'satsang', icon: Calendar, color: 'var(--green)',
      title: 'Yearly Satsang Days',
      desc: 'Per-sewadar: daily satsang days + jatha satsang days = total service record',
      run: runYearlySatsangReport
    },
    {
      id: 'jatha', icon: Plane, color: 'var(--gold)',
      title: 'Jatha Summary',
      desc: 'All jatha submissions: destination, dates, satsang days, flagged entries',
      run: runJathaReport
    },
    {
      id: 'sewadarcount', icon: Users, color: 'var(--text-secondary)',
      title: 'Sewadar Attendance Count',
      desc: 'Per-sewadar scan counts and total days present for the period',
      run: runSewadarCountReport
    },
  ]

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 960 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily:'Cinzel, serif', color:'var(--gold)', fontSize:'1.2rem' }}>Excel Reports</h2>
        <p className="text-muted text-xs mt-1">Generate and download detailed attendance reports</p>
      </div>

      {/* Global filters */}
      <div className="card mb-4" style={{ padding:'1rem' }}>
        <div style={{ fontSize:'0.78rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-muted)', marginBottom:'0.75rem', display:'flex', alignItems:'center', gap:'0.4rem' }}>
          <Filter size={13} /> Report Filters
        </div>
        <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap', alignItems:'flex-end' }}>
          <div>
            <label className="label" style={{ marginBottom:'0.3rem' }}>Year</label>
            <select className="input" value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))} style={{ width:100 }}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="label" style={{ marginBottom:'0.3rem' }}>Date From <span style={{ fontWeight:400, textTransform:'none', color:'var(--text-muted)' }}>(overrides year)</span></label>
            <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width:145 }} />
          </div>
          <div>
            <label className="label" style={{ marginBottom:'0.3rem' }}>Date To</label>
            <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width:145 }} />
          </div>
          <div onClick={ensureCentres}>
            <label className="label" style={{ marginBottom:'0.3rem' }}>Centre</label>
            <select className="input" value={centreFilter} onChange={e => setCentreFilter(e.target.value)} style={{ minWidth:160 }}>
              <option value="">{isAreaSecretary ? 'All Centres' : 'My Centres'}</option>
              {centres.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button className="btn btn-ghost" onClick={() => { setDateFrom(''); setDateTo(''); setCentreFilter(''); setYearFilter(CURRENT_YEAR) }} style={{ fontSize:'0.8rem', padding:'0.4rem 0.75rem' }}>
            Reset
          </button>
        </div>
      </div>

      {/* Report selector cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(210px,1fr))', gap:'0.75rem', marginBottom:'1.5rem' }}>
        {reportCards.map(rc => (
          <button key={rc.id} onClick={() => rc.run()}
            style={{
              textAlign:'left', padding:'1rem', borderRadius:10, cursor:'pointer', fontFamily:'Inter, sans-serif',
              border: activeReport === rc.id ? `2px solid ${rc.color}` : '1.5px solid var(--border)',
              background: activeReport === rc.id ? `${rc.color}08` : 'var(--bg-elevated)',
              transition:'all 0.15s', outline:'none'
            }}>
            <div style={{ width:36, height:36, borderRadius:8, background:`${rc.color}18`, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'0.6rem' }}>
              <rc.icon size={18} color={rc.color} />
            </div>
            <div style={{ fontWeight:700, fontSize:'0.88rem', color:'var(--text-primary)', marginBottom:'0.25rem' }}>{rc.title}</div>
            <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', lineHeight:1.4 }}>{rc.desc}</div>
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'3rem 0' }}>
          <div className="spinner" style={{ marginRight:'0.75rem' }} />
          <span className="text-muted">Generating report…</span>
        </div>
      )}

      {/* Results */}
      {!loading && reportData && (
        <div className="card">
          {/* Centre-wise report */}
          {reportData.type === 'centrewise' && (
            <>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
                <div>
                  <h3 style={{ fontWeight:700, marginBottom:'0.2rem' }}>Centre-wise Attendance</h3>
                  <p className="text-muted text-xs">{reportData.rows.length} centres · {reportData.rows.reduce((a,r)=>a+r.totalScans,0).toLocaleString()} total scans</p>
                </div>
                <button className="btn btn-ghost" onClick={exportCentreWise} style={{ fontSize:'0.82rem' }}>
                  <Download size={14} /> Download CSV
                </button>
              </div>
              <div className="table-wrap" style={{ border:'none' }}>
                <table>
                  <thead><tr><th>Centre</th><th>Total Scans</th><th>IN</th><th>OUT</th><th>Unique Sewadars</th></tr></thead>
                  <tbody>
                    {reportData.rows.map(r => (
                      <tr key={r.centre}>
                        <td style={{ fontWeight:500 }}>{r.centre}</td>
                        <td>{r.totalScans.toLocaleString()}</td>
                        <td><span className="badge badge-green">{r.ins}</span></td>
                        <td><span className="badge badge-red">{r.outs}</span></td>
                        <td style={{ fontWeight:600, color:'var(--blue)' }}>{r.uniqueCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Yearly satsang report */}
          {reportData.type === 'satsang' && (
            <>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
                <div>
                  <h3 style={{ fontWeight:700, marginBottom:'0.2rem' }}>Yearly Satsang Days — {reportData.year}</h3>
                  <p className="text-muted text-xs">{reportData.rows.length} sewadars · Combined daily + jatha service</p>
                </div>
                <button className="btn btn-ghost" onClick={exportYearlySatsang} style={{ fontSize:'0.82rem' }}>
                  <Download size={14} /> Download CSV
                </button>
              </div>
              <div className="table-wrap" style={{ border:'none' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Badge</th><th>Name</th><th>Centre</th><th>Duty Days</th>
                      <th>Satsang (Daily)</th><th>Jathas</th><th>Satsang (Jatha)</th>
                      <th style={{ background:'var(--gold-bg)', color:'var(--gold)' }}>Total Satsang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.rows.map(r => (
                      <tr key={r.badge}>
                        <td style={{ fontFamily:'monospace', fontSize:'0.8rem', color:'var(--gold)' }}>{r.badge}</td>
                        <td style={{ fontWeight:500 }}>{r.name}</td>
                        <td style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>{r.centre}</td>
                        <td>{r.dutyDays}</td>
                        <td><span className="badge badge-green">{r.satsangDaysAtt}</span></td>
                        <td>{r.jathaCount}</td>
                        <td><span className="badge" style={{ background:'var(--gold-bg)', color:'var(--gold)', border:'1px solid rgba(201,168,76,0.3)' }}>{r.jathaSatsangDays}</span></td>
                        <td><strong style={{ color:'var(--gold)', fontSize:'1rem' }}>{r.totalSatsangDays}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Jatha report */}
          {reportData.type === 'jatha' && (
            <>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
                <div>
                  <h3 style={{ fontWeight:700, marginBottom:'0.2rem' }}>Jatha Summary — {reportData.year}</h3>
                  <p className="text-muted text-xs">{reportData.rows.length} entries · {reportData.rows.reduce((a,r)=>a+(r.satsang_days||0),0)} total satsang days</p>
                </div>
                <button className="btn btn-ghost" onClick={exportJatha} style={{ fontSize:'0.82rem' }}>
                  <Download size={14} /> Download CSV
                </button>
              </div>
              <div className="table-wrap" style={{ border:'none' }}>
                <table>
                  <thead><tr><th>Badge</th><th>Name</th><th>Centre</th><th>Destination</th><th>From</th><th>To</th><th>Satsang Days</th><th>Flagged</th></tr></thead>
                  <tbody>
                    {reportData.rows.map(r => (
                      <tr key={r.id}>
                        <td style={{ fontFamily:'monospace', fontSize:'0.8rem', color:'var(--gold)' }}>{r.badge_number}</td>
                        <td style={{ fontWeight:500 }}>{r.sewadar_name}</td>
                        <td style={{ fontSize:'0.82rem' }}>{r.centre}</td>
                        <td style={{ fontSize:'0.82rem' }}>{r.jatha_centre} <span style={{ color:'var(--text-muted)' }}>· {r.jatha_dept}</span></td>
                        <td style={{ fontSize:'0.82rem', whiteSpace:'nowrap' }}>{r.date_from}</td>
                        <td style={{ fontSize:'0.82rem', whiteSpace:'nowrap' }}>{r.date_to}</td>
                        <td><span className="badge badge-green">{r.satsang_days}</span></td>
                        <td>{r.flag ? <span className="badge badge-red">Flagged</span> : '—'}</td>
                      </tr>
                    ))}
                    {reportData.rows.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign:'center', color:'var(--text-muted)', padding:'2rem' }}>No jatha records in this range.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Sewadar count report */}
          {reportData.type === 'sewadarcount' && (
            <>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
                <div>
                  <h3 style={{ fontWeight:700, marginBottom:'0.2rem' }}>Sewadar Attendance Count</h3>
                  <p className="text-muted text-xs">{reportData.rows.length} sewadars</p>
                </div>
                <button className="btn btn-ghost" onClick={exportSewadarCount} style={{ fontSize:'0.82rem' }}>
                  <Download size={14} /> Download CSV
                </button>
              </div>
              <div className="table-wrap" style={{ border:'none' }}>
                <table>
                  <thead><tr><th>Badge</th><th>Name</th><th>Centre</th><th>Department</th><th>IN Scans</th><th>OUT Scans</th><th>Days Present</th></tr></thead>
                  <tbody>
                    {reportData.rows.map(r => (
                      <tr key={r.badge}>
                        <td style={{ fontFamily:'monospace', fontSize:'0.8rem', color:'var(--gold)' }}>{r.badge}</td>
                        <td style={{ fontWeight:500 }}>{r.name}</td>
                        <td style={{ fontSize:'0.82rem' }}>{r.centre}</td>
                        <td style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>{r.dept||'—'}</td>
                        <td><span className="badge badge-green">{r.ins}</span></td>
                        <td><span className="badge badge-red">{r.outs}</span></td>
                        <td style={{ fontWeight:700, color:'var(--blue)' }}>{r.totalDays}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {!loading && !reportData && (
        <div style={{ textAlign:'center', padding:'3rem 0', color:'var(--text-muted)' }}>
          <FileSpreadsheet size={40} style={{ margin:'0 auto 0.75rem', opacity:0.3, display:'block' }} />
          <p style={{ fontSize:'0.9rem' }}>Select a report type above to generate data</p>
        </div>
      )}
    </div>
  )
}
