import { BookOpen } from 'lucide-react'
import { IssueArticleRow } from './IssueArticleRow'
import type { Article } from './types'

type IssueData = {
  articles: Article[]
  volumeNumber?: number
  issueNumber?: number
}

interface IssueViewProps {
  articlesByIssue: Record<string, IssueData>
  sortedIssueKeys: string[]
}

export function IssueView({ articlesByIssue, sortedIssueKeys }: IssueViewProps) {
  const formatIssueLabel = (key: string) => {
    if (key === 'unassigned') return 'Unassigned'
    const data = articlesByIssue[key]
    if (data.volumeNumber && data.issueNumber) {
      return `Volume ${data.volumeNumber} · Issue ${data.issueNumber}`
    }
    if (data.volumeNumber) {
      return `Volume ${data.volumeNumber}`
    }
    return key
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {sortedIssueKeys.map((issueKey) => {
        const issueData = articlesByIssue[issueKey]
        return (
          <div key={issueKey}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <BookOpen className="w-4 h-4" style={{ color: 'var(--fg-muted)' }} />
              <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--fg-default)', margin: 0 }}>
                {formatIssueLabel(issueKey)}
              </h2>
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '9999px',
                  background: 'var(--bg-subtle)',
                  color: 'var(--fg-muted)',
                }}
              >
                {issueData.articles.length}
              </span>
            </div>
            <div
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-default)',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              {issueData.articles.map((article, index) => (
                <IssueArticleRow
                  key={article.id}
                  article={article}
                  isLast={index === issueData.articles.length - 1}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
