import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { useState } from 'react'
import {
  ArrowLeft,
  User,
  Mail,
  FileText,
  DollarSign,
  Edit2,
  Check,
  X,
  ChevronRight,
} from 'lucide-react'
import {
  StatusBadge,
  TierBadge,
  formatDate,
  Section,
  Avatar,
  Button,
  Input,
  LoadingSpinner,
} from '~/components/Layout'
import { updateAuthorPaymentInfo } from '~/lib/mutations'

// Server function to fetch author data - ensures db code only runs on server
const fetchAuthorData = createServerFn({ method: 'GET' })
  .validator((authorId: string) => authorId)
  .handler(async ({ data: authorId }) => {
    const { db, authors, articles } = await import('@db/index')
    const { eq, sum, count, and } = await import('drizzle-orm')

    const author = await db.query.authors.findFirst({
      where: eq(authors.id, authorId),
      with: {
        articles: {
          with: {
            attachments: true,
          },
          orderBy: (articles: any, { desc }: any) => [desc(articles.createdAt)],
        },
      },
    })

    if (!author) {
      return { author: null, stats: null }
    }

    // Calculate stats
    const [statsResult] = await db
      .select({
        totalArticles: count(),
        totalPaid: sum(articles.paymentAmount),
      })
      .from(articles)
      .where(
        and(eq(articles.authorId, authorId), eq(articles.paymentStatus, true))
      )

    const [allArticlesCount] = await db
      .select({ count: count() })
      .from(articles)
      .where(eq(articles.authorId, authorId))

    return {
      author,
      stats: {
        totalArticles: allArticlesCount?.count ?? 0,
        paidArticles: Number(statsResult?.totalArticles) || 0,
        totalEarnings: Number(statsResult?.totalPaid) || 0,
      },
    }
  })

export const Route = createFileRoute('/author/$authorId')({
  component: AuthorDetailPage,
  loader: ({ params }) => fetchAuthorData(params.authorId),
})

const ROLE_OPTIONS = [
  'Staff Writer',
  'Guest Contributor',
  'Editor',
  'Photographer',
  'Graphic Designer',
  'Other',
]

