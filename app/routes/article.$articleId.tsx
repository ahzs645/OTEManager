import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { useState } from 'react'
import {
  ArrowLeft,
  FileText,
  Mail,
  DollarSign,
  EyeOff,
  ChevronDown,
} from 'lucide-react'
import {
  StatusBadge,
  TierBadge,
  formatDate,
  Section,
  Avatar,
  LoadingSpinner,
} from '~/components/Layout'
import { updateArticleStatus } from '~/lib/mutations'
import {
  PaymentSection,
  VolumeIssueEditor,
  NotesSection,
  PhotoGallery,
  ContentEditor,
  FeedbackEditor,
  DocumentList,
  StatusHistory,
} from '~/components/article'

// Server function to fetch article data
const fetchArticleData = createServerFn({ method: 'GET' })
  .validator((articleId: string) => {
    if (!articleId || typeof articleId !== 'string') {
      throw new Error('Article ID is required')
    }
    return articleId
  })
  .handler(async ({ data: articleId }) => {
    if (!articleId) {
      return { article: null, volumes: [] }
    }

    const { db, articles } = await import('@db/index')
    const { eq } = await import('drizzle-orm')

    const article = await db.query.articles.findFirst({
      where: eq(articles.id, articleId),
      with: {
        author: true,
        attachments: true,
        multimediaTypes: true,
        publicationIssue: {
          with: {
            volume: true,
          },
        },
        notes: {
          orderBy: (notes: any, { desc }: any) => [desc(notes.createdAt)],
        },
        statusHistory: {
          orderBy: (history: any, { desc }: any) => [desc(history.changedAt)],
        },
      },
    })

    const volumes = await db.query.volumes.findMany({
      with: {
        issues: {
          orderBy: (issues: any, { asc }: any) => [asc(issues.issueNumber)],
        },
      },
      orderBy: (volumes: any, { desc }: any) => [desc(volumes.volumeNumber)],
    })

    return { article, volumes }
  })

export const Route = createFileRoute('/article/$articleId')({
  component: ArticleDetailPage,
  loader: ({ params }) => {
    if (!params.articleId) {
      return { article: null, volumes: [] }
    }
    return fetchArticleData({ data: params.articleId })
  },
})

const STATUS_OPTIONS = [
  'Draft',
  'Pending Review',
  'In Review',
  'Needs Revision',
  'Approved',
  'In Editing',
  'Ready for Publication',
  'Published',
  'Archived',
]

