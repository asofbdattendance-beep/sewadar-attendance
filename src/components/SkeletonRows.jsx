export default function SkeletonRows({ rows = 10, cols = 5 }) {
  return (
    <div style={{ width: '100%' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border)',
            animation: `skeletonFade ${0.6 + (i * 0.05)}s ease-in-out infinite alternate`,
            animationDelay: `${i * 0.08}s`,
          }}
        >
          {Array.from({ length: cols }).map((_, j) => (
            <div
              key={j}
              style={{
                height: j === 0 ? 14 : 12,
                width: j === 0 ? '60%' : j === 1 ? '40%' : `${35 + Math.random() * 30}%`,
                background: 'var(--bg)',
                borderRadius: 4,
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      ))}
      <style>{`
        @keyframes skeletonFade {
          from { opacity: 0.4; }
          to { opacity: 0.9; }
        }
      `}</style>
    </div>
  )
}
