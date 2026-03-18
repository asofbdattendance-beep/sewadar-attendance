export default function EmptyState({
  icon: Icon,
  title = 'Nothing here',
  message,
  action,
  actionLabel,
  searchTerm,
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '3rem 1.5rem',
      textAlign: 'center',
    }}>
      {Icon && (
        <div style={{
          width: 56,
          height: 56,
          background: 'var(--bg)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1rem',
          opacity: 0.5,
        }}>
          <Icon size={26} color="var(--text-muted)" />
        </div>
      )}

      <h3 style={{
        fontSize: '0.95rem',
        fontWeight: 700,
        color: 'var(--text-primary)',
        marginBottom: '0.4rem',
      }}>
        {title}
      </h3>

      <p style={{
        fontSize: '0.82rem',
        color: 'var(--text-muted)',
        maxWidth: 280,
        lineHeight: 1.5,
      }}>
        {message}
      </p>

      {searchTerm && (
        <div style={{
          marginTop: '0.75rem',
          padding: '0.35rem 0.75rem',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 999,
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}>
          Searching for: <strong style={{ color: 'var(--text-secondary)' }}>"{searchTerm}"</strong>
        </div>
      )}

      {action && (
        <button
          onClick={action}
          style={{
            marginTop: '1rem',
            padding: '0.55rem 1.25rem',
            background: 'var(--excel-green)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius)',
            fontSize: '0.82rem',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {actionLabel || 'Try Again'}
        </button>
      )}
    </div>
  )
}