function ArticleDetailPage() {
  const { article, volumes } = Route.useLoaderData()
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [content, setContent] = useState(article?.content || '')
  const [feedbackContent, setFeedbackContent] = useState(article?.feedbackLetter || '')

  if (!article) {
    return (
      <div className="empty-state" style={{ minHeight: '400px' }}>
        <FileText className="empty-state-icon" />
        <h2 className="empty-state-title">Article not found</h2>
        <p className="empty-state-description">
          This article may have been deleted or moved.
        </p>
        <Link to="/articles" className="btn btn-secondary mt-4">
          <ArrowLeft className="w-4 h-4" />
          Back to articles
        </Link>
      </div>
    )
  }

  const handleStatusChange = async (newStatus: string) => {
    setIsUpdatingStatus(true)
    try {
      await updateArticleStatus({
        data: {
          articleId: article.id,
          status: newStatus,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to update status:', error)
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  const handleConvertToMarkdown = (convertedContent: string) => {
    setContent(convertedContent)
  }

  const authorName = article.author
    ? `${article.author.givenName} ${article.author.surname}`
    : 'Unknown'

  const documents = article.attachments.filter((a: any) => a.attachmentType === 'word_document')
  const photos = article.attachments.filter((a: any) => a.attachmentType === 'photo')

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <Link
        to="/articles"
        className="inline-flex items-center gap-1.5 text-sm"
        style={{ color: 'var(--fg-muted)' }}
      >
        <ArrowLeft className="w-4 h-4" />
        Articles
      </Link>

      {/* Header */}
      <div
        className="p-4 rounded-lg"
        style={{
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border-default)',
        }}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <h1
                className="text-lg font-semibold truncate"
                style={{ color: 'var(--fg-default)', letterSpacing: '-0.02em' }}
              >
                {article.title}
              </h1>
              {article.prefersAnonymity && (
                <span
                  className="badge badge-default flex items-center gap-1"
                  title="Author prefers anonymity"
                >
                  <EyeOff className="w-3 h-3" />
                  Anonymous
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={article.internalStatus} />
              <TierBadge tier={article.articleTier} />
              <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                Submitted {formatDate(article.submittedAt || article.createdAt)}
              </span>
            </div>
          </div>

          {/* Status Selector */}
          <div className="relative">
            <select
              value={article.internalStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={isUpdatingStatus}
              className="select-trigger pr-8"
              style={{ minWidth: '140px' }}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <ChevronDown
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
              style={{ color: 'var(--fg-faint)' }}
            />
            {isUpdatingStatus && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-md">
                <LoadingSpinner size="sm" />
              </div>
            )}
          </div>
        </div>

        {/* Publication - inline in header */}
        <div
          className="pt-3"
          style={{ borderTop: '0.5px solid var(--border-subtle)' }}
        >
          <VolumeIssueEditor
            articleId={article.id}
            volumes={volumes}
            currentIssueId={article.issueId}
            currentIssue={article.publicationIssue}
            variant="inline"
          />
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Documents */}
          <DocumentList
            documents={documents}
            articleId={article.id}
            onConvertToMarkdown={handleConvertToMarkdown}
            onConvertToFeedback={setFeedbackContent}
          />

          {/* Photos */}
          <PhotoGallery photos={photos} articleId={article.id} />

          {/* Article Content */}
          <ContentEditor
            articleId={article.id}
            initialContent={content}
          />

          {/* Feedback Letter */}
          <FeedbackEditor
            articleId={article.id}
            initialContent={feedbackContent}
          />

          {/* Notes */}
          <NotesSection
            articleId={article.id}
            notes={article.notes}
          />

          {/* Status History */}
          <StatusHistory history={article.statusHistory} />
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Author Info */}
          <Section title="Author">
            {article.author ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Avatar name={authorName} />
                  <div>
                    <p
                      className="text-sm font-medium"
                      style={{ color: 'var(--fg-default)' }}
                    >
                      {authorName}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                      {article.author.role}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Mail
                      className="w-4 h-4"
                      style={{ color: 'var(--fg-faint)' }}
                    />
                    <a
                      href={`mailto:${article.author.email}`}
                      className="text-sm"
                      style={{ color: 'var(--accent)' }}
                    >
                      {article.author.email}
                    </a>
                  </div>

                  {article.author.autoDepositAvailable && (
                    <div className="flex items-center gap-2">
                      <DollarSign
                        className="w-4 h-4"
                        style={{ color: 'var(--status-success)' }}
                      />
                      <span
                        className="text-sm"
                        style={{ color: 'var(--fg-muted)' }}
                      >
                        Auto-deposit enabled
                      </span>
                    </div>
                  )}
                </div>

                <Link
                  to="/articles"
                  search={{ authorId: article.author.id }}
                  className="text-xs"
                  style={{ color: 'var(--accent)' }}
                >
                  View all articles by this author →
                </Link>
              </div>
            ) : (
              <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                Author information not available
              </p>
            )}
          </Section>

          {/* Details */}
          <Section title="Details">
            <div className="space-y-3">
              <DetailRow
                label="Submitted"
                value={formatDate(article.submittedAt || article.createdAt)}
              />
              <DetailRow
                label="Last Updated"
                value={formatDate(article.updatedAt)}
              />
              {article.multimediaTypes.length > 0 && (
                <DetailRow
                  label="Multimedia"
                  value={
                    <div className="flex flex-wrap gap-1">
                      {article.multimediaTypes.map((m: any) => (
                        <span key={m.id} className="badge badge-default">
                          {m.multimediaType}
                        </span>
                      ))}
                    </div>
                  }
                />
              )}
            </div>
          </Section>

          {/* Payment */}
          <Section title="Payment">
            <PaymentSection article={article} />
          </Section>
        </div>
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm" style={{ color: 'var(--fg-muted)' }}>
        {label}
      </span>
      {typeof value === 'string' ? (
        <span className="text-sm" style={{ color: 'var(--fg-default)' }}>
          {value}
        </span>
      ) : (
        value
      )}
    </div>
  )
}
