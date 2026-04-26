export default function JathaReportsPage() {
  return (
    <div className="page pb-nav">
      <div className="header">
        <h2>Jatha Reports</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Jatha reports are now available in the Records page
        </p>
      </div>
      <div className="empty-state" style={{ marginTop: '3rem' }}>
        <p>Use the <strong>Records</strong> tab and select <strong>Jatha Records</strong> to view jatha attendance.</p>
      </div>
    </div>
  )
}
