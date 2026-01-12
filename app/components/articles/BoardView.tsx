import { BoardCard } from './BoardCard'
import { STATUS_OPTIONS, type Article } from './types'

interface BoardViewProps {
  articlesByStatus: Record<string, Article[]>
}

export function BoardView({ articlesByStatus }: BoardViewProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {STATUS_OPTIONS.filter((s) => s.value).map((statusOpt) => {
        const statusArticles = articlesByStatus[statusOpt.value] || []
        return (
          <div
            key={statusOpt.value}
            className="flex-shrink-0 w-72 rounded-lg"
            style={{
              background: 'var(--bg-surface)',
              border: '0.5px solid var(--border-default)',
            }}
          >
            <div
              className="px-3 py-2 flex items-center justify-between"
              style={{ borderBottom: '0.5px solid var(--border-subtle)' }}
            >
              <span className="text-sm font-medium" style={{ color: 'var(--fg-default)' }}>
                {statusOpt.label}
              </span>
              <span
                className="text-xs px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--bg-subtle)', color: 'var(--fg-muted)' }}
              >
                {statusArticles.length}
              </span>
            </div>
            <div className="p-2 space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
              {statusArticles.length === 0 ? (
                <p className="text-xs text-center py-4" style={{ color: 'var(--fg-faint)' }}>
                  No articles
                </p>
              ) : (
                statusArticles.map((article) => (
                  <BoardCard key={article.id} article={article} />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
