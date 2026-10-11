import { BoardCard } from './BoardCard'
import { STATUS_OPTIONS, type Article } from './types'
import { IN_PROGRESS_FILTER, IN_PROGRESS_STATUSES } from '../../../shared/model'

interface BoardViewProps {
  articlesByStatus: Record<string, Article[]>
  statusFilter?: string
}

// One column per real status; with a status filter, only the matching columns
function boardColumns(statusFilter?: string) {
  const statuses = STATUS_OPTIONS.filter((s) => s.value && s.value !== IN_PROGRESS_FILTER)
  if (!statusFilter) return statuses
  if (statusFilter === IN_PROGRESS_FILTER)
    return statuses.filter((s) => (IN_PROGRESS_STATUSES as readonly string[]).includes(s.value))
  return statuses.filter((s) => s.value === statusFilter)
}

export function BoardView({ articlesByStatus, statusFilter }: BoardViewProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {boardColumns(statusFilter).map((statusOpt) => {
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