function AuthorDetailPage() {
  const { author, stats } = Route.useLoaderData()
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editData, setEditData] = useState({
    autoDepositAvailable: author?.autoDepositAvailable ?? false,
    etransferEmail: author?.etransferEmail ?? '',
  })

  if (!author) {
    return (
      <div className="empty-state" style={{ minHeight: '400px' }}>
        <User className="empty-state-icon" />
        <h2 className="empty-state-title">Author not found</h2>
        <p className="empty-state-description">
          This author may have been deleted or moved.
        </p>
        <Link to="/authors" className="btn btn-secondary mt-4">
          <ArrowLeft className="w-4 h-4" />
          Back to authors
        </Link>
      </div>
    )
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateAuthorPaymentInfo({
        authorId: author.id,
        autoDepositAvailable: editData.autoDepositAvailable,
        etransferEmail: editData.etransferEmail || undefined,
      })
      setIsEditing(false)
      window.location.reload()
    } catch (error) {
      console.error('Failed to update author:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const authorName = `${author.givenName} ${author.surname}`

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <Link
        to="/authors"
        className="inline-flex items-center gap-1.5 text-sm"
        style={{ color: 'var(--fg-muted)' }}
      >
        <ArrowLeft className="w-4 h-4" />
        Authors
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
          <div className="flex items-center gap-4">
            <Avatar name={authorName} size="lg" />
            <div>
              <h1
                className="text-lg font-semibold"
                style={{ color: 'var(--fg-default)', letterSpacing: '-0.02em' }}
              >
                {authorName}
              </h1>
              <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                {author.role}
              </p>
              <a
                href={`mailto:${author.email}`}
                className="text-sm flex items-center gap-1 mt-1"
                style={{ color: 'var(--accent)' }}
              >
                <Mail className="w-3 h-3" />
                {author.email}
              </a>
            </div>
          </div>

          <Button
            variant={isEditing ? 'ghost' : 'secondary'}
            size="sm"
            onClick={() => {
              if (isEditing) {
                setEditData({
                  autoDepositAvailable: author.autoDepositAvailable ?? false,
                  etransferEmail: author.etransferEmail ?? '',
                })
              }
              setIsEditing(!isEditing)
            }}
          >
            {isEditing ? (
              <>
                <X className="w-4 h-4" />
                Cancel
              </>
            ) : (
              <>
                <Edit2 className="w-4 h-4" />
                Edit
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div
          className="p-4 rounded-lg"
          style={{
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-default)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4" style={{ color: 'var(--fg-muted)' }} />
            <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              Total Articles
            </span>
          </div>
          <p
            className="text-2xl font-semibold"
            style={{ color: 'var(--fg-default)' }}
          >
            {stats?.totalArticles ?? 0}
          </p>
        </div>

        <div
          className="p-4 rounded-lg"
          style={{
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-default)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Check className="w-4 h-4" style={{ color: 'var(--status-success)' }} />
            <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              Paid Articles
            </span>
          </div>
          <p
            className="text-2xl font-semibold"
            style={{ color: 'var(--fg-default)' }}
          >
            {stats?.paidArticles ?? 0}
          </p>
        </div>

        <div
          className="p-4 rounded-lg"
          style={{
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-default)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4" style={{ color: 'var(--status-success)' }} />
            <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              Total Earnings
            </span>
          </div>
          <p
            className="text-2xl font-semibold"
            style={{ color: 'var(--status-success)' }}
          >
            ${((stats?.totalEarnings ?? 0) / 100).toFixed(2)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Articles */}
        <div className="lg:col-span-2">
          <Section title={`Articles (${author.articles?.length ?? 0})`} noPadding>
            {!author.articles || author.articles.length === 0 ? (
              <div className="empty-state py-8">
                <FileText
                  className="w-8 h-8 mb-2"
                  style={{ color: 'var(--fg-faint)' }}
                />
                <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                  No articles yet
                </p>
              </div>
            ) : (
              <div>
                {author.articles.map((article: any, index: number) => (
                  <Link
                    key={article.id}
                    to="/article/$articleId"
                    params={{ articleId: article.id }}
                    className="list-item list-item-clickable"
                    style={{
                      borderBottom:
                        index < author.articles.length - 1
                          ? '0.5px solid var(--border-subtle)'
                          : 'none',
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        style={{ color: 'var(--fg-default)' }}
                      >
                        {article.title}
                      </p>
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: 'var(--fg-muted)' }}
                      >
                        {formatDate(article.submittedAt || article.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <TierBadge tier={article.articleTier} />
                      <StatusBadge status={article.internalStatus} />
                      {article.paymentStatus && (
                        <DollarSign
                          className="w-4 h-4"
                          style={{ color: 'var(--status-success)' }}
                        />
                      )}
                      <ChevronRight
                        className="w-4 h-4"
                        style={{ color: 'var(--fg-faint)' }}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Right Column - Payment Info */}
        <div>
          <Section title="Payment Information">
            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--fg-muted)' }}>
                    Auto-Deposit Available
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editData.autoDepositAvailable}
                      onChange={(e) =>
                        setEditData((d) => ({
                          ...d,
                          autoDepositAvailable: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm" style={{ color: 'var(--fg-default)' }}>
                      Enabled
                    </span>
                  </label>
                </div>

                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--fg-muted)' }}>
                    E-Transfer Email
                  </label>
                  <input
                    type="email"
                    value={editData.etransferEmail}
                    onChange={(e) =>
                      setEditData((d) => ({ ...d, etransferEmail: e.target.value }))
                    }
                    placeholder="payment@example.com"
                    className="input w-full"
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--fg-muted)' }}>
                    Leave blank to use primary email
                  </p>
                </div>

                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  variant="primary"
                  className="w-full"
                >
                  {isSaving ? <LoadingSpinner size="sm" /> : 'Save Changes'}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                    Auto-Deposit
                  </span>
                  <span
                    className="text-sm font-medium"
                    style={{
                      color: author.autoDepositAvailable
                        ? 'var(--status-success)'
                        : 'var(--fg-muted)',
                    }}
                  >
                    {author.autoDepositAvailable ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                    E-Transfer Email
                  </span>
                  <span className="text-sm" style={{ color: 'var(--fg-default)' }}>
                    {author.etransferEmail || author.email}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                    Member Since
                  </span>
                  <span className="text-sm" style={{ color: 'var(--fg-default)' }}>
                    {formatDate(author.createdAt)}
                  </span>
                </div>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
