export default function SkeletonRows({ rows = 10, cols = 5 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr
          key={i}
          style={{
            animation: `skeletonFade ${0.6 + i * 0.05}s ease-in-out infinite alternate`,
            animationDelay: `${i * 0.08}s`,
          }}
        >
          {Array.from({ length: cols }).map((_, j) => (
            <td
              key={j}
              style={{
                padding: '0.65rem 0.5rem',
              }}
            >
              <div
                style={{
                  height: j === 0 ? 14 : 12,
                  width: j === 0 ? '60%' : j === 1 ? '40%' : `${35 + Math.random() * 30}%`,
                  background: 'var(--bg)',
                  borderRadius: 4,
                }}
              />
            </td>
          ))}
        </tr>
      ))}
      <style>{`
        @keyframes skeletonFade {
          from { opacity: 0.4; }
          to { opacity: 0.9; }
        }
      `}</style>
    </>
  )
}
