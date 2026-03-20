import { useMemo } from 'react'

const WIDTHS = [
  ['60%', '40%', '55%', '35%', '45%'],
  ['55%', '35%', '50%', '40%', '60%'],
  ['65%', '45%', '55%', '30%', '50%'],
  ['50%', '40%', '60%', '45%', '55%'],
  ['60%', '35%', '45%', '50%', '40%'],
]

export default function SkeletonRows({ rows = 10, cols = 5 }) {
  const rowWidths = useMemo(() =>
    Array.from({ length: rows }, (_, i) =>
      Array.from({ length: cols }, (_, j) => WIDTHS[i % WIDTHS.length][j % cols])
    ), [rows, cols])

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
            <td key={j} style={{ padding: '0.65rem 0.5rem' }}>
              <div
                style={{
                  height: j === 0 ? 14 : 12,
                  width: rowWidths[i][j],
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
