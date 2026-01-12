import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ArticleRow } from './ArticleRow'
import { SortableHeader } from './SortableHeader'
import type { Article, SortField, SortOrder } from './types'

interface ListViewProps {
  articles: Article[]
  total: number
  page: number
  totalPages: number
  sortBy?: SortField
  sortOrder: SortOrder
  onSort: (field: SortField) => void
  onPageChange: (page: number) => void
}

export function ListView({
  articles,
  total,
  page,
  totalPages,
  sortBy,
  sortOrder,
  onSort,
  onPageChange,
}: ListViewProps) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-default)',
      }}
    >
      {/* Table Header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 140px 70px 100px 100px 80px 60px',
          gap: '1rem',
          padding: '0.5rem 1rem',
          borderBottom: '0.5px solid var(--border-subtle)',
        }}
      >
        <SortableHeader field="title" label="Article" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        <SortableHeader field="author" label="Author" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        <SortableHeader field="volume" label="Vol/Issue" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        <SortableHeader field="status" label="Status" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        <SortableHeader field="submitted" label="Submitted" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        <SortableHeader field="tier" label="Tier" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        <span className="table-header text-right">Info</span>
      </div>

      {/* Table Body */}
      <div>
        {articles.map((article) => (
          <ArticleRow key={article.id} article={article} />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderTop: '0.5px solid var(--border-subtle)' }}
        >
          <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
            {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="btn btn-ghost !p-1.5 disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span
              className="text-xs px-2 tabular-nums"
              style={{ color: 'var(--fg-muted)' }}
            >
              {page} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="btn btn-ghost !p-1.5 disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
