# NOMINAL ROLE MODULE — Implementation Plan

## Document Status
- **Version**: 1.0
- **Date**: 2026-04-17
- **Status**: Ready for Review

---

## 1. Overview

This document describes the implementation plan for adding a **Nominal Role (NR) Module** to the existing Sewadar Attendance System.

### 1.1 What is a Nominal Role?

A Nominal Role is an official sewadar attendance/travel document submitted by a Satsang Centre to the Area Satsang Organisation (ASO) before a Jatha. It lists every sewadar going from that centre to perform sewa at a specific location during a specific date range.

Think of it as a **pre-approved roster / travel manifest** — it gets printed, signed by the Jathedar, stamped, and physically carried by the group when they travel to the Jatha site.

### 1.2 Current System State

| Component | Status |
|-----------|--------|
| Supabase Schema | `supabase_schema.sql` with existing tables |
| User Roles | `super_admin`, `admin`, `centre_user`, `sc_sp_user` |
| Centres | 42 centres (18 parent + 24 sub-centres) |
| Jatha Master | Exists with beas, major_centre, jatha_home types |
| Jatha Attendance | Separate table for tracking actual jatha attendance |
| Frontend | React + Vite, component-based architecture |

---

## 2. Database Schema Changes

### 2.1 New Tables to Add

Add the following tables to `supabase_schema.sql`:

```sql
-- ============================================================
-- NOMINAL ROLE MODULE TABLES
-- ============================================================

-- 2.1 JATHA SCHEDULES (ASO creates quarterly)
CREATE TABLE IF NOT EXISTS jatha_schedules (
  id BIGSERIAL PRIMARY KEY,
  jatha_id BIGINT REFERENCES jatha_master(id),
  schedule_name TEXT NOT NULL,
  area TEXT,
  zone TEXT,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  arrival_datetime TIMESTAMPTZ,
  departure_datetime TIMESTAMPTZ,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.2 SCHEDULE CENTRE QUOTAS
CREATE TABLE IF NOT EXISTS schedule_centre_quotas (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT REFERENCES jatha_schedules(id) ON DELETE CASCADE,
  centre_id BIGINT REFERENCES centres(id),
  quota_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(schedule_id, centre_id)
);

-- 2.3 NOMINAL ROLES (main document)
CREATE TABLE IF NOT EXISTS nominal_roles (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT REFERENCES jatha_schedules(id),
  reference_no TEXT UNIQUE,
  centre_id BIGINT REFERENCES centres(id),
  area TEXT,
  zone TEXT,
  jathedar_name TEXT,
  jathedar_mobile TEXT,
  driver_name TEXT,
  driver_mobile TEXT,
  vehicle_type TEXT,
  vehicle_no TEXT,
  sewa_place TEXT,
  incharge_name TEXT,
  incharge_contact TEXT,
  department TEXT,
  sewa_duration TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'centre_submitted', 'sent_back', 'aso_approved', 'merged', 'published')),
  merged_into_nr_id BIGINT REFERENCES nominal_roles(id),
  submitted_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.4 NOMINAL ROLE CENTRES (linking centres to NR)
CREATE TABLE IF NOT EXISTS nominal_role_centres (
  id BIGSERIAL PRIMARY KEY,
  nr_id BIGINT REFERENCES nominal_roles(id) ON DELETE CASCADE,
  centre_id BIGINT REFERENCES centres(id),
  is_locked BOOLEAN DEFAULT FALSE,
  locked_at TIMESTAMPTZ,
  locked_by BIGINT REFERENCES users(id),
  UNIQUE(nr_id, centre_id)
);

-- 2.5 NOMINAL ROLE SEWADARS (individual rows)
CREATE TABLE IF NOT EXISTS nominal_role_sewadars (
  id BIGSERIAL PRIMARY KEY,
  nr_id BIGINT REFERENCES nominal_roles(id) ON DELETE CASCADE,
  centre_id BIGINT REFERENCES centres(id),
  sno INTEGER,
  badge_or_aadhar TEXT,
  badge_number TEXT REFERENCES sewadars(badge_number),
  name TEXT NOT NULL,
  relation_name TEXT,
  gender TEXT CHECK (gender IN ('M', 'F')),
  age INTEGER,
  address TEXT,
  phone TEXT,
  centre_code TEXT,
  srs_id_code TEXT,
  added_by BIGINT REFERENCES users(id),
  is_approved BOOLEAN DEFAULT FALSE,
  row_locked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.6 NR COMMENTS (ASO feedback on rows)
CREATE TABLE IF NOT EXISTS nr_comments (
  id BIGSERIAL PRIMARY KEY,
  nr_sewadar_id BIGINT REFERENCES nominal_role_sewadars(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  commented_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.2 Indexes for Performance

```sql
-- Schedule indexes
CREATE INDEX IF NOT EXISTS idx_jatha_schedules_status ON jatha_schedules(status);
CREATE INDEX IF NOT EXISTS idx_jatha_schedules_dates ON jatha_schedules(from_date, to_date);
CREATE INDEX IF NOT EXISTS idx_schedule_quotas_schedule ON schedule_centre_quotas(schedule_id);

