import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function TablePagination({
  page = 1,
  pageSize = 50,
  total = 0,
  onPageChange,
  showPageCount = true,
}) {
  if (total === 0) return null

  const totalPages = Math.ceil(total / pageSize)
  const start = Math.min((page - 1) * pageSize + 1, total)
  const end = Math.min(page * pageSize, total)

  const visiblePages = () => {
    const pages = []
    const delta = 2
    const left = Math.max(2, page - delta)
    const right = Math.min(totalPages - 1, page + delta)

    pages.push(1)
    if (left > 2) pages.push('...')
    for (let i = left; i <= right; i++) pages.push(i)
    if (right < totalPages - 1) pages.push('...')
    if (totalPages > 1) pages.push(totalPages)
    return pages
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0.6rem 0',
      flexWrap: 'wrap',
      gap: '0.5rem',
    }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500 }}>
        {total === 0 ? 'No results' : `Showing ${start}–${end} of ${total.toLocaleString()} results`}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 6,
              border: '1.5px solid var(--border)',
              background: page <= 1 ? 'var(--bg)' : 'white',
              color: page <= 1 ? 'var(--border)' : 'var(--text-secondary)',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              fontSize: '0.8rem',
              fontFamily: 'inherit',
            }}
          >
            <ChevronLeft size={15} />
          </button>

          {visiblePages().map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} style={{ color: 'var(--text-muted)', padding: '0 0.25rem', fontSize: '0.82rem' }}>…</span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                style={{
                  minWidth: 32,
                  height: 32,
                  borderRadius: 6,
                  border: page === p ? 'none' : '1.5px solid var(--border)',
                  background: page === p ? 'var(--excel-green)' : 'white',
                  color: page === p ? 'white' : 'var(--text-secondary)',
                  fontWeight: page === p ? 700 : 500,
                  fontSize: '0.82rem',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  padding: '0 0.3rem',
                }}
              >
                {p}
              </button>
            )
          )}

          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 6,
              border: '1.5px solid var(--border)',
              background: page >= totalPages ? 'var(--bg)' : 'white',
              color: page >= totalPages ? 'var(--border)' : 'var(--text-secondary)',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              fontSize: '0.8rem',
              fontFamily: 'inherit',
            }}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
