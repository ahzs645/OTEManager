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
  .validator((authorId: string) => {
    if (!authorId || typeof authorId !== 'string') {
      throw new Error('Author ID is required')
    }
    return authorId
  })
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
  loader: ({ params }) => {
    if (!params.authorId) {
      return { author: null, stats: null }
    }
    return fetchAuthorData({ data: params.authorId })
  },
})

const ROLE_OPTIONS = [
  'Staff Writer',
  'Guest Contributor',
  'Editor',
  'Photographer',
  'Graphic Designer',
  'Other',
]

const AUTHOR_TYPE_OPTIONS = [
  'Student',
  'Faculty',
  'Staff',
  'Organization',
  'External',
]

function AuthorDetailPage() {
  const { author, stats } = Route.useLoaderData()
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editData, setEditData] = useState({
    givenName: author?.givenName ?? '',
    surname: author?.surname ?? '',
    email: author?.email ?? '',
    autoDepositAvailable: author?.autoDepositAvailable ?? false,
    etransferEmail: author?.etransferEmail ?? '',
    sameAsContactEmail: !author?.etransferEmail || author?.etransferEmail === author?.email,
    authorType: author?.authorType ?? 'Student',
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
      // If "same as contact email" is checked, use the contact email for e-transfer
      const etransferEmail = editData.sameAsContactEmail
        ? editData.email
        : editData.etransferEmail

      await updateAuthorPaymentInfo({
        data: {
          authorId: author.id,
          givenName: editData.givenName,
          surname: editData.surname,
          email: editData.email,
          autoDepositAvailable: editData.autoDepositAvailable,
          etransferEmail: etransferEmail || undefined,
          authorType: editData.authorType,
        },
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
                {author.authorType || 'Student'}
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
                  givenName: author.givenName ?? '',
                  surname: author.surname ?? '',
                  email: author.email ?? '',
                  autoDepositAvailable: author.autoDepositAvailable ?? false,
                  etransferEmail: author.etransferEmail ?? '',
                  sameAsContactEmail: !author.etransferEmail || author.etransferEmail === author.email,
                  authorType: author.authorType ?? 'Student',
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
          <Section title="Author Information">
            {isEditing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--fg-muted)' }}>
                      First Name
                    </label>
                    <input
                      type="text"
                      value={editData.givenName}
                      onChange={(e) =>
                        setEditData((d) => ({ ...d, givenName: e.target.value }))
                      }
                      placeholder="First name"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--fg-muted)' }}>
                      Last Name
                    </label>
                    <input
                      type="text"
                      value={editData.surname}
                      onChange={(e) =>
                        setEditData((d) => ({ ...d, surname: e.target.value }))
                      }
                      placeholder="Last name"
                      className="input w-full"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--fg-muted)' }}>
                    Author Type
                  </label>
                  <select
                    value={editData.authorType}
                    onChange={(e) =>
                      setEditData((d) => ({ ...d, authorType: e.target.value }))
                    }
                    className="input w-full"
                  >
                    {AUTHOR_TYPE_OPTIONS.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--fg-muted)' }}>
                    Contact Email
                  </label>
                  <input
                    type="email"
                    value={editData.email}
                    onChange={(e) =>
                      setEditData((d) => ({ ...d, email: e.target.value }))
                    }
                    placeholder="author@example.com"
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--fg-muted)' }}>
                    E-Transfer Email
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      checked={editData.sameAsContactEmail}
                      onChange={(e) =>
                        setEditData((d) => ({
                          ...d,
                          sameAsContactEmail: e.target.checked,
                          etransferEmail: e.target.checked ? d.email : d.etransferEmail,
                        }))
                      }
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm" style={{ color: 'var(--fg-default)' }}>
                      Same as contact email
                    </span>
                  </label>
                  {!editData.sameAsContactEmail && (
                    <input
                      type="email"
                      value={editData.etransferEmail}
                      onChange={(e) =>
                        setEditData((d) => ({ ...d, etransferEmail: e.target.value }))
                      }
                      placeholder="payment@example.com"
                      className="input w-full"
                    />
                  )}
                </div>

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
                    Author Type
                  </span>
                  <span className="text-sm" style={{ color: 'var(--fg-default)' }}>
                    {author.authorType || 'Student'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                    Contact Email
                  </span>
                  <span className="text-sm" style={{ color: 'var(--fg-default)' }}>
                    {author.email}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                    E-Transfer Email
                  </span>
                  <span className="text-sm" style={{ color: 'var(--fg-default)' }}>
                    {author.etransferEmail || author.email}
                    {(!author.etransferEmail || author.etransferEmail === author.email) && (
                      <span className="text-xs ml-1" style={{ color: 'var(--fg-faint)' }}>
                        (same)
                      </span>
                    )}
                  </span>
                </div>

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
