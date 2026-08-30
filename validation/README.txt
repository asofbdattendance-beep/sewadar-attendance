USAGE
  node validation/validate-sewadars.mjs /path/to/your-dump.xlsx
  (no path = reads validation/Input.xlsx)

OUTPUT
  validation/validation-report.xlsx  - report (In database / Not in database /
                                       In DB not in sheet / In DB but filtered /
                                       Changed fields / Transfers)
  validation/validation-report.sql   - generated SQL (review, never auto-run)

KEEP-LIST
  validation/keep-badges.txt - badges to never delete/merge (one per line)