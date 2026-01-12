import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { useState } from 'react'
import {
  ArrowLeft,
  FileText,
  Download,
  Mail,
  User,
  Calendar,
  DollarSign,
  EyeOff,
  Image,
  Clock,
  Check,
  X,
  ChevronDown,
  Send,
  Plus,
  Wand2,
  Save,
  Star,
  RefreshCw,
  Calculator,
} from 'lucide-react'
import {
  StatusBadge,
  TierBadge,
  formatDate,
  Section,
  Avatar,
  Button,
  LoadingSpinner,
} from '~/components/Layout'
import { updateArticleStatus, addArticleNote, updateArticleContent, updateArticle, calculateArticlePayment, setManualPayment, toggleArticleFeatured } from '~/lib/mutations'
import { formatCents, type PaymentCalculation } from '~/lib/payment-calculator'

// Server function to fetch article data - ensures db code only runs on server
const fetchArticleData = createServerFn({ method: 'GET' })
  .validator((articleId: string) => articleId)
  .handler(async ({ data: articleId }) => {
    // Guard against undefined articleId (can happen during hot reload)
    if (!articleId) {
      return { article: null }
    }

    const { db, articles } = await import('@db/index')
    const { eq } = await import('drizzle-orm')

    const article = await db.query.articles.findFirst({
      where: eq(articles.id, articleId),
      with: {
        author: true,
        attachments: true,
        multimediaTypes: true,
        notes: {
          orderBy: (notes: any, { desc }: any) => [desc(notes.createdAt)],
        },
        statusHistory: {
          orderBy: (history: any, { desc }: any) => [desc(history.changedAt)],
        },
      },
    })

    return { article }
  })

