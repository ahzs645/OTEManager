import { Link } from '@tanstack/react-router'
import { Paperclip, Image, EyeOff, DollarSign } from 'lucide-react'
import { StatusBadge, TierBadge, formatDate, Avatar } from '~/components/Layout'
import type { Article } from './types'

interface ArticleRowProps {
  article: Article
}

export function ArticleRow({ article }: ArticleRowProps) {
  const authorName = article.author
    ? `${article.author.givenName} ${article.author.surname}`
    : 'Unknown'

  return (
    <Link
      to="/article/$articleId"
      params={{ articleId: article.id }}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 140px 70px 100px 100px 80px 60px',
        gap: '1rem',
        padding: '0.75rem 1rem',
        alignItems: 'center',
        borderBottom: '0.5px solid var(--border-subtle)',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-subtle)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Title */}
      <div className="min-w-0">
        <span
          className="text-sm font-medium truncate block"
          style={{ color: 'var(--fg-default)' }}
        >
          {article.title}
        </span>
      </div>

      {/* Author */}
      <div className="flex items-center gap-2 min-w-0">
        <Avatar name={authorName} size="sm" />
        <div className="min-w-0">
          <span
            className="text-sm truncate block"
            style={{ color: 'var(--fg-default)' }}
          >
            {authorName}
          </span>
        </div>
      </div>

      {/* Volume/Issue */}
      <div>
        {article.volume || article.issue ? (
          <span
            className="text-xs tabular-nums px-1.5 py-0.5 rounded"
            style={{
              background: 'var(--bg-subtle)',
              color: 'var(--fg-muted)',
            }}
          >
            {article.volume && `V${article.volume}`}
            {article.volume && article.issue && '/'}
            {article.issue && `#${article.issue}`}
          </span>
        ) : (
          <span className="text-xs" style={{ color: 'var(--fg-faint)' }}>—</span>
        )}
      </div>

      {/* Status */}
      <div>
        <StatusBadge status={article.internalStatus} />
      </div>

      {/* Date */}
      <div>
        <span
          className="text-xs tabular-nums"
          style={{ color: 'var(--fg-muted)' }}
        >
          {formatDate(article.submittedAt || article.createdAt)}
        </span>
      </div>

      {/* Tier */}
      <div>
        <TierBadge tier={article.articleTier} />
      </div>

      {/* Info Icons */}
      <div className="flex items-center justify-end gap-1">
        {article.attachments?.length > 0 && (
          <span
            style={{ color: 'var(--fg-faint)' }}
            title={`${article.attachments.length} attachments`}
          >
            <Paperclip className="w-3.5 h-3.5" />
          </span>
        )}
        {article.multimediaTypes?.length > 0 && (
          <span
            style={{ color: 'var(--fg-faint)' }}
            title={`Multimedia: ${article.multimediaTypes.map((m) => m.multimediaType).join(', ')}`}
          >
            <Image className="w-3.5 h-3.5" />
          </span>
        )}
        {article.prefersAnonymity && (
          <span style={{ color: 'var(--fg-faint)' }} title="Prefers anonymity">
            <EyeOff className="w-3.5 h-3.5" />
          </span>
        )}
        {article.paymentStatus && (
          <span style={{ color: 'var(--status-success)' }} title="Paid">
            <DollarSign className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    </Link>
  )
}
