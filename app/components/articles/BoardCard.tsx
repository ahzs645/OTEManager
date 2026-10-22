import { Link } from '@tanstack/react-router'
import { TierBadge, formatDate, Avatar } from '~/components/Layout'
import type { Article } from './types'
import { articleDisplayAuthor, articleDisplaySubmitted, readSourceProvenance, sourceRecoveryLabel } from '~/lib/source-archive-display'

interface BoardCardProps {
  article: Article
}

export function BoardCard({ article }: BoardCardProps) {
  const authorName = articleDisplayAuthor(article)
  const source = readSourceProvenance(article.sourceProvenance)

  return (
    <Link
      to="/article/$articleId"
      params={{ articleId: article.id }}
      className="block p-3 rounded-md transition-colors"
      style={{
        background: 'var(--bg-default)',
        border: '0.5px solid var(--border-subtle)',
      }}
    >
      <p
        className="text-sm font-medium line-clamp-2 mb-2"
        style={{ color: 'var(--fg-default)' }}
      >
        {article.title}
      </p>
      {source && <p className="text-xs mb-2" style={{ color: 'var(--fg-muted)' }}>{sourceRecoveryLabel(source.recoveryStatus)}</p>}
      <div className="flex items-center gap-2 mb-2">
        <Avatar name={authorName} size="sm" />
        <span className="text-xs truncate" style={{ color: 'var(--fg-muted)' }}>
          {authorName}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <TierBadge tier={article.articleTier} />
        <span className="text-xs" style={{ color: 'var(--fg-faint)' }}>
          {formatDate(articleDisplaySubmitted(article))}
        </span>
      </div>
    </Link>
  )
}
