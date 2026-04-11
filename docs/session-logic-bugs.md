# SESSION LOGIC BUG ANALYSIS
# Sewadar Attendance System

## Date: 2026-04-01

---

## ✅ FIXES APPLIED

### 1. NEGATIVE DURATION BUG (FIXED)
**Issue:** `formatDuration()` could return negative values if OUT time was before IN time.

**Fix:** Added validation in `formatDuration()`, `isNegativeDuration()`, and `getDurationMinutes()` functions.

```javascript
// Before: Returned negative values
const mins = Math.round((new Date(outTime) - new Date(inTime)) / 60000)

// After: Returns null for invalid durations
if (diffMs < 0) return null  // Negative duration
if (diffMs > 86400000) return null  // Exceeds 24 hours
```

---

### 2. DUPLICATE SCAN DETECTION (FIXED)
**Issue:** No protection against duplicate scans of the same badge within seconds.

**Fix:** Added duplicate detection in `handleScan()`:
```javascript
// Check for duplicate scan (same badge within 3 seconds)
if (lastScanBadgeRef.current === badge && now - lastScanTimeRef.current < 3000) {
  return  // Block duplicate
}
```

---

### 3. OUT BEFORE IN VALIDATION (FIXED)
**Issue:** No validation to prevent OUT time being before IN time.

**Fix:** Added validation in `executeScan()` OUT path:
```javascript
if (openSession.in_time && new Date(scanTimeISO) < new Date(openSession.in_time)) {
  throw new Error('OUT time cannot be before IN time. Please correct the scan.')
}
```

---

### 4. MAX SESSION DURATION (FIXED)
**Issue:** No check for sessions exceeding reasonable duration (e.g., 24 hours).

**Fix:** Added validation in `executeScan()`:
```javascript
const MAX_SESSION_MS = 24 * 60 * 60 * 1000
if (durationMs > MAX_SESSION_MS) {
  throw new Error('Session duration exceeds 24 hours. Please use Manual Entry.')
}
```

---

### 5. STANDALONE OUT REASON FLAG (FIXED)
**Issue:** ASO standalone OUT didn't explicitly require a reason.

**Fix:** Added `requiresReason` flag to evaluation result:
```javascript
return {
  status: 'allowed',
  action: 'standalone_out',
  todaySessions,
  canOverride: isAso,
  requiresReason: isAso,  // ASO must provide reason
}
```

---

## 📋 REMAINING CONSIDERATIONS

### Potential Issues (Not Bugs)

| # | Scenario | Current Behavior | Recommendation |
|---|----------|------------------|----------------|
| 1 | **Jatha overlap** | Blocks all scans | Correct behavior |
| 2 | **Multiple centres** | ASO can scan at any centre | Correct |
| 3 | **Late night scans** | Triggers Watch & Ward prompt | Correct |
| 4 | **Timezone handling** | All times in IST | Correct |

---

## 🧪 TEST CASES TO VERIFY

### Test 1: Negative Duration Prevention
1. Create a session with IN at 10:00 AM
2. Try to scan OUT at 9:00 AM (before IN)
3. **Expected:** Error message "OUT time cannot be before IN time"
4. **Status:** ✅ Fixed

### Test 2: Duplicate Scan Blocking
1. Scan a badge successfully
2. Scan the same badge again within 3 seconds
3. **Expected:** Second scan blocked, no popup
4. **Status:** ✅ Fixed

### Test 3: Max Duration Check
1. Create a session with IN at 10:00 AM
2. Wait (or manually set) OUT at 11:00 AM next day
3. **Expected:** Error "Session duration exceeds 24 hours"
4. **Status:** ✅ Fixed

### Test 4: Watch & Ward Duty Type
1. Scan IN at 10:00 PM (late night)
2. Confirm Watch & Ward
3. Scan OUT next day at 8:00 AM
4. **Expected:** Duty type should be WATCH_WARD
5. **Status:** ✅ Already working

### Test 5: Jatha Block
1. Register a sewadar for active jatha
2. Try to scan them during jatha dates
3. **Expected:** Blocked with jatha message
4. **Status:** ✅ Already working

---

## 📁 FILES MODIFIED

| File | Changes |
|------|---------|
| `src/lib/sessionLogic.js` | Added duration validation, duplicate detection flag |
| `src/pages/ScannerPage.jsx` | Added duplicate scan detection refs |

---

## 🚀 FUTURE IMPROVEMENTS

1. **Race Condition Prevention:** Add database-level locking for session creation
2. **Audit Trail:** Log all scan attempts (successful and blocked)
3. **Analytics:** Track patterns in scan failures
4. **Manual Override UI:** Improve ASO manual entry flow

