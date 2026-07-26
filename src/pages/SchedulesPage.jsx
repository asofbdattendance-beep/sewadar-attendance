import { useAuth } from '../context/AuthContext'
import ScheduleManager from './reports/ScheduleManager'

export default function SchedulesPage() {
  const { profile, hasPermission } = useAuth()
  return <ScheduleManager profile={profile} hasPermission={hasPermission} />
}
