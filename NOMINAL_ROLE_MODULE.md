# NOMINAL ROLE MODULE — Complete Technical Specification

---

## 1. What Is a Nominal Role (NR)?

A **Nominal Role** is an **official sewadar attendance/travel document** submitted by a Satsang Centre to the Area Satsang Organisation (ASO) before a Jatha. It lists every sewadar going from that centre to perform sewa at a specific location during a specific date range.

Think of it as a **pre-approved roster / travel manifest** — it gets printed, signed by the Jathedar, stamped, and physically carried by the group when they travel to the Jatha site.

### What the Document Contains (based on the actual file)

#### Header / Meta Section
| Field | Example |
|---|---|
| Document Reference No. | `SCI/2020/84` |
| Satsang Place / Centre Name | `NIT-2 | SURAJKUND | DLF CITY` |
<!-- If these are more space taking then we write FARIDABAD  -->
| Area | `FARIDABAD` |
| Zone | `III` |
| Jathedar Name | `SHARAN KUMAR` |
| Jathedar Mobile | `9811683431` |
| Driver Name & Mobile | *(optional field)* |
| Vehicle Type & Number | `TRAIN | SACH KHAND EXPRESS` |
| Sewa Place + Incharge Name + Contact | `BEAS | ASHOK Kr. BATRA | 8264607997` |
| Department | `SANITATION` |
| Sewa Duration | `3 DAYS` |
| Date From | `09/04/2026` |
| Date To | `11/04/2026` |
| Arrival Date & Time | `08 April 2026, 10:00 PM` |
| Departure Date & Time | `12 April 2026, 6:00 AM` |

#### Sewadar Row (per person)
| Column | Description |
|---|---|
| S.No | Serial number |
| Badge Number / Aadhar Number | Either a system-issued Badge No. (e.g. `FB6008GA0021`) or Aadhar card number |
| Name of Sewadar | Full name |
| Father's / Husband's Name | Relation name |
| M/F | Gender |
| Age | Numeric age |
| Address & Phone No. | Full residential address + contact |
| Centre | Centre name + SRSID Code (e.g. `NIT-2 FDB/HR/111/017/202645/2`) |
<!-- SRS ID CODE is the code generated from a SRS Portal these codes remains same for all the sewadars participatin in same jatha from same satsang point that means it will be same for the 10 Sewadas from NUH but different for 5 Sewadars from Gurgaon. -->

#### Footer / Summary Section
| Field | Description |
|---|---|
| Total Sewadars | Auto-count of all rows |
| Male Count | Count of M rows |
| Female Count | Count of F rows |
| Jathedar Signature + Name | Sign-off |
| Secretary / Area Secretary Stamp | ASO-side stamp & date |

#### Sheets Structure
- **Sheet** — Primary NR sheet (can contain both M and F sewadars, named "MALE" by convention) 
<!-- If the Sheet is getting very big like more than 12 sewadars including male and female then we split the NR into 2 Pages i.e One sheet for Males, One sheet for Females -->
<!-- Structure remains the same for both the sheets just the femlaes are in one sheet and males are in other -->

---

## 2. How a Nominal Role Is Created — End-to-End Process

```
ASO creates Jatha Schedule (Quarterly)
        │
        ▼
18 Parent Centres view their Schedule (with their count quota)
        │
        ├── Parent Centre + its Sub-Centres coordinate
        │         Sub-Centres add their sewadars → lock their part
        │         Parent Centre reviews + approves all → submits to ASO
        ▼
ASO receives Centre NRs
        │
        ├── ASO can suggest edits / edit on centre's behalf
        ├── ASO merges 2–3 centre NRs into one combined NR (same Jatha only)
        │
        ▼
ASO finalises → Publishes → Prints the NR in official format
```

---

## 3. Module Implementation — Detailed Logic

### 3.1 ASO: Jatha Scheduling

- ASO creates a **Jatha Schedule** (quarterly).
- A schedule entry links to an existing **Jatha** record (from the Jatha table — place, department, incharge, etc.) and adds:
  - `from_date` / `to_date`
  - Per-centre **sewadar count quota** (one entry per each of the 18 parent centres)
- Once published, the schedule becomes **visible** to the relevant centres.

### 3.2 Centre: Viewing the Schedule

- Only **Parent Centres** receive count quotas from ASO.
- Each Parent Centre (and its Sub-Centres) can see the schedule — but **only their own entry** (i.e. their quota and Jatha details), not other centres' data.
- The schedule appears as a card/list item on their dashboard. Clicking it opens the **NR Creation Module**.

### 3.3 NR Creation — Collaborative Editing with Critical Section Control

This is the most complex part. The Parent Centre and all its Sub-Centres **share the same NR document** for a given Jatha. Access control must be handled carefully.

