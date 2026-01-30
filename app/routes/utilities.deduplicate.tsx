import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
  ChevronLeft,
  Copy,
  Trash2,
  AlertTriangle,
  CheckCircle,
  Info,
  Search,
  Merge,
} from 'lucide-react'
import { createServerFn } from '@tanstack/start'
import { LoadingSpinner } from '~/components/Layout'

// Server function to find duplicates
const findDuplicates = createServerFn({ method: 'GET' }).handler(async () => {
  const { db } = await import('@db/index')
  const { articles, authors } = await import('@db/schema')
  const { eq, sql } = await import('drizzle-orm')

  // Get all articles with author info
  const allArticles = await db
    .select({
      id: articles.id,
      title: articles.title,
      authorId: articles.authorId,
      authorGivenName: authors.givenName,
      authorSurname: authors.surname,
      authorEmail: authors.email,
      internalStatus: articles.internalStatus,
      submittedAt: articles.submittedAt,
      createdAt: articles.createdAt,
      articleTier: articles.articleTier,
      formResponseId: articles.formResponseId,
    })
    .from(articles)
    .leftJoin(authors, eq(articles.authorId, authors.id))
    .orderBy(articles.title)

  // Group by normalized title + author
  const groups = new Map<string, typeof allArticles>()

  for (const article of allArticles) {
    // Normalize title: lowercase, remove extra spaces, trim
    const normalizedTitle = article.title
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()

    // Create key from title + author email
    const key = `${normalizedTitle}|${article.authorEmail?.toLowerCase() || ''}`

    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(article)
  }

  // Filter to only groups with duplicates
  const duplicateGroups = Array.from(groups.entries())
    .filter(([_, articles]) => articles.length > 1)
    .map(([key, articles]) => ({
      key,
      articles: articles.map((a) => ({
        ...a,
        submittedAt: a.submittedAt?.toISOString() || null,
        createdAt: a.createdAt.toISOString(),
      })),
    }))

  return {
    totalArticles: allArticles.length,
    duplicateGroups,
    totalDuplicates: duplicateGroups.reduce(
      (sum, g) => sum + g.articles.length - 1,
      0
    ),
  }
})

// Server function to delete an article
const deleteArticle = createServerFn({ method: 'POST' })
  .validator((data: { articleId: string }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('@db/index')
    const { articles, attachments, articleMultimediaTypes } = await import(
      '@db/schema'
    )
    const { eq } = await import('drizzle-orm')
    const { getStorage } = await import('../../storage')

    // Get attachments to delete files
    const articleAttachments = await db.query.attachments.findMany({
      where: eq(attachments.articleId, data.articleId),
    })

    // Delete files from storage
    const storage = getStorage()
    for (const attachment of articleAttachments) {
      if (attachment.filePath) {
        try {
          await storage.delete(attachment.filePath)
        } catch {
          // Ignore file deletion errors
        }
      }
    }

    // Delete related records
    await db
      .delete(articleMultimediaTypes)
      .where(eq(articleMultimediaTypes.articleId, data.articleId))
    await db
      .delete(attachments)
      .where(eq(attachments.articleId, data.articleId))
    await db.delete(articles).where(eq(articles.id, data.articleId))

    return { success: true }
  })

export const Route = createFileRoute('/utilities/deduplicate')({
  component: DeduplicatePage,
})

type DuplicateGroup = {
  key: string
  articles: Array<{
    id: string
    title: string
    authorId: string | null
    authorGivenName: string | null
    authorSurname: string | null
    authorEmail: string | null
    internalStatus: string | null
    submittedAt: string | null
    createdAt: string
    articleTier: string | null
    formResponseId: string | null
  }>
}

