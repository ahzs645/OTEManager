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
  Edit2,
  Trash2,
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
import { updateArticleStatus, addArticleNote, updateArticleNote, deleteArticleNote, updateArticleContent, updateArticle, calculateArticlePayment, setManualPayment, toggleArticleFeatured, updateAttachmentCaption, updateArticleIssue, markPaymentComplete, updateArticleBonusFlags, updateArticleFeedbackLetter, updateArticleTier } from '~/lib/mutations'
import { formatCents, type PaymentCalculation } from '~/lib/payment-calculator'

// Server function to fetch article data - ensures db code only runs on server
const fetchArticleData = createServerFn({ method: 'GET' })
  .validator((articleId: string) => {
    if (!articleId || typeof articleId !== 'string') {
      throw new Error('Article ID is required')
    }
    return articleId
  })
  .handler(async ({ data: articleId }) => {
    // Guard against undefined articleId (can happen during hot reload)
    if (!articleId) {
      return { article: null, volumes: [] }
    }

    const { db, articles } = await import('@db/index')
    const { eq } = await import('drizzle-orm')

    // Fetch article with relations
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

    // Fetch all volumes with their issues for the dropdown
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
  const [newNote, setNewNote] = useState('')
  const [isAddingNote, setIsAddingNote] = useState(false)
  const [content, setContent] = useState(article?.content || '')
  const [isSavingContent, setIsSavingContent] = useState(false)
  const [isConverting, setIsConverting] = useState<string | null>(null)
  const [contentSaved, setContentSaved] = useState(true)
  const [editingCaption, setEditingCaption] = useState<{ id: string; name: string; caption: string; photoUrl: string } | null>(null)
  const [captionText, setCaptionText] = useState('')
  const [isSavingCaption, setIsSavingCaption] = useState(false)
  const [feedbackLetter, setFeedbackLetter] = useState(article?.feedbackLetter || '')
  const [isSavingFeedback, setIsSavingFeedback] = useState(false)
  const [feedbackSaved, setFeedbackSaved] = useState(true)
  const [editingNote, setEditingNote] = useState<{ id: string; content: string } | null>(null)
  const [editNoteContent, setEditNoteContent] = useState('')
  const [isSavingNote, setIsSavingNote] = useState(false)
  const [isDeletingNote, setIsDeletingNote] = useState<string | null>(null)

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

  const handleAddNote = async () => {
    if (!newNote.trim()) return
    setIsAddingNote(true)
    try {
      await addArticleNote({
        data: {
          articleId: article.id,
          content: newNote,
        },
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
    console.log('[Client] handleSaveContent called, articleId:', article.id, 'content length:', content.length)
    setIsSavingContent(true)
    try {
      const result = await updateArticleContent({
        data: {
          articleId: article.id,
          content: content,
        },
      })
      console.log('[Client] updateArticleContent result:', result)
      if (result.success) {
        setContentSaved(true)
      } else {
        console.error('Failed to save content:', result.error)
        alert('Failed to save content: ' + (result.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to save content:', error)
      alert('Failed to save content')
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
        data: {
          articleId: article.id,
          attachmentId: attachmentId,
        },
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

  const handleSaveCaption = async () => {
    if (!editingCaption) return
    setIsSavingCaption(true)
    try {
      await updateAttachmentCaption({ data: { attachmentId: editingCaption.id, caption: captionText } })
      setEditingCaption(null)
      setCaptionText('')
      window.location.reload()
    } catch (error) {
      console.error('Failed to save caption:', error)
    } finally {
      setIsSavingCaption(false)
    }
  }

  const openCaptionModal = (photo: any) => {
    setEditingCaption({
      id: photo.id,
      name: photo.photoNumber ? `Photo ${photo.photoNumber}` : photo.originalFileName,
      caption: photo.caption || '',
      photoUrl: `/uploads/${photo.filePath}`,
    })
    setCaptionText(photo.caption || '')
  }

  const closeCaptionModal = () => {
    setEditingCaption(null)
    setCaptionText('')
  }

  const handleSaveFeedbackLetter = async () => {
    setIsSavingFeedback(true)
    try {
      const result = await updateArticleFeedbackLetter({
        data: {
          articleId: article.id,
          feedbackLetter: feedbackLetter,
        },
      })
      if (result.success) {
        setFeedbackSaved(true)
      } else {
        console.error('Failed to save feedback letter:', result.error)
        alert('Failed to save feedback letter: ' + (result.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to save feedback letter:', error)
      alert('Failed to save feedback letter')
    } finally {
      setIsSavingFeedback(false)
    }
  }

  const handleFeedbackLetterChange = (newContent: string) => {
    setFeedbackLetter(newContent)
    setFeedbackSaved(false)
  }

  const handleEditNote = (note: { id: string; content: string }) => {
    setEditingNote(note)
    setEditNoteContent(note.content)
  }

  const handleSaveEditedNote = async () => {
    if (!editingNote || !editNoteContent.trim()) return
    setIsSavingNote(true)
    try {
      await updateArticleNote({
        data: {
          noteId: editingNote.id,
          content: editNoteContent,
        },
      })
      setEditingNote(null)
      setEditNoteContent('')
      window.location.reload()
    } catch (error) {
      console.error('Failed to update note:', error)
    } finally {
      setIsSavingNote(false)
    }
  }

  const handleCancelEditNote = () => {
    setEditingNote(null)
    setEditNoteContent('')
  }

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Are you sure you want to delete this note?')) return
    setIsDeletingNote(noteId)
    try {
      await deleteArticleNote({ data: { noteId } })
      window.location.reload()
    } catch (error) {
      console.error('Failed to delete note:', error)
    } finally {
      setIsDeletingNote(null)
    }
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
          <VolumeIssueEditorInline
            articleId={article.id}
            volumes={volumes}
            currentIssueId={article.issueId}
            currentIssue={article.publicationIssue}
          />
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Documents */}
          {(() => {
            const documents = article.attachments.filter((a: any) => a.attachmentType === 'word_document')
            return documents.length > 0 ? (
              <Section title={`Documents (${documents.length})`} noPadding>
                <div>
                  {documents.map((attachment: any, index: number) => (
                    <div
                      key={attachment.id}
                      className="flex items-center justify-between px-4 py-3"
                      style={{
                        borderBottom:
                          index < documents.length - 1
                            ? '0.5px solid var(--border-subtle)'
                            : 'none',
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="icon-container">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium" style={{ color: 'var(--fg-default)' }}>
                            {attachment.originalFileName}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                            {attachment.fileSize && <>{(attachment.fileSize / 1024).toFixed(1)} KB</>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
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
                        <a
                          href={`/uploads/${attachment.filePath}`}
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
              </Section>
            ) : null
          })()}

          {/* Photos */}
          {(() => {
            const photos = article.attachments.filter((a: any) => a.attachmentType === 'photo')
            return photos.length > 0 ? (
              <Section title={`Photos (${photos.length})`}>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {photos.map((photo: any) => (
                    <div
                      key={photo.id}
                      className="rounded-lg overflow-hidden"
                      style={{ border: '0.5px solid var(--border-default)' }}
                    >
                      {/* Photo Preview */}
                      <a
                        href={`/uploads/${photo.filePath}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block aspect-square bg-gray-100 relative group"
                      >
                        <img
                          src={`/uploads/${photo.filePath}`}
                          alt={photo.originalFileName}
                          className="w-full h-full object-cover"
                        />
                        <div
                          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ background: 'rgba(0,0,0,0.3)' }}
                        >
                          <span className="text-white text-sm">View full size</span>
                        </div>
                      </a>
                      {/* Photo Info */}
                      <div className="p-3" style={{ background: 'var(--bg-subtle)' }}>
                        <p
                          className="text-xs font-medium truncate"
                          style={{ color: 'var(--fg-default)' }}
                          title={photo.originalFileName}
                        >
                          {photo.photoNumber ? `Photo ${photo.photoNumber}` : photo.originalFileName}
                        </p>
                        {/* Caption */}
                        <div className="mt-1 flex items-start gap-1">
                          {photo.caption ? (
                            <p
                              className="text-xs italic flex-1 line-clamp-2"
                              style={{ color: 'var(--fg-muted)' }}
                            >
                              {photo.caption}
                            </p>
                          ) : (
                            <p
                              className="text-xs flex-1"
                              style={{ color: 'var(--fg-faint)' }}
                            >
                              No caption
                            </p>
                          )}
                          <button
                            onClick={() => openCaptionModal(photo)}
                            className="btn btn-ghost !p-1"
                            title="Edit caption"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        </div>
                        {/* Download link */}
                        <a
                          href={`/uploads/${photo.filePath}`}
                          download={photo.originalFileName}
                          className="text-xs mt-2 inline-flex items-center gap-1"
                          style={{ color: 'var(--accent)' }}
                        >
                          <Download className="w-3 h-3" />
                          Download
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null
          })()}

          {/* Article Content */}
          <Section
            title="Article Content"
            action={
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                  {wordCount} words · {charCount} chars
                </span>
                <a
                  href={`/api/exportArticle/${article.id}`}
                  download
                  className="btn btn-ghost"
                  style={{ padding: '0.25rem 0.5rem' }}
                  title="Download as Word document"
                >
                  <Download className="w-3 h-3" />
                </a>
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

          {/* Feedback Letter */}
          <Section
            title="Feedback Letter"
            action={
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                  {feedbackLetter.trim() ? feedbackLetter.trim().split(/\s+/).length : 0} words
                </span>
                <Button
                  onClick={handleSaveFeedbackLetter}
                  disabled={isSavingFeedback || feedbackSaved}
                  variant={feedbackSaved ? 'secondary' : 'primary'}
                  size="sm"
                >
                  {isSavingFeedback ? (
                    <LoadingSpinner size="sm" />
                  ) : feedbackSaved ? (
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
              value={feedbackLetter}
              onChange={(e) => handleFeedbackLetterChange(e.target.value)}
              placeholder="Write a feedback letter in markdown format. This can be used to communicate feedback to the author about their submission..."
              className="w-full min-h-[300px] p-3 text-sm font-mono resize-y"
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
                      {editingNote?.id === note.id ? (
                        // Edit mode
                        <div className="space-y-2">
                          <textarea
                            value={editNoteContent}
                            onChange={(e) => setEditNoteContent(e.target.value)}
                            className="w-full p-2 text-sm rounded"
                            style={{
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--border-default)',
                              color: 'var(--fg-default)',
                              minHeight: '80px',
                            }}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <Button
                              onClick={handleSaveEditedNote}
                              disabled={isSavingNote || !editNoteContent.trim()}
                              variant="primary"
                              size="sm"
                            >
                              {isSavingNote ? <LoadingSpinner size="sm" /> : 'Save'}
                            </Button>
                            <Button
                              onClick={handleCancelEditNote}
                              variant="ghost"
                              size="sm"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        // View mode
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <p
                              className="text-sm flex-1"
                              style={{ color: 'var(--fg-default)' }}
                            >
                              {note.content}
                            </p>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={() => handleEditNote(note)}
                                className="btn btn-ghost !p-1"
                                title="Edit note"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleDeleteNote(note.id)}
                                disabled={isDeletingNote === note.id}
                                className="btn btn-ghost !p-1"
                                title="Delete note"
                                style={{ color: 'var(--status-error)' }}
                              >
                                {isDeletingNote === note.id ? (
                                  <LoadingSpinner size="sm" />
                                ) : (
                                  <Trash2 className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </div>
                          <p
                            className="text-xs mt-2"
                            style={{ color: 'var(--fg-muted)' }}
                          >
                            {note.createdBy || 'Unknown'} ·{' '}
                            {formatDate(note.createdAt)}
                          </p>
                        </>
                      )}
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

      {/* Caption Edit Modal */}
      {editingCaption && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          {/* Backdrop */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(4px)',
            }}
            onClick={closeCaptionModal}
          />

          {/* Modal */}
          <div
            style={{
              position: 'relative',
              background: 'var(--bg-surface)',
              borderRadius: '12px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              width: '100%',
              maxWidth: '650px',
              maxHeight: '90vh',
              overflow: 'auto',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1rem 1.25rem',
                borderBottom: '1px solid var(--border-default)',
              }}
            >
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--fg-default)', margin: 0 }}>
                Edit Caption
              </h3>
              <button
                onClick={closeCaptionModal}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.25rem',
                  color: 'var(--fg-muted)',
                }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '1.25rem' }}>
              {/* Photo Preview */}
              <div
                style={{
                  marginBottom: '1rem',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  background: 'var(--bg-subtle)',
                }}
              >
                <img
                  src={editingCaption.photoUrl}
                  alt={editingCaption.name}
                  style={{
                    width: '100%',
                    height: '350px',
                    objectFit: 'contain',
                  }}
                />
              </div>

              {/* Photo Name */}
              <p
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--fg-default)',
                  marginBottom: '0.75rem',
                }}
              >
                {editingCaption.name}
              </p>

              {/* Caption Input */}
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: 'var(--fg-muted)',
                  marginBottom: '0.5rem',
                }}
              >
                Caption
              </label>
              <textarea
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                placeholder="Enter a descriptive caption for this photo..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  fontSize: '0.875rem',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '8px',
                  color: 'var(--fg-default)',
                  resize: 'vertical',
                  minHeight: '100px',
                }}
                autoFocus
              />
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.5rem',
                padding: '1rem 1.25rem',
                borderTop: '1px solid var(--border-default)',
                background: 'var(--bg-subtle)',
              }}
            >
              <button
                onClick={closeCaptionModal}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCaption}
                disabled={isSavingCaption}
                className="btn btn-primary"
              >
                {isSavingCaption ? <LoadingSpinner size="sm" /> : 'Save Caption'}
              </button>
            </div>
          </div>
        </div>
      )}
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

type VolumeWithIssues = {
  id: string
  volumeNumber: number
  year: number | null
  issues: Array<{
    id: string
    issueNumber: number
    title: string | null
    releaseDate: Date | null
  }>
}

type CurrentIssue = {
  id: string
  issueNumber: number
  title: string | null
  volume: {
    id: string
    volumeNumber: number
  }
} | null

function VolumeIssueEditor({
  articleId,
  volumes,
  currentIssueId,
  currentIssue,
  legacyVolume,
  legacyIssue,
}: {
  articleId: string
  volumes: VolumeWithIssues[]
  currentIssueId: string | null
  currentIssue: CurrentIssue
  legacyVolume: number | null
  legacyIssue: number | null
}) {
  // Determine initial volume from current issue or null
  const initialVolumeId = currentIssue?.volume?.id || ''

  const [selectedVolumeId, setSelectedVolumeId] = useState<string>(initialVolumeId)
  const [selectedIssueId, setSelectedIssueId] = useState<string>(currentIssueId || '')
  const [isSaving, setIsSaving] = useState(false)

  // Get issues for the selected volume
  const selectedVolume = volumes.find((v) => v.id === selectedVolumeId)
  const availableIssues = selectedVolume?.issues || []

  // Check if there are changes
  const hasChanges = selectedIssueId !== (currentIssueId || '')

  const handleVolumeChange = (volumeId: string) => {
    setSelectedVolumeId(volumeId)
    setSelectedIssueId('') // Reset issue when volume changes
  }

  const handleIssueChange = (issueId: string) => {
    setSelectedIssueId(issueId)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateArticleIssue({
        data: {
          articleId,
          issueId: selectedIssueId || null,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to save publication info:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleClear = async () => {
    setIsSaving(true)
    try {
      await updateArticleIssue({
        data: {
          articleId,
          issueId: null,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to clear publication info:', error)
    } finally {
      setIsSaving(false)
    }
  }

  // Show message if no volumes exist
  if (volumes.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
          No publication volumes configured yet.
        </p>
        <Link
          to="/publications"
          className="text-xs"
          style={{ color: 'var(--accent)' }}
        >
          Go to Publications to create volumes →
        </Link>
        {/* Show legacy data if present */}
        {(legacyVolume || legacyIssue) && (
          <p className="text-xs" style={{ color: 'var(--fg-faint)' }}>
            Legacy: Volume {legacyVolume || '?'}, Issue {legacyIssue || '?'}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Volume Dropdown */}
      <div>
        <label
          className="block text-xs mb-1"
          style={{ color: 'var(--fg-muted)' }}
        >
          Volume
        </label>
        <div className="relative">
          <select
            value={selectedVolumeId}
            onChange={(e) => handleVolumeChange(e.target.value)}
            className="select-trigger w-full pr-8"
          >
            <option value="">Select volume...</option>
            {volumes.map((volume) => (
              <option key={volume.id} value={volume.id}>
                Volume {volume.volumeNumber}
                {volume.year ? ` (${volume.year})` : ''}
              </option>
            ))}
          </select>
          <ChevronDown
            className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
            style={{ color: 'var(--fg-faint)' }}
          />
        </div>
      </div>

      {/* Issue Dropdown - only shown when volume is selected */}
      {selectedVolumeId && (
        <div>
          <label
            className="block text-xs mb-1"
            style={{ color: 'var(--fg-muted)' }}
          >
            Issue
          </label>
          <div className="relative">
            <select
              value={selectedIssueId}
              onChange={(e) => handleIssueChange(e.target.value)}
              className="select-trigger w-full pr-8"
              disabled={availableIssues.length === 0}
            >
              <option value="">
                {availableIssues.length === 0 ? 'No issues in this volume' : 'Select issue...'}
              </option>
              {availableIssues.map((issue) => (
                <option key={issue.id} value={issue.id}>
                  Issue {issue.issueNumber}
                  {issue.title ? ` - ${issue.title}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
              style={{ color: 'var(--fg-faint)' }}
            />
          </div>
        </div>
      )}

      {/* Save/Clear buttons */}
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

      {/* Current assignment display */}
      {currentIssue && !hasChanges && (
        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
            Volume {currentIssue.volume.volumeNumber} · Issue {currentIssue.issueNumber}
            {currentIssue.title && ` (${currentIssue.title})`}
          </p>
          <button
            onClick={handleClear}
            disabled={isSaving}
            className="text-xs"
            style={{ color: 'var(--fg-faint)' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Legacy data notice */}
      {(legacyVolume || legacyIssue) && !currentIssue && (
        <p className="text-xs" style={{ color: 'var(--fg-faint)' }}>
          Legacy: Volume {legacyVolume || '?'}, Issue {legacyIssue || '?'}
        </p>
      )}
    </div>
  )
}

// Inline Volume/Issue Editor for the header
function VolumeIssueEditorInline({
  articleId,
  volumes,
  currentIssueId,
  currentIssue,
}: {
  articleId: string
  volumes: VolumeWithIssues[]
  currentIssueId: string | null
  currentIssue: CurrentIssue
}) {
  const initialVolumeId = currentIssue?.volume?.id || ''

  const [selectedVolumeId, setSelectedVolumeId] = useState<string>(initialVolumeId)
  const [selectedIssueId, setSelectedIssueId] = useState<string>(currentIssueId || '')
  const [isSaving, setIsSaving] = useState(false)

  const selectedVolume = volumes.find((v) => v.id === selectedVolumeId)
  const availableIssues = selectedVolume?.issues || []
  const hasChanges = selectedIssueId !== (currentIssueId || '')

  const handleVolumeChange = (volumeId: string) => {
    setSelectedVolumeId(volumeId)
    setSelectedIssueId('')
  }

  const handleIssueChange = (issueId: string) => {
    setSelectedIssueId(issueId)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateArticleIssue({
        data: {
          articleId,
          issueId: selectedIssueId || null,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to save publication info:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleClear = async () => {
    setIsSaving(true)
    try {
      await updateArticleIssue({
        data: {
          articleId,
          issueId: null,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to clear publication info:', error)
    } finally {
      setIsSaving(false)
    }
  }

  if (volumes.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
          No volumes configured.
        </span>
        <Link
          to="/publications"
          className="text-xs"
          style={{ color: 'var(--accent)' }}
        >
          Create volumes →
        </Link>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-xs font-medium" style={{ color: 'var(--fg-muted)' }}>
        Publication:
      </span>

      {/* Volume Dropdown */}
      <div className="relative">
        <select
          value={selectedVolumeId}
          onChange={(e) => handleVolumeChange(e.target.value)}
          className="select-trigger pr-7 text-sm"
          style={{ minWidth: '130px', padding: '0.35rem 0.5rem' }}
        >
          <option value="">Select volume...</option>
          {volumes.map((volume) => (
            <option key={volume.id} value={volume.id}>
              Volume {volume.volumeNumber}
              {volume.year ? ` (${volume.year})` : ''}
            </option>
          ))}
        </select>
        <ChevronDown
          className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
          style={{ color: 'var(--fg-faint)' }}
        />
      </div>

      {/* Issue Dropdown */}
      {selectedVolumeId && (
        <div className="relative">
          <select
            value={selectedIssueId}
            onChange={(e) => handleIssueChange(e.target.value)}
            className="select-trigger pr-7 text-sm"
            style={{ minWidth: '120px', padding: '0.35rem 0.5rem' }}
            disabled={availableIssues.length === 0}
          >
            <option value="">
              {availableIssues.length === 0 ? 'No issues' : 'Select issue...'}
            </option>
            {availableIssues.map((issue) => (
              <option key={issue.id} value={issue.id}>
                Issue {issue.issueNumber}
                {issue.title ? ` - ${issue.title}` : ''}
              </option>
            ))}
          </select>
          <ChevronDown
            className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
            style={{ color: 'var(--fg-faint)' }}
          />
        </div>
      )}

      {/* Save Button */}
      {hasChanges && (
        <Button
          onClick={handleSave}
          disabled={isSaving}
          variant="primary"
          size="sm"
        >
          {isSaving ? <LoadingSpinner size="sm" /> : 'Save'}
        </Button>
      )}

      {/* Current assignment + Clear */}
      {currentIssue && !hasChanges && (
        <button
          onClick={handleClear}
          disabled={isSaving}
          className="text-xs"
          style={{ color: 'var(--fg-faint)' }}
          title="Clear publication assignment"
        >
          Clear
        </button>
      )}
    </div>
  )
}

// Payment Section Component with breakdown and controls
function PaymentSection({ article }: { article: any }) {
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [showManualInput, setShowManualInput] = useState(false)
  const [manualAmount, setManualAmount] = useState('')
  const [isSavingManual, setIsSavingManual] = useState(false)
  const [isMarkingPaid, setIsMarkingPaid] = useState(false)

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
      await calculateArticlePayment({ data: { articleId: article.id, recalculate: true } })
      window.location.reload()
    } catch (error) {
      console.error('Failed to recalculate:', error)
    } finally {
      setIsRecalculating(false)
    }
  }

  const handleSaveManual = async () => {
    const amount = parseFloat(manualAmount)
    if (isNaN(amount) || amount < 0) return

    setIsSavingManual(true)
    try {
      await setManualPayment({
        data: {
          articleId: article.id,
          amount: Math.round(amount * 100), // Convert to cents
        },
      })
      setShowManualInput(false)
      window.location.reload()
    } catch (error) {
      console.error('Failed to set manual payment:', error)
    } finally {
      setIsSavingManual(false)
    }
  }

  const handleMarkAsPaid = async () => {
    if (!article.paymentAmount) return
    setIsMarkingPaid(true)
    try {
      await markPaymentComplete({
        data: {
          articleId: article.id,
          amount: article.paymentAmount,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to mark as paid:', error)
    } finally {
      setIsMarkingPaid(false)
    }
  }

  const handleMarkAsUnpaid = async () => {
    setIsMarkingPaid(true)
    try {
      await updateArticle({
        data: {
          articleId: article.id,
          paymentStatus: false,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to mark as unpaid:', error)
    } finally {
      setIsMarkingPaid(false)
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

      {/* Tier & Bonuses */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium" style={{ color: 'var(--fg-muted)' }}>
            Tier & Bonuses
          </p>
          {article.paymentStatus && (
            <span className="text-xs" style={{ color: 'var(--fg-faint)' }}>
              Locked (paid)
            </span>
          )}
        </div>

        {/* Tier Selector */}
        <TierSelector
          articleId={article.id}
          currentTier={article.articleTier}
          disabled={article.paymentStatus}
        />

        <BonusToggle
          articleId={article.id}
          label="Research Bonus"
          description="Extensive research or interviews (+$10)"
          field="hasResearchBonus"
          isActive={article.hasResearchBonus || false}
          disabled={article.paymentStatus}
        />
        <BonusToggle
          articleId={article.id}
          label="Time-Sensitive"
          description="Short notice or breaking news (+$5)"
          field="hasTimeSensitiveBonus"
          isActive={article.hasTimeSensitiveBonus || false}
          disabled={article.paymentStatus}
        />
        <BonusToggle
          articleId={article.id}
          label="Professional Photos"
          description="High-quality professional photos (+$15)"
          field="hasProfessionalPhotos"
          isActive={article.hasProfessionalPhotos || false}
          disabled={article.paymentStatus}
        />
        <BonusToggle
          articleId={article.id}
          label="Professional Graphics"
          description="Professional graphics/infographics (+$15)"
          field="hasProfessionalGraphics"
          isActive={article.hasProfessionalGraphics || false}
          disabled={article.paymentStatus}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {!article.paymentStatus ? (
          <>
            {/* Mark as Paid - only show if payment amount is set */}
            {article.paymentAmount > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleMarkAsPaid}
                disabled={isMarkingPaid}
              >
                {isMarkingPaid ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <>
                    <Check className="w-3 h-3 mr-1" />
                    Mark as Paid
                  </>
                )}
              </Button>
            )}
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
          </>
        ) : (
          /* When already paid - show Mark as Unpaid and Adjust Payment options */
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAsUnpaid}
              disabled={isMarkingPaid}
            >
              {isMarkingPaid ? (
                <LoadingSpinner size="sm" />
              ) : (
                <>
                  <X className="w-3 h-3 mr-1" />
                  Mark as Unpaid
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowManualInput(!showManualInput)}
            >
              <Edit2 className="w-3 h-3 mr-1" />
              {showManualInput ? 'Cancel' : 'Adjust Amount'}
            </Button>
          </>
        )}
      </div>

      {/* Manual Amount Input */}
      {showManualInput && (
        <div className="space-y-2">
          {article.paymentStatus && (
            <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              Adjust the paid amount (for corrections only)
            </p>
          )}
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
                placeholder={article.paymentAmount ? (article.paymentAmount / 100).toFixed(2) : '0.00'}
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
        </div>
      )}
    </div>
  )
}

// Bonus Toggle Component
function BonusToggle({
  articleId,
  label,
  description,
  field,
  isActive,
  disabled = false,
}: {
  articleId: string
  label: string
  description: string
  field: 'hasResearchBonus' | 'hasTimeSensitiveBonus' | 'hasProfessionalPhotos' | 'hasProfessionalGraphics'
  isActive: boolean
  disabled?: boolean
}) {
  const [isToggling, setIsToggling] = useState(false)

  const handleToggle = async () => {
    if (disabled) return
    setIsToggling(true)
    try {
      await updateArticleBonusFlags({
        data: {
          articleId,
          [field]: !isActive,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to toggle bonus:', error)
    } finally {
      setIsToggling(false)
    }
  }

  return (
    <div
      className="flex items-center justify-between p-2 rounded"
      style={{
        background: 'var(--bg-subtle)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div>
        <p className="text-sm" style={{ color: 'var(--fg-default)' }}>
          {label}
        </p>
        <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
          {description}
        </p>
      </div>
      <button
        onClick={handleToggle}
        disabled={isToggling || disabled}
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{
          background: isActive ? 'var(--status-success-bg)' : 'var(--bg-muted)',
          color: isActive ? 'var(--status-success)' : 'var(--fg-muted)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        title={disabled ? 'Cannot modify bonuses after payment' : undefined}
      >
        {isToggling ? '...' : isActive ? 'Yes' : 'No'}
      </button>
    </div>
  )
}

const TIER_OPTIONS = [
  { value: 'Tier 1 (Basic)', label: 'Tier 1 (Basic)', rate: '$25' },
  { value: 'Tier 2 (Standard)', label: 'Tier 2 (Standard)', rate: '$40' },
  { value: 'Tier 3 (Advanced)', label: 'Tier 3 (Advanced)', rate: '$60' },
]

// Tier Selector Component
function TierSelector({
  articleId,
  currentTier,
  disabled = false,
}: {
  articleId: string
  currentTier: string
  disabled?: boolean
}) {
  const [isUpdating, setIsUpdating] = useState(false)

  const handleTierChange = async (newTier: string) => {
    if (disabled || newTier === currentTier) return
    setIsUpdating(true)
    try {
      await updateArticleTier({
        data: {
          articleId,
          tier: newTier,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to update tier:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const currentOption = TIER_OPTIONS.find(t => t.value === currentTier)

  return (
    <div
      className="flex items-center justify-between p-2 rounded"
      style={{
        background: 'var(--bg-subtle)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div>
        <p className="text-sm" style={{ color: 'var(--fg-default)' }}>
          Article Tier
        </p>
        <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
          Base rate: {currentOption?.rate || '$25'}
        </p>
      </div>
      <div className="relative">
        <select
          value={currentTier}
          onChange={(e) => handleTierChange(e.target.value)}
          disabled={disabled || isUpdating}
          className="text-xs px-2 py-1 rounded appearance-none pr-6"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            color: 'var(--fg-default)',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          {TIER_OPTIONS.map((tier) => (
            <option key={tier.value} value={tier.value}>
              {tier.label}
            </option>
          ))}
        </select>
        {isUpdating && (
          <div className="absolute inset-0 flex items-center justify-center">
            <LoadingSpinner size="sm" />
          </div>
        )}
      </div>
    </div>
  )
}