#### Roles within NR creation
| Role | Permissions |
|---|---|
| **Sub-Centre User** | Can add/edit/delete sewadars from their own sub-centre only. Once done, clicks **"Lock"** to signal completion. |
| **Parent Centre User** | Can view all entries (from self + all sub-centres). Can approve/reject sub-centre entries. Once satisfied, clicks **"Submit to ASO"**. |
| **ASO User** | Can view submitted NRs, suggest edits, edit directly on behalf of a centre, and merge NRs. |

#### Critical Section / Concurrency Rules
- When a Sub-Centre **locks** their section → their rows become **read-only** for them; Parent can still see them.
- When the Parent Centre clicks **"Submit"** → the entire NR is locked for all centre users; only ASO can edit.
- If ASO sends the NR back for correction → it re-opens for Parent Centre editing.
- **Concurrent editing safeguard**: If two sub-centre users open the same NR simultaneously, use **row-level locking** or **optimistic concurrency** (last-save-wins with conflict warning).

#### NR Status State Machine
```
DRAFT (Centre editing)
    │
    ├─ Sub-centres add sewadars → lock their sections
    │
    ▼
CENTRE_SUBMITTED (Parent clicks Submit)
    │
    ├─ ASO reviews
    ├─ ASO may → SENT_BACK (centre edits again → re-submit)
    │
    ▼
ASO_APPROVED / MERGED
    │
    ▼
PUBLISHED (Final, printable)
```

### 3.4 ASO: NR Management

| Action | Description |
|---|---|
| **View submitted NRs** | See all centre NRs for a given Jatha |
| **Suggest Edits** | Add comments/flags on specific rows for the centre to fix |
| **Edit on behalf** | Directly modify a centre's NR (overrides centre entries) |
| **Merge NRs** | Combine 2–3 centre NRs into a single NR (only allowed for the **same Jatha**; never across different Jathas) |
| **Finalise & Publish** | Lock the NR permanently; make it available for printing |
| **Print** | Generate the NR in the official printed format (matching the Excel template) |

---

## 4. Data Model (Suggested Tables)

```
jatha_schedules
  - id
  - jatha_id (FK → jatha table)
  - from_date, to_date
  - arrival_datetime, departure_datetime
  - status (draft | published)
  - created_by_aso_user_id

schedule_centre_quotas
  - id
  - schedule_id (FK → jatha_schedules)
  - centre_id (FK → centres, parent only)
  - quota_count (number of sewadars required)

nominal_roles
  - id
  - schedule_id (FK → jatha_schedules)
  - reference_no (e.g. SCI/2020/84)
  - jathedar_name, jathedar_mobile
  - driver_name, driver_mobile
  - vehicle_type, vehicle_no
  - sewa_place, incharge_name, incharge_contact
  - department
  - status (draft | centre_submitted | sent_back | aso_approved | merged | published)
  - merged_into_nr_id (nullable FK → nominal_roles, for merge tracking)
  - submitted_at, published_at

nominal_role_centres
  - id
  - nr_id (FK → nominal_roles)
  - centre_id
  - is_locked (sub-centre locked their section)
  - locked_at

nominal_role_sewadars
  - id
  - nr_id (FK → nominal_roles)
  - centre_id (which centre/sub-centre added this row)
  - sno (serial number within NR)
  - badge_or_aadhar
  - name, relation_name
  - gender (M/F)
  - age
  - address, phone
  - centre_code
  - added_by_user_id
  - is_approved (parent centre approval flag)
  - row_locked (true once sub-centre locks)
```

---

## 5. Print Format Requirements

The printed NR must match the official Excel format exactly:

- **Header block** with all meta fields (reference no., centre name, area, zone, jathedar, vehicle, sewa place, department, dates)
- **Sewadar table** with columns: S.No | Badge/Aadhar No. | Name | Father/Husband Name | M/F | Age | Address & Phone | Centre
- **Summary row**: Total Sewadars | Male count | Female count (auto-calculated)
- **Footer**: Jathedar signature line + Secretary/Area Secretary stamp block with date
- **Annexure sheet**: Auto-generated if sewadar count exceeds 25; same column structure, labelled "ANNEXURE TO NOMINAL ROLL OF SEWA JATHA"
- Note at bottom of Annexure: *"THE IDENTITY, AGE AND FITNESS OF EACH SEWADAR IS HEREBY CONFIRMED"*

---

## 6. Key Business Rules Summary

1. Only **Parent Centres** receive quotas from ASO — sub-centres work under their parent.
2. A centre can see **only their own** schedule entry, not other centres'.
3. Sub-centres and parent centres **share one NR document** per Jatha — critical section rules apply.
4. Sub-centres must **lock** before parent can submit; parent must **submit** before ASO can finalise.
5. ASO can only **merge NRs within the same Jatha** — never across different Jathas.
6. Once **Published**, no further edits are possible by anyone.
7. Annexure is used as overflow when sewadars **exceed 25**; both sheets together form the complete NR.
8. The NR carries both Badge Numbers (system-issued) and Aadhar Numbers as identity proof.
