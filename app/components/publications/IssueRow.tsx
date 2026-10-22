import { Link } from '@tanstack/react-router'
import { FileText, Calendar, Download, Pencil, Trash2 } from 'lucide-react'
import type { Issue } from './types'

interface IssueRowProps {
  issue: Issue
  volumeNumber: number
  onEdit: () => void
  onDelete: () => void
  onExport: () => void
  onDesignCraftExport: () => void
  isExporting: boolean
}

export function IssueRow({
  issue,
  volumeNumber,
  onEdit,
  onDelete,
  onExport,
  onDesignCraftExport,
  isExporting,
}: IssueRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0.625rem 1rem',
        paddingLeft: '2.5rem',
      }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <span style={{ fontWeight: 500, color: 'var(--fg-default)' }}>
          Issue {issue.issueNumber}
        </span>
        {issue.title && (
          <span style={{ color: 'var(--fg-muted)' }}>
            {issue.title}
          </span>
        )}
        {issue.releaseDate && (
          <span style={{ fontSize: '0.75rem', color: 'var(--fg-faint)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Calendar className="w-3 h-3" />
            {/* Release dates are stored as UTC midnight; formatting in local time shows the day before */}
            {new Date(issue.releaseDate).toLocaleDateString('en-US', {
              timeZone: 'UTC',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        )}
        {issue.sourceProvenance && <Link to="/utilities/source-archive" className="badge badge-default" style={{ textDecoration: 'none' }}>Source archive</Link>}
        {issue.sourceProvenance && !issue.releaseDate && <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>Release date not verified</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <Link
          to="/articles"
          search={{ issueId: issue.id }}
          style={{
            fontSize: '0.75rem',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
            textDecoration: 'none',
          }}
        >
          <FileText className="w-3 h-3" />
          {issue.articleCount} article{issue.articleCount !== 1 ? 's' : ''}
        </Link>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onDesignCraftExport}
            disabled={isExporting || issue.articleCount === 0}
            title={issue.articleCount === 0 ? 'No articles to export' : 'Choose articles and images for DesignCraft web'}
            style={{ fontSize: '0.75rem', color: 'var(--accent)' }}
          >
            DesignCraft ZIP
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onExport}
            disabled={isExporting || issue.articleCount === 0}
            title={issue.articleCount === 0 ? 'No articles to export' : 'Choose photos and export issue as ZIP'}
            style={{ color: issue.articleCount === 0 ? 'var(--fg-faint)' : 'var(--accent)' }}
          >
            {isExporting ? (
              <span style={{ fontSize: '0.625rem' }}>...</span>
            ) : (
              <Download className="w-3 h-3" />
            )}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onEdit}
            title="Edit"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onDelete}
            title="Delete"
            style={{ color: 'var(--status-error)' }}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