function DeduplicatePage() {
  const [isLoading, setIsLoading] = useState(true)
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [totalArticles, setTotalArticles] = useState(0)
  const [totalDuplicates, setTotalDuplicates] = useState(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const loadDuplicates = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await findDuplicates()
      setDuplicateGroups(result.duplicateGroups)
      setTotalArticles(result.totalArticles)
      setTotalDuplicates(result.totalDuplicates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load duplicates')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadDuplicates()
  }, [])

  const handleDelete = async (articleId: string, title: string) => {
    if (
      !confirm(
        `Are you sure you want to delete "${title}"? This action cannot be undone.`
      )
    ) {
      return
    }

    setDeletingId(articleId)
    setError(null)

    try {
      await deleteArticle({ data: { articleId } })

      // Update local state
      setDuplicateGroups((groups) =>
        groups
          .map((g) => ({
            ...g,
            articles: g.articles.filter((a) => a.id !== articleId),
          }))
          .filter((g) => g.articles.length > 1)
      )
      setTotalDuplicates((prev) => prev - 1)
      setSuccessMessage(`Deleted "${title}"`)
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete article')
    } finally {
      setDeletingId(null)
    }
  }

  const filteredGroups = duplicateGroups.filter((group) => {
    if (!filter) return true
    const searchLower = filter.toLowerCase()
    return group.articles.some(
      (a) =>
        a.title.toLowerCase().includes(searchLower) ||
        a.authorGivenName?.toLowerCase().includes(searchLower) ||
        a.authorSurname?.toLowerCase().includes(searchLower) ||
        a.authorEmail?.toLowerCase().includes(searchLower)
    )
  })

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <Link
          to="/utilities"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            fontSize: '0.8125rem',
            color: 'var(--fg-muted)',
            textDecoration: 'none',
            marginBottom: '0.75rem',
          }}
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Utilities
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'var(--bg-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Copy className="w-5 h-5" style={{ color: 'var(--fg-muted)' }} />
          </div>
          <div>
            <h1
              style={{
                fontSize: '1.25rem',
                fontWeight: 600,
                color: 'var(--fg-default)',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              Find Duplicates
            </h1>
            <p
              style={{
                fontSize: '0.875rem',
                color: 'var(--fg-muted)',
                margin: '0.25rem 0 0 0',
              }}
            >
              Find and remove duplicate articles
            </p>
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div
        style={{
          padding: '1rem 1.25rem',
          background: 'rgba(37, 99, 235, 0.05)',
          border: '0.5px solid rgba(37, 99, 235, 0.15)',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          display: 'flex',
          gap: '0.75rem',
        }}
      >
        <Info
          className="w-4 h-4"
          style={{
            color: 'rgb(37, 99, 235)',
            flexShrink: 0,
            marginTop: '2px',
          }}
        />
        <div>
          <div
            style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--fg-default)',
              marginBottom: '0.25rem',
            }}
          >
            How Duplicates Are Detected
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)', margin: 0 }}>
            Articles are considered duplicates if they have the same title (case-insensitive) and the same author email. Review each group carefully before deleting.
          </p>
        </div>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(34, 197, 94, 0.05)',
            border: '0.5px solid rgba(34, 197, 94, 0.2)',
            borderRadius: '6px',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem',
            color: 'var(--status-success)',
          }}
        >
          <CheckCircle className="w-4 h-4" />
          {successMessage}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(239, 68, 68, 0.05)',
            border: '0.5px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '6px',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem',
            color: 'var(--status-error)',
          }}
        >
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Main Content */}
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border-default)',
          borderRadius: '8px',
          padding: '1.5rem',
        }}
      >
        {isLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '3rem',
              gap: '0.75rem',
              color: 'var(--fg-muted)',
            }}
          >
            <LoadingSpinner size="md" />
            <span>Scanning for duplicates...</span>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div
              style={{
                display: 'flex',
                gap: '1.5rem',
                marginBottom: '1.5rem',
                paddingBottom: '1rem',
                borderBottom: '0.5px solid var(--border-subtle)',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--fg-muted)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Total Articles
                </div>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 600,
                    color: 'var(--fg-default)',
                  }}
                >
                  {totalArticles}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--fg-muted)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Duplicate Groups
                </div>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 600,
                    color:
                      duplicateGroups.length > 0
                        ? 'var(--status-warning)'
                        : 'var(--status-success)',
                  }}
                >
                  {duplicateGroups.length}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--fg-muted)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Extra Copies
                </div>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 600,
                    color:
                      totalDuplicates > 0
                        ? 'var(--status-warning)'
                        : 'var(--status-success)',
                  }}
                >
                  {totalDuplicates}
                </div>
              </div>
            </div>

            {duplicateGroups.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '2rem',
                  color: 'var(--fg-muted)',
                }}
              >
                <CheckCircle
                  className="w-12 h-12"
                  style={{ color: 'var(--status-success)', margin: '0 auto 1rem' }}
                />
                <div
                  style={{
                    fontSize: '1rem',
                    fontWeight: 500,
                    color: 'var(--fg-default)',
                    marginBottom: '0.25rem',
                  }}
                >
                  No duplicates found
                </div>
                <div style={{ fontSize: '0.875rem' }}>
                  All articles have unique titles per author.
                </div>
              </div>
            ) : (
              <>
                {/* Search */}
                <div style={{ marginBottom: '1rem' }}>
                  <div
                    style={{
                      position: 'relative',
                      maxWidth: '300px',
                    }}
                  >
                    <Search
                      className="w-4 h-4"
                      style={{
                        position: 'absolute',
                        left: '0.75rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--fg-muted)',
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Filter duplicates..."
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      className="input"
                      style={{
                        width: '100%',
                        paddingLeft: '2.25rem',
                      }}
                    />
                  </div>
                </div>

                {/* Duplicate Groups */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {filteredGroups.map((group) => (
                    <div
                      key={group.key}
                      style={{
                        border: '0.5px solid var(--border-default)',
                        borderRadius: '6px',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Group Header */}
                      <div
                        style={{
                          padding: '0.75rem 1rem',
                          background: 'rgba(245, 158, 11, 0.05)',
                          borderBottom: '0.5px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <Merge
                          className="w-4 h-4"
                          style={{ color: 'var(--status-warning)' }}
                        />
                        <span
                          style={{
                            fontSize: '0.8125rem',
                            fontWeight: 500,
                            color: 'var(--fg-default)',
                          }}
                        >
                          {group.articles.length} copies found
                        </span>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--fg-muted)',
                            marginLeft: 'auto',
                          }}
                        >
                          Keep 1, delete {group.articles.length - 1}
                        </span>
                      </div>

                      {/* Articles in Group */}
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: '0.8125rem',
                        }}
                      >
                        <thead>
                          <tr style={{ background: 'var(--bg-subtle)' }}>
                            <th
                              style={{
                                padding: '0.5rem 1rem',
                                textAlign: 'left',
                                fontWeight: 500,
                                color: 'var(--fg-muted)',
                              }}
                            >
                              Title
                            </th>
                            <th
                              style={{
                                padding: '0.5rem 0.75rem',
                                textAlign: 'left',
                                fontWeight: 500,
                                color: 'var(--fg-muted)',
                              }}
                            >
                              Author
                            </th>
                            <th
                              style={{
                                padding: '0.5rem 0.75rem',
                                textAlign: 'left',
                                fontWeight: 500,
                                color: 'var(--fg-muted)',
                              }}
                            >
                              Status
                            </th>
                            <th
                              style={{
                                padding: '0.5rem 0.75rem',
                                textAlign: 'left',
                                fontWeight: 500,
                                color: 'var(--fg-muted)',
                              }}
                            >
                              Submitted
                            </th>
                            <th
                              style={{
                                padding: '0.5rem 0.75rem',
                                textAlign: 'left',
                                fontWeight: 500,
                                color: 'var(--fg-muted)',
                              }}
                            >
                              ID
                            </th>
                            <th
                              style={{
                                padding: '0.5rem 0.75rem',
                                textAlign: 'center',
                                fontWeight: 500,
                                color: 'var(--fg-muted)',
                                width: '80px',
                              }}
                            >
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.articles.map((article, idx) => (
                            <tr
                              key={article.id}
                              style={{
                                borderTop:
                                  idx > 0
                                    ? '0.5px solid var(--border-subtle)'
                                    : 'none',
                              }}
                            >
                              <td
                                style={{
                                  padding: '0.75rem 1rem',
                                  color: 'var(--fg-default)',
                                }}
                              >
                                <Link
                                  to="/article/$articleId"
                                  params={{ articleId: article.id }}
                                  style={{
                                    color: 'var(--fg-default)',
                                    textDecoration: 'none',
                                  }}
                                  className="hover-underline"
                                >
                                  {article.title}
                                </Link>
                              </td>
                              <td
                                style={{
                                  padding: '0.75rem 0.75rem',
                                  color: 'var(--fg-muted)',
                                }}
                              >
                                {article.authorGivenName} {article.authorSurname}
                              </td>
                              <td
                                style={{
                                  padding: '0.75rem 0.75rem',
                                  color: 'var(--fg-muted)',
                                }}
                              >
                                {article.internalStatus || '—'}
                              </td>
                              <td
                                style={{
                                  padding: '0.75rem 0.75rem',
                                  color: 'var(--fg-muted)',
                                }}
                              >
                                {formatDate(article.submittedAt || article.createdAt)}
                              </td>
                              <td
                                style={{
                                  padding: '0.75rem 0.75rem',
                                  color: 'var(--fg-faint)',
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '0.75rem',
                                }}
                              >
                                {article.formResponseId || article.id.slice(0, 8)}
                              </td>
                              <td
                                style={{
                                  padding: '0.75rem 0.75rem',
                                  textAlign: 'center',
                                }}
                              >
                                <button
                                  onClick={() =>
                                    handleDelete(article.id, article.title)
                                  }
                                  disabled={deletingId === article.id}
                                  className="btn btn-secondary"
                                  style={{
                                    padding: '0.25rem 0.5rem',
                                    fontSize: '0.75rem',
                                    gap: '0.25rem',
                                    color: 'var(--status-error)',
                                  }}
                                >
                                  {deletingId === article.id ? (
                                    <LoadingSpinner size="sm" />
                                  ) : (
                                    <Trash2 className="w-3 h-3" />
                                  )}
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>

                {filteredGroups.length === 0 && filter && (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '2rem',
                      color: 'var(--fg-muted)',
                    }}
                  >
                    No duplicates match your filter.
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