export const Route = createFileRoute('/article/$articleId')({
  component: ArticleDetailPage,
  loader: ({ params }) => fetchArticleData(params.articleId),
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
  const { article } = Route.useLoaderData()
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [isAddingNote, setIsAddingNote] = useState(false)
  const [content, setContent] = useState(article?.content || '')
  const [isSavingContent, setIsSavingContent] = useState(false)
  const [isConverting, setIsConverting] = useState<string | null>(null)
  const [contentSaved, setContentSaved] = useState(true)

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
        articleId: article.id,
        status: newStatus,
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to update status:', error)
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  const handleAddNote = async () => {
    if (!newNote.trim()) return
    setIsAddingNote(true)
    try {
      await addArticleNote({
        articleId: article.id,
        content: newNote,
      })
      setNewNote('')
      window.location.reload()
    } catch (error) {
      console.error('Failed to add note:', error)
    } finally {
      setIsAddingNote(false)
    }
  }

  const handleSaveContent = async () => {
    setIsSavingContent(true)
    try {
      await updateArticleContent({
        articleId: article.id,
        content: content,
      })
      setContentSaved(true)
    } catch (error) {
      console.error('Failed to save content:', error)
    } finally {
      setIsSavingContent(false)
    }
  }

  const handleConvertFromWord = async (attachmentId: string) => {
    setIsConverting(attachmentId)
    try {
      // Dynamically import to avoid bundling mammoth in client
      const { convertDocxToMarkdown } = await import('~/lib/server-mutations')
      const result = await convertDocxToMarkdown({
        articleId: article.id,
        attachmentId: attachmentId,
      })
      if (result.success && result.content) {
        setContent(result.content)
        setContentSaved(true)
      } else {
        console.error('Conversion failed:', result.error)
        alert('Failed to convert document: ' + (result.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to convert document:', error)
      alert('Failed to convert document')
    } finally {
      setIsConverting(null)
    }
  }

  const handleContentChange = (newContent: string) => {
    setContent(newContent)
    setContentSaved(false)
  }

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const charCount = content.length

  const authorName = article.author
    ? `${article.author.givenName} ${article.author.surname}`
    : 'Unknown'

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
        <div className="flex items-start justify-between gap-4">
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
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Attachments */}
          <Section
            title={`Attachments (${article.attachments.length})`}
            noPadding
          >
            {article.attachments.length === 0 ? (
              <div className="empty-state py-8">
                <FileText
                  className="w-8 h-8 mb-2"
                  style={{ color: 'var(--fg-faint)' }}
                />
                <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                  No attachments
                </p>
              </div>
            ) : (
              <div>
                {article.attachments.map((attachment: any, index: number) => (
                  <div
                    key={attachment.id}
                    className="flex items-center justify-between px-4 py-3"
                    style={{
                      borderBottom:
                        index < article.attachments.length - 1
                          ? '0.5px solid var(--border-subtle)'
                          : 'none',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="icon-container">
                        {attachment.attachmentType === 'photo' ? (
                          <Image className="w-4 h-4" />
                        ) : (
                          <FileText className="w-4 h-4" />
                        )}
                      </div>
                      <div>
                        <p
                          className="text-sm font-medium"
                          style={{ color: 'var(--fg-default)' }}
                        >
                          {attachment.originalFileName}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: 'var(--fg-muted)' }}
                        >
                          {attachment.attachmentType}
                          {attachment.fileSize && (
                            <> · {(attachment.fileSize / 1024).toFixed(1)} KB</>
                          )}
                        </p>
                        {attachment.caption && (
                          <p
                            className="text-xs mt-1 italic"
                            style={{ color: 'var(--fg-muted)' }}
                          >
                            {attachment.caption}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {attachment.attachmentType === 'word_document' && (
                        <button
                          onClick={() => handleConvertFromWord(attachment.id)}
                          disabled={isConverting === attachment.id}
                          className="btn btn-ghost !p-2"
                          title="Convert to Markdown"
                        >
                          {isConverting === attachment.id ? (
                            <LoadingSpinner size="sm" />
                          ) : (
                            <Wand2 className="w-4 h-4" />
                          )}
                        </button>
                      )}
                      <a
                        href={`/api/files/${attachment.filePath}`}
                        download={attachment.originalFileName}
                        className="btn btn-ghost !p-2"
                        title="Download"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Article Content */}
          <Section
            title="Article Content"
            action={
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                  {wordCount} words · {charCount} chars
                </span>
                <Button
                  onClick={handleSaveContent}
                  disabled={isSavingContent || contentSaved}
                  variant={contentSaved ? 'secondary' : 'primary'}
                  size="sm"
                >
                  {isSavingContent ? (
                    <LoadingSpinner size="sm" />
                  ) : contentSaved ? (
                    <>
                      <Check className="w-3 h-3" />
                      Saved
                    </>
                  ) : (
                    <>
                      <Save className="w-3 h-3" />
                      Save
                    </>
                  )}
                </Button>
              </div>
            }
          >
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="Paste or type article content here in markdown format..."
              className="w-full min-h-[400px] p-3 text-sm font-mono resize-y"
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-default)',
                borderRadius: '6px',
                color: 'var(--fg-default)',
                lineHeight: '1.6',
              }}
            />
          </Section>

          {/* Notes */}
          <Section title="Editorial Notes" noPadding>
            <div className="px-4 py-3">
              {article.notes.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                  No notes yet
                </p>
              ) : (
                <div className="space-y-3 mb-4">
                  {article.notes.map((note: any) => (
                    <div
                      key={note.id}
                      className="p-3 rounded-md"
                      style={{
                        background: 'var(--bg-subtle)',
                        borderLeft: '2px solid var(--accent)',
                      }}
                    >
                      <p
                        className="text-sm"
                        style={{ color: 'var(--fg-default)' }}
                      >
                        {note.content}
                      </p>
                      <p
                        className="text-xs mt-2"
                        style={{ color: 'var(--fg-muted)' }}
                      >
                        {note.createdBy || 'Unknown'} ·{' '}
                        {formatDate(note.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Note Form */}
              <div className="flex gap-2 mt-3">
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note..."
                  className="input flex-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleAddNote()
                    }
                  }}
                />
                <Button
                  onClick={handleAddNote}
                  disabled={isAddingNote || !newNote.trim()}
                  variant="primary"
                >
                  {isAddingNote ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </Section>

          {/* Status History */}
          <Section title="Status History" noPadding>
            {article.statusHistory.length === 0 ? (
              <div className="px-4 py-3">
                <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                  No status changes yet
                </p>
              </div>
            ) : (
              <div className="px-4 py-3">
                <div className="space-y-3">
                  {article.statusHistory.map((history: any, index: number) => (
                    <div key={history.id} className="flex items-start gap-3">
                      <div
                        className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: 'var(--fg-faint)' }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {history.fromStatus && (
                            <>
                              <StatusBadge status={history.fromStatus} />
                              <span style={{ color: 'var(--fg-faint)' }}>
                                →
                              </span>
                            </>
                          )}
                          <StatusBadge status={history.toStatus} />
                        </div>
                        <p
                          className="text-xs mt-1"
                          style={{ color: 'var(--fg-muted)' }}
                        >
                          {formatDate(history.changedAt)}
                          {history.changedBy && ` · ${history.changedBy}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>
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
              <DetailRow
                label="Tier"
                value={<TierBadge tier={article.articleTier} />}
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

          {/* Publication */}
          <Section title="Publication">
            <VolumeIssueEditor
              articleId={article.id}
              initialVolume={article.volume}
              initialIssue={article.issue}
            />
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

function VolumeIssueEditor({
  articleId,
  initialVolume,
  initialIssue,
}: {
  articleId: string
  initialVolume: number | null
  initialIssue: number | null
}) {
  const [volume, setVolume] = useState<string>(initialVolume?.toString() || '')
  const [issue, setIssue] = useState<string>(initialIssue?.toString() || '')
  const [isSaving, setIsSaving] = useState(false)
  const [initialVol] = useState(initialVolume?.toString() || '')
  const [initialIss] = useState(initialIssue?.toString() || '')

  const hasChanges = volume !== initialVol || issue !== initialIss

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateArticle({
        articleId,
        volume: volume ? parseInt(volume, 10) : null,
        issue: issue ? parseInt(issue, 10) : null,
      })
      // Reload to refresh data
      window.location.reload()
    } catch (error) {
      console.error('Failed to save volume/issue:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleVolumeChange = (value: string) => {
    // Only allow numbers
    if (value === '' || /^\d+$/.test(value)) {
      setVolume(value)
    }
  }

  const handleIssueChange = (value: string) => {
    // Only allow numbers
    if (value === '' || /^\d+$/.test(value)) {
      setIssue(value)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            className="block text-xs mb-1"
            style={{ color: 'var(--fg-muted)' }}
          >
            Volume
          </label>
          <input
            type="text"
            value={volume}
            onChange={(e) => handleVolumeChange(e.target.value)}
            placeholder="e.g., 12"
            className="input w-full tabular-nums"
            style={{ textAlign: 'center' }}
          />
        </div>
        <div>
          <label
            className="block text-xs mb-1"
            style={{ color: 'var(--fg-muted)' }}
          >
            Issue
          </label>
          <input
            type="text"
            value={issue}
            onChange={(e) => handleIssueChange(e.target.value)}
            placeholder="e.g., 3"
            className="input w-full tabular-nums"
            style={{ textAlign: 'center' }}
          />
        </div>
      </div>

      {hasChanges && (
        <Button
          onClick={handleSave}
          disabled={isSaving}
          variant="primary"
          size="sm"
          className="w-full"
        >
          {isSaving ? (
            <LoadingSpinner size="sm" />
          ) : (
            <>
              <Save className="w-3 h-3" />
              Save Changes
            </>
          )}
        </Button>
      )}

      {(volume || issue) && !hasChanges && (
        <p className="text-xs text-center" style={{ color: 'var(--fg-muted)' }}>
          {volume && `Volume ${volume}`}
          {volume && issue && ' · '}
          {issue && `Issue ${issue}`}
        </p>
      )}
    </div>
  )
}

// Payment Section Component with breakdown and controls
function PaymentSection({ article }: { article: any }) {
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [isTogglingFeatured, setIsTogglingFeatured] = useState(false)
  const [showManualInput, setShowManualInput] = useState(false)
  const [manualAmount, setManualAmount] = useState('')
  const [isSavingManual, setIsSavingManual] = useState(false)

  // Parse payment snapshot if available
  let breakdown: PaymentCalculation | null = null
  try {
    if (article.paymentRateSnapshot) {
      breakdown = JSON.parse(article.paymentRateSnapshot)
    }
  } catch {
    // Invalid JSON
  }

  const handleRecalculate = async () => {
    setIsRecalculating(true)
    try {
      await calculateArticlePayment({ articleId: article.id, recalculate: true })
      window.location.reload()
    } catch (error) {
      console.error('Failed to recalculate:', error)
    } finally {
      setIsRecalculating(false)
    }
  }

  const handleToggleFeatured = async () => {
    setIsTogglingFeatured(true)
    try {
      await toggleArticleFeatured({
        articleId: article.id,
        isFeatured: !article.isFeatured,
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to toggle featured:', error)
    } finally {
      setIsTogglingFeatured(false)
    }
  }

  const handleSaveManual = async () => {
    const amount = parseFloat(manualAmount)
    if (isNaN(amount) || amount < 0) return

    setIsSavingManual(true)
    try {
      await setManualPayment({
        articleId: article.id,
        amount: Math.round(amount * 100), // Convert to cents
      })
      setShowManualInput(false)
      window.location.reload()
    } catch (error) {
      console.error('Failed to set manual payment:', error)
    } finally {
      setIsSavingManual(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Payment Status */}
      <div className="flex items-center gap-3">
        {article.paymentStatus ? (
          <>
            <div
              className="icon-container"
              style={{ background: 'var(--status-success-bg)' }}
            >
              <Check className="w-4 h-4" style={{ color: 'var(--status-success)' }} />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--status-success)' }}>
                Paid
                {article.paymentAmount && (
                  <span className="ml-1">{formatCents(article.paymentAmount)}</span>
                )}
              </p>
              {article.paidAt && (
                <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                  {formatDate(article.paidAt)}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="icon-container">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--fg-default)' }}>
                {article.paymentAmount ? formatCents(article.paymentAmount) : 'Not set'}
              </p>
              <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                {article.paymentIsManual ? 'Manual' : 'Calculated'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Payment Breakdown */}
      {breakdown && !article.paymentIsManual && (
        <div
          className="p-3 rounded-lg text-sm space-y-2"
          style={{ background: 'var(--bg-subtle)' }}
        >
          <div className="flex justify-between">
            <span style={{ color: 'var(--fg-muted)' }}>{breakdown.tierName}</span>
            <span style={{ color: 'var(--fg-default)' }}>{formatCents(breakdown.tierRate)}</span>
          </div>
          {breakdown.bonuses.map((bonus, idx) => (
            <div key={idx} className="flex justify-between">
              <span style={{ color: 'var(--fg-muted)' }}>+ {bonus.type}</span>
              <span style={{ color: 'var(--fg-default)' }}>{formatCents(bonus.amount)}</span>
            </div>
          ))}
          <div
            className="flex justify-between pt-2 mt-2 font-medium"
            style={{ borderTop: '1px solid var(--border-default)' }}
          >
            <span style={{ color: 'var(--fg-default)' }}>Total</span>
            <span style={{ color: 'var(--accent)' }}>{formatCents(breakdown.totalAmount)}</span>
          </div>
        </div>
      )}

      {/* Featured Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star
            className={`w-4 h-4 ${article.isFeatured ? 'fill-current' : ''}`}
            style={{ color: article.isFeatured ? 'var(--status-warning)' : 'var(--fg-faint)' }}
          />
          <span className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            Featured Article
          </span>
        </div>
        <button
          onClick={handleToggleFeatured}
          disabled={isTogglingFeatured}
          className="text-xs px-2 py-1 rounded"
          style={{
            background: article.isFeatured ? 'var(--status-warning-bg)' : 'var(--bg-subtle)',
            color: article.isFeatured ? 'var(--status-warning)' : 'var(--fg-muted)',
          }}
        >
          {isTogglingFeatured ? '...' : article.isFeatured ? 'Featured' : 'Not Featured'}
        </button>
      </div>

      {/* Actions */}
      {!article.paymentStatus && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRecalculate}
            disabled={isRecalculating}
          >
            {isRecalculating ? (
              <LoadingSpinner size="sm" />
            ) : (
              <>
                <RefreshCw className="w-3 h-3 mr-1" />
                Recalculate
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowManualInput(!showManualInput)}
          >
            <Calculator className="w-3 h-3 mr-1" />
            {showManualInput ? 'Cancel' : 'Set Manual'}
          </Button>
        </div>
      )}

      {/* Manual Amount Input */}
      {showManualInput && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <DollarSign
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: 'var(--fg-faint)' }}
            />
            <input
              type="number"
              step="0.01"
              min="0"
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)}
              placeholder="0.00"
              className="input pl-9 w-full"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSaveManual}
            disabled={isSavingManual || !manualAmount}
          >
            {isSavingManual ? <LoadingSpinner size="sm" /> : 'Save'}
          </Button>
        </div>
      )}
    </div>
  )
}
