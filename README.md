# Sewadar Attendance System

A React-based attendance management system for tracking sewadar (volunteer worker) attendance at spiritual centers. Built with Supabase (PostgreSQL + Auth + Realtime).

## Features

- **Barcode Scanner** - Camera-based badge scanning for IN/OUT marking
- **Session Management** - Automatic session tracking with duration validation
- **Duty Type Assignment** - Auto-assigns Satsang (Wed/Sun), Gate Entry, or Watch & Ward
- **Jatha Management** - Track attendance during spiritual camps
- **Error Reporting** - Flag and resolve attendance discrepancies
- **Role-Based Access** - ASO (Admin) and Centre-level users
- **PWA Ready** - Can be installed as a progressive web app

## Tech Stack

- **Frontend**: React 18, Vite, React Router
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions)
- **UI**: Lucide Icons, Custom CSS
- **Testing**: Vitest

## Prerequisites

- Node.js 18+
- Supabase project
- Environment variables (see below)

## Setup

```bash
# Install dependencies
npm install

# Development
npm run dev

# Build for production
npm run build

# Run tests
npm run test:run
```

## Environment Variables

Create `.env` file:

```
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## User Roles

| Role | Access |
|------|--------|
| **ASO** | Full access - manage users, sewadars, all centres |
| **CENTRE** | Limited - only their centre's data |

## Session Rules

- **Min Duration**: 10 minutes between IN and OUT
- **Max Duration**: 12 hours for all duty types
- **Satsang Days**: Wed/Sun - special handling for same-day sessions

## Database Schema

- `users` - System users (ASO, Centre)
- `sewadars` - Registered sewadar master data
- `centres` - Centre locations with GPS
- `attendance` - Individual scan records
- `attendance_sessions` - IN/OUT session pairs
- `jatha_attendance` - Jatha camp attendance

## License

Private - For internal use only