-- NR indexes
CREATE INDEX IF NOT EXISTS idx_nominal_roles_schedule ON nominal_roles(schedule_id);
CREATE INDEX IF NOT EXISTS idx_nominal_roles_status ON nominal_roles(status);
CREATE INDEX IF NOT EXISTS idx_nominal_roles_centre ON nominal_roles(centre_id);
CREATE INDEX IF NOT EXISTS idx_nominal_roles_centres ON nominal_role_centres(nr_id);
CREATE INDEX IF NOT EXISTS idx_nominal_roles_sewadars ON nominal_role_sewadars(nr_id);
CREATE INDEX IF NOT EXISTS idx_nominal_roles_sewadars_centre ON nominal_role_sewadars(centre_id);
```

### 2.3 RLS Policies

```sql
-- JATHA SCHEDULES
ALTER TABLE jatha_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedules_read_all" ON jatha_schedules FOR SELECT TO authenticated
  USING (status = 'published' OR created_by = (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "schedules_aso_write" ON jatha_schedules FOR ALL TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin'));

-- SCHEDULE CENTRE QUOTAS
ALTER TABLE schedule_centre_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quotas_read" ON schedule_centre_quotas FOR SELECT TO authenticated USING (true);
CREATE POLICY "quotas_write" ON schedule_centre_quotas FOR ALL TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin'));

-- NOMINAL ROLES
ALTER TABLE nominal_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nr_read" ON nominal_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "nr_write" ON nominal_roles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "nr_update" ON nominal_roles FOR UPDATE TO authenticated
  USING (
    -- ASO can update any
    get_user_role() IN ('super_admin', 'admin')
    OR
    -- Centre users can update draft/sent_back for their centre
    (get_user_role() = 'centre_user' AND status IN ('draft', 'sent_back'))
  );

-- NOMINAL ROLE CENTRES
ALTER TABLE nominal_role_centres ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nrc_read" ON nominal_role_centres FOR SELECT TO authenticated USING (true);
CREATE POLICY "nrc_write" ON nominal_role_centres FOR ALL TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin', 'centre_user'));

-- NOMINAL ROLE SEWADARS
ALTER TABLE nominal_role_sewadars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nrs_read" ON nominal_role_sewadars FOR SELECT TO authenticated USING (true);
CREATE POLICY "nrs_write" ON nominal_role_sewadars FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "nrs_update" ON nominal_role_sewadars FOR UPDATE TO authenticated
  USING (
    -- ASO can update any
    get_user_role() IN ('super_admin', 'admin')
    OR
    -- Centre users can update non-locked rows in draft/sent_back status
    (get_user_role() = 'centre_user' AND row_locked = FALSE)
  );
CREATE POLICY "nrs_delete" ON nominal_role_sewadars FOR DELETE TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin') OR row_locked = FALSE);

-- NR COMMENTS
ALTER TABLE nr_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nr_comments_read" ON nr_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "nr_comments_write" ON nr_comments FOR ALL TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin'));
```

---

## 3. Frontend Architecture

### 3.1 New File Structure

```
src/
├── pages/
│   └── NominalRole/
│       ├── SchedulesPage.jsx        # View/manage schedules (ASO)
│       ├── ScheduleCreatePage.jsx   # Create new schedule (ASO)
│       ├── NRListPage.jsx           # List NRs for a schedule
│       ├── NRCreatePage.jsx         # Create/edit NR (Centres)
│       ├── NRViewPage.jsx           # View NR details
│       └── NRPrintPage.jsx          # Print-ready view
├── components/
│   └── NominalRole/
│       ├── ScheduleCard.jsx         # Schedule display card
│       ├── NRTable.jsx              # Sewadar table component
│       ├── NRForm.jsx               # Sewadar row form
│       ├── NRHeader.jsx             # Header section form
│       ├── NRStatusBadge.jsx        # Status indicator
│       ├── NRPrintLayout.jsx        # Print-optimized layout
│       └── QuotaEditor.jsx          # Edit centre quotas
└── lib/
    ├── nr-utils.js                   # NR-specific utilities
    └── nr-api.js                    # API functions for NR
```

### 3.2 Route Additions (App.jsx)

```jsx
// New imports
import SchedulesPage from './pages/NominalRole/SchedulesPage'
import ScheduleCreatePage from './pages/NominalRole/ScheduleCreatePage'
import NRListPage from './pages/NominalRole/NRListPage'
import NRCreatePage from './pages/NominalRole/NRCreatePage'
import NRViewPage from './pages/NominalRole/NRViewPage'
import NRPrintPage from './pages/NominalRole/NRPrintPage'

// Add to navItems (conditionally based on role)
{ path: '/nr-schedules', label: 'NR', icon: FileBarChart } // ASO/Parent Centre only

// Add routes
<Route path="/nr-schedules" element={<SchedulesPage />} />
<Route path="/nr-schedules/create" element={<ScheduleCreatePage />} />
<Route path="/nr-schedules/:id" element={<NRListPage />} />
<Route path="/nr/:id/create" element={<NRCreatePage />} />
<Route path="/nr/:id" element={<NRViewPage />} />
<Route path="/nr/:id/print" element={<NRPrintPage />} />
```

### 3.3 Navigation Visibility Rules

| Role | See NR Nav | Can Access |
|------|------------|------------|
| super_admin | Yes | All schedules & NRs |
| admin | Yes | All schedules & NRs |
| centre_user | Yes (Parent only) | Own centre's NRs |
| sc_sp_user | No | None |

---

## 4. Page-by-Page Implementation

### 4.1 Schedules Page (`/nr-schedules`)

**Access**: ASO (super_admin, admin), Parent Centres (centre_user)

**Features**:
- List all schedules (filtered by role)
- Status filters: All, Draft, Published
- Create new schedule (ASO only)
- View schedule details
- Quota management per centre

**UI Components**:
- Schedule cards with status badge
- Quota summary per centre
- Quick actions (Edit, Publish, View NRs)

### 4.2 Schedule Create Page (`/nr-schedules/create`)

**Access**: ASO only

**Form Fields**:
- Schedule Name (text)
- Jatha Selection (dropdown from jatha_master)
- Area (text)
- Zone (text)
- From Date / To Date (date pickers)
- Arrival DateTime (datetime)
- Departure DateTime (datetime)
- Centre Quotas (dynamic list of 18 parent centres with quota counts)

**Actions**:
- Save as Draft
- Publish Schedule

### 4.3 NR List Page (`/nr-schedules/:id`)

**Access**: Based on NR visibility

**Features**:
- List all NRs for a schedule
- NR status summary (draft count, submitted count, etc.)
- Filter by status, centre
- Create new NR (for each centre)
- Bulk actions for ASO

### 4.4 NR Create/Edit Page (`/nr/:id/create`)

**Access**: Centre users (Parent + Sub-centres)

**Features**:
- Header section form
- Sewadar table (add/edit/delete)
- Lock section functionality
- Submit to ASO

**Sewadar Row Fields**:
- Serial Number (auto)
- Badge/Aadhar Number
- Name
- Father's/Husband's Name
- Gender (M/F)
- Age
- Address & Phone
- Centre Code / SRS ID Code

**Validation**:
- Badge number validation (exists in sewadars table)
- Required field validation
- Duplicate badge check within same NR

### 4.5 NR View Page (`/nr/:id`)

**Access**: All (with role-based restrictions)

**Features**:
- Read-only view
- Status workflow actions
- Comments/feedback (ASO)
- Print button

**ASO Actions**:
- Edit on behalf
- Suggest edits (add comments)
- Send back for correction
- Approve
- Merge with other NRs
- Publish

### 4.6 NR Print Page (`/nr/:id/print`)

**Access**: All (authenticated)

**Features**:
- Print-optimized layout
- Official NR format
- Auto page breaks (>25 sewadars)
- Annexure generation

**Print Format**:
- Header with reference number
- Meta section (all details)
- Sewadar table (per sheet max 25 rows)
- Summary footer
- Signature blocks
- Annexure if needed

---

## 5. NR Status State Machine

```
┌─────────────────────────────────────────────────────────────┐
│                        NR WORKFLOW                          │
└─────────────────────────────────────────────────────────────┘

                         ┌──────────────┐
                         │    DRAFT     │
                         │ (Centre edit) │
                         └──────┬───────┘
                                │
              ┌─────────────────┼─────────────────┐
              │ Sub-centres add │ Parents review   │
              │ sewadars        │ and approve      │
              └─────────────────┼─────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  CENTRE_SUBMITTED      │
                    │  (Locked, ASO review) │
                    └───────────┬───────────┘
                                │
           ┌────────────────────┼────────────────────┐
           │                    │                    │
           ▼                    ▼                    ▼
┌──────────────────┐  ┌─────────────────┐  ┌───────────────┐
│   SENT_BACK      │  │   ASO_APPROVED   │  │    MERGED     │
│ (Centre edits)   │  │                  │  │ (Combine NRs) │
└────────┬────────┘  └────────┬────────┘  └───────┬───────┘
         │                     │                     │
         │ Re-submit           │                    │
         └──────────►CENTRE_SUBMITTED◄─────────────┘
                                │
                                ▼
                    ┌───────────────────┐
                    │    PUBLISHED     │
                    │ (Final, Printable)│
                    └───────────────────┘
```

### 5.1 Status Definitions

| Status | Description | Editable By | Actions Available |
|--------|-------------|--------------|-------------------|
| `draft` | Centre editing | Centre users | Lock, Submit |
| `centre_submitted` | Submitted, awaiting ASO | ASO only | Edit, Approve, Send Back, Merge |
| `sent_back` | Returned for corrections | Centre users | Edit, Re-submit |
| `aso_approved` | Approved by ASO | ASO only | Publish, Merge |
| `merged` | Combined with another NR | ASO only | Publish |
| `published` | Final, locked | None | Print |

---

## 6. Role Permissions Matrix

### 6.1 Schedule Permissions

| Action | super_admin | admin | centre_user | sc_sp_user |
|--------|-------------|-------|-------------|------------|
| Create Schedule | ✓ | ✓ | ✗ | ✗ |
| View Schedule | ✓ | ✓ | ✓ (own) | ✗ |
| Edit Schedule | ✓ | ✓ | ✗ | ✗ |
| Publish Schedule | ✓ | ✓ | ✗ | ✗ |
| Manage Quotas | ✓ | ✓ | ✗ | ✗ |

### 6.2 NR Permissions

| Action | super_admin | admin | centre_user | sc_sp_user |
|--------|-------------|-------|-------------|------------|
| Create NR | ✓ | ✓ | ✓ (parent) | ✗ |
| View NR | ✓ | ✓ | ✓ (own centre) | ✗ |
| Edit NR Sewadar | ✓ | ✓ | ✓ (non-locked) | ✗ |
| Lock Section | ✓ | ✓ | ✓ | ✗ |
| Submit to ASO | ✓ | ✓ | ✓ | ✗ |
| Approve NR | ✓ | ✓ | ✗ | ✗ |
| Send Back | ✓ | ✓ | ✗ | ✗ |
| Merge NRs | ✓ | ✓ | ✗ | ✗ |
| Publish NR | ✓ | ✓ | ✗ | ✗ |
| Print NR | ✓ | ✓ | ✓ | ✗ |

---

## 7. Key Business Rules

### 7.1 NR Creation Rules

1. **Quota Enforcement**: A centre cannot add more sewadars than their assigned quota (unless overridden by ASO)
2. **Duplicate Prevention**: Same sewadar cannot be added to the same NR twice
3. **Jatha Date Validation**: NR dates must fall within schedule date range
4. **SRS ID Code**: Each sub-centre has a consistent SRS ID for all its sewadars in a jatha

### 7.2 Sheet Splitting Rules

1. **Auto-Split Threshold**: When sewadars exceed 25 per sheet, create Annexure
2. **Gender Split**: Option to split into Male/Female sheets if count > 12
3. **Continuity**: Annexure clearly references main NR reference number

### 7.3 Merge Rules

1. **Same Jatha Only**: Can only merge NRs for the same schedule/jatha
2. **All Same Status**: All NRs must be in `aso_approved` status to merge
3. **Reference Preservation**: Original NR reference numbers noted in merged NR
4. **Audit Trail**: Original NR IDs stored in `merged_into_nr_id`

### 7.4 Locking Rules

1. **Sub-centre Lock**: Locks only that centre's rows; parent can still see
2. **NR Submit**: Locks entire NR for centre users; only ASO can edit
3. **ASO Unlock**: ASO sending back re-enables centre editing
4. **Publish Lock**: Once published, no further changes possible

---

## 8. API Functions

### 8.1 Supabase RPC Functions

```sql
-- Get NR with all sewadars
CREATE OR REPLACE FUNCTION get_nr_details(p_nr_id BIGINT)
RETURNS JSON AS $$
  SELECT 
    json_build_object(
      'nr', (SELECT row_to_json(nr) FROM nominal_roles nr WHERE id = p_nr_id),
      'centres', (SELECT json_agg(row_to_json(nrc)) FROM nominal_role_centres nrc WHERE nr_id = p_nr_id),
      'sewadars', (SELECT json_agg(row_to_json(nrs)) FROM nominal_role_sewadars nrs WHERE nr_id = p_nr_id ORDER BY nrs.sno)
    );
$$ LANGUAGE SQL SECURITY DEFINER;

-- Get schedule with quotas
CREATE OR REPLACE FUNCTION get_schedule_details(p_schedule_id BIGINT)
RETURNS JSON AS $$
  SELECT 
    json_build_object(
      'schedule', (SELECT row_to_json(*) FROM jatha_schedules WHERE id = p_schedule_id),
      'quotas', (SELECT json_agg(q.*) FROM schedule_centre_quotas q WHERE schedule_id = p_schedule_id),
      'nr_count', (SELECT COUNT(*) FROM nominal_roles WHERE schedule_id = p_schedule_id)
    );
$$ LANGUAGE SQL SECURITY DEFINER;

-- Lock NR centre section
CREATE OR REPLACE FUNCTION lock_nr_centre(p_nr_id BIGINT, p_centre_id BIGINT, p_user_id BIGINT)
RETURNS VOID AS $$
  UPDATE nominal_role_centres 
  SET is_locked = TRUE, locked_at = NOW(), locked_by = p_user_id
  WHERE nr_id = p_nr_id AND centre_id = p_centre_id;
$$ LANGUAGE SQL SECURITY DEFINER;
```

### 8.2 Frontend API Module (nr-api.js)

```javascript
// Schedule APIs
export async function fetchSchedules(status) { ... }
export async function createSchedule(data) { ... }
export async function updateSchedule(id, data) { ... }
export async function publishSchedule(id) { ... }

// NR APIs
export async function fetchNRDetails(id) { ... }
export async function createNR(scheduleId, data) { ... }
export async function updateNR(id, data) { ... }
export async function submitNR(id) { ... }
export async function approveNR(id) { ... }
export async function sendBackNR(id, comments) { ... }
export async function mergeNRs(sourceIds, targetId) { ... }
export async function publishNR(id) { ... }

// Sewadar APIs
export async function addSewadar(nrId, sewadarData) { ... }
export async function updateSewadar(id, data) { ... }
export async function deleteSewadar(id) { ... }
export async function lockCentreSection(nrId, centreId) { ... }
```

---

## 9. Print Layout Specification

### 9.1 Main NR Sheet

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AREA SATSANG ORGANISATION                       │
│                           [Area Name] - [Zone Name]                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Reference No.: ___________    Date: ___________                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  Satsang Place: _______________________________                           │
│  Department: _______________________________                                │
│  Sewa Duration: _______________              Jathedar: ____________________ │
│  Mobile: _______________                     Driver: ______________________ │
│  Vehicle: _______________ (Type & No.)                                       │
│  Sewa Place: _____________________________                                  │
│  Incharge: _____________________________ Contact: __________________________ │
├─────────────────────────────────────────────────────────────────────────────┤
│  DATE FROM: _____________    DATE TO: _____________                        │
│  ARRIVAL: _____________       DEPARTURE: _____________                      │
├────┬─────────────┬──────────────────┬───────────┬────┬──────┬─────────────┤
│S.No│Badge/Aadhar │      Name       │Father/Husb│ M/F│ Age  │  Address    │
├────┼─────────────┼──────────────────┼───────────┼────┼──────┼─────────────┤
│ 1  │             │                  │           │    │      │             │
│ 2  │             │                  │           │    │      │             │
│... │             │                  │           │    │      │             │
│ 25 │             │                  │           │    │      │             │
├────┴─────────────┴──────────────────┴───────────┴────┴──────┴─────────────┤
│  TOTAL: ____    MALE: ____    FEMALE: ____                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Jathedar Signature: _______________________    Date: ________              │
│  Secretary/Area Secretary Stamp:                                              │
│  _________________________________________________________________________ │
│  Date: ___________                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Annexure Sheet

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ANNEXURE TO NOMINAL ROLL OF SEWA JATHA                  │
│                      Reference No.: _______________                         │
│                      (Continuation Sheet)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  * THE IDENTITY, AGE AND FITNESS OF EACH SEWADAR IS HEREBY CONFIRMED *    │
├────┬─────────────┬──────────────────┬───────────┬────┬──────┬─────────────┤
│S.No│Badge/Aadhar │      Name       │Father/Husb│ M/F│ Age  │  Address    │
├────┼─────────────┼──────────────────┼───────────┼────┼──────┼─────────────┤
│ 26 │             │                  │           │    │      │             │
│... │             │                  │           │    │      │             │
├────┴─────────────┴──────────────────┴───────────┴────┴──────┴─────────────┤
│  TOTAL: ____    MALE: ____    FEMALE: ____                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Implementation Phases

### Phase 1: Database & Schema (Day 1)
- [ ] Add new tables to `supabase_schema.sql`
- [ ] Add indexes
- [ ] Add RLS policies
- [ ] Add RPC functions
- [ ] Run migration in Supabase

### Phase 2: Core Infrastructure (Day 2)
- [ ] Create `nr-utils.js` and `nr-api.js`
- [ ] Add NR constants to `supabase.js`
- [ ] Create NRStatusBadge component
- [ ] Create NRPrintLayout component

### Phase 3: Schedules (Day 3)
- [ ] Create SchedulesPage
- [ ] Create ScheduleCreatePage
- [ ] Create ScheduleCard component
- [ ] Create QuotaEditor component
- [ ] Add routes to App.jsx

### Phase 4: NR Creation (Day 4-5)
- [ ] Create NRListPage
- [ ] Create NRCreatePage
- [ ] Create NRHeader form
- [ ] Create NRTable component
- [ ] Create NRForm component
- [ ] Implement locking logic

### Phase 5: NR View & Actions (Day 6)
- [ ] Create NRViewPage
- [ ] Implement status workflow actions
- [ ] Add comments feature
- [ ] Implement merge functionality

### Phase 6: Print (Day 7)
- [ ] Create NRPrintPage
- [ ] Implement Annexure generation
- [ ] CSS for print media queries
- [ ] Test print layouts

### Phase 7: Testing & Polish (Day 8)
- [ ] Role-based access testing
- [ ] Status workflow testing
- [ ] Print testing
- [ ] Bug fixes
- [ ] Documentation

---

## 11. Open Questions for User

1. **SRS ID Code**: Where does this come from? Manual entry or external system integration?

2. **Jathedar Signature**: Should we store signature image URLs in the database, or just provide blank signature lines for manual signing?

3. **Annexure Trigger**: Should Annexure split at exactly 25 sewadars, or make it configurable?

4. **Merge Behavior**: When merging NRs, should the original NRs be:
   - Soft-deleted (archived)?
   - Have their status changed to 'merged'?
   - Remain unchanged and just reference the merged NR?

5. **Quota Override**: Should ASO be able to override quota limits when adding sewadars?

6. **Mobile Access**: Should this module be mobile-responsive or desktop-first?

7. **Offline Support**: Should the NR creation work offline (sync later) like the attendance module?

---

## 12. Files to Modify/Create

### Files to Modify
| File | Changes |
|------|---------|
| `supabase_schema.sql` | Add new tables, indexes, RLS, functions |
| `src/lib/supabase.js` | Add NR status constants |
| `src/App.jsx` | Add routes and navigation |
| `src/context/AuthContext.jsx` | Potentially add helper functions |

### Files to Create
| File | Purpose |
|------|---------|
| `src/lib/nr-utils.js` | Utility functions for NR |
| `src/lib/nr-api.js` | API functions for NR operations |
| `src/pages/NominalRole/SchedulesPage.jsx` | Schedule list |
| `src/pages/NominalRole/ScheduleCreatePage.jsx` | Create/edit schedule |
| `src/pages/NominalRole/NRListPage.jsx` | NR list for schedule |
| `src/pages/NominalRole/NRCreatePage.jsx` | Create/edit NR |
| `src/pages/NominalRole/NRViewPage.jsx` | View NR details |
| `src/pages/NominalRole/NRPrintPage.jsx` | Print-ready view |
| `src/components/NominalRole/ScheduleCard.jsx` | Schedule card |
| `src/components/NominalRole/NRTable.jsx` | Sewadar table |
| `src/components/NominalRole/NRForm.jsx` | Sewadar row form |
| `src/components/NominalRole/NRHeader.jsx` | NR header form |
| `src/components/NominalRole/NRStatusBadge.jsx` | Status badge |
| `src/components/NominalRole/NRPrintLayout.jsx` | Print layout |
| `src/components/NominalRole/QuotaEditor.jsx` | Quota editor |

---

## 13. Dependencies

### Existing
- React 18+
- Vite
- React Router DOM
- Supabase JS Client
- Lucide React (icons)

### No New Dependencies Required
- All functionality achievable with existing stack
- Print functionality via CSS `@media print`
- PDF export via browser print-to-PDF

---

## 14. Integration with Existing Modules

### 14.1 Relationship with Jatha Attendance

The NR module and Jatha Attendance module serve different purposes:

| Module | Purpose | Timing |
|--------|---------|--------|
| Nominal Role | Pre-approval roster | Before jatha |
| Jatha Attendance | Actual check-in/out | During jatha |

They are **separate but related**:
- NR provides the list of expected sewadars
- Jatha Attendance tracks actual presence
- They can be cross-referenced for reporting (who was expected vs who actually came)

### 14.2 Existing Sewadar Data

The `sewadars` table is already populated with:
- Badge numbers
- Names
- Father/Husband name
- Gender
- Age
- Centre
- Department

NR sewadar rows will reference existing sewadars by `badge_number` when available.

---

*End of Document*
