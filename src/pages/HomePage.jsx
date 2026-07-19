import { useNavigate } from 'react-router-dom'
import { Calendar, Users, ChevronRight, FileBarChart } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

const MODULES = [
  {
    id: 'attendance',
    title: 'Attendance Management',
    description: 'Dashboard, scan in/out, records, manual entry, reports & downloads',
    icon: Users,
    path: '/attendance',
    permission: null,
    color: '#217346',
  },
  {
    id: 'schedules',
    title: 'Schedule Management',
    description: 'Create, edit, and export jatha schedules',
    icon: Calendar,
    path: '/schedules',
    permission: 'schedule_view',
    color: '#1565C0',
  },
]

export default function HomePage() {
  const navigate = useNavigate()
  const { profile, hasPermission } = useAuth()

  const visibleModules = MODULES.filter(m => {
    if (!m.permission) return true
    return hasPermission(m.permission)
  })

  return (
    <div className="page-full pb-nav">
      <div className="home-header">
        <h2>Select Module</h2>
        {profile && (
          <p className="home-subtitle">
            Welcome, {profile.name || profile.centre || 'User'}
          </p>
        )}
      </div>
      <div className="module-grid">
        {visibleModules.map(m => {
          const Icon = m.icon
          return (
            <button
              key={m.id}
              className="module-tile"
              onClick={() => navigate(m.path)}
              style={{ '--tile-accent': m.color }}
            >
              <div className="module-tile-icon" style={{ background: `${m.color}15`, color: m.color }}>
                <Icon size={32} />
              </div>
              <div className="module-tile-body">
                <h3 className="module-tile-title">{m.title}</h3>
                <p className="module-tile-desc">{m.description}</p>
              </div>
              <ChevronRight size={20} className="module-tile-arrow" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
