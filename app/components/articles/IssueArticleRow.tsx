import { Link } from '@tanstack/react-router'
import { DollarSign } from 'lucide-react'
import { StatusBadge, TierBadge, formatDate } from '~/components/Layout'
import type { Article } from './types'

interface IssueArticleRowProps {
  article: Article
  isLast: boolean
}

export function IssueArticleRow({ article, isLast }: IssueArticleRowProps) {
  const authorName = article.author
    ? `${article.author.givenName} ${article.author.surname}`
    : 'Unknown'

  return (
    <Link
      to="/article/$articleId"
      params={{ articleId: article.id }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1rem',
        borderBottom: isLast ? 'none' : '0.5px solid var(--border-subtle)',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-subtle)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: '0.875rem',
            fontWeight: 500,
            color: 'var(--fg-default)',
            margin: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {article.title}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
            {authorName}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--fg-faint)' }}>·</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
            {formatDate(article.submittedAt || article.createdAt)}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <StatusBadge status={article.internalStatus} />
        <TierBadge tier={article.articleTier} />
        {article.paymentStatus && (
          <DollarSign className="w-4 h-4" style={{ color: 'var(--status-success)' }} />
        )}
      </div>
    </Link>
  )
}
