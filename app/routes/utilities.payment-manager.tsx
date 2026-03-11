import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
  ChevronLeft,
  DollarSign,
  Search,
  ExternalLink,
  Mail,
  Banknote,
  Check,
  RefreshCw,
  Calculator,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle,
  User,
  BookOpen,
} from 'lucide-react'
import { createServerFn } from '@tanstack/start'
import { LoadingSpinner, Button, formatDate } from '~/components/Layout'
import { formatCents } from '~/lib/payment-calculator'
import {
  calculateArticlePayment,
  setManualPayment,
  markPaymentComplete,
  updateArticle,
  updateArticleBonusFlags,
  updateArticleTier,
} from '~/lib/mutations'
import { getPaymentRateConfig } from '~/lib/queries'

// Types for unpaid article data
type UnpaidArticle = {
  id: string
  title: string
  articleTier: string
  paymentStatus: boolean
  paymentAmount: number | null
  paymentIsManual: boolean
  paymentRateSnapshot: string | null
  paidAt: string | null
  hasResearchBonus: boolean | null
  hasTimeSensitiveBonus: boolean | null
  hasMultimediaBonus: boolean | null
  hasProfessionalPhotos: boolean | null
  hasProfessionalGraphics: boolean | null
  author: {
    id: string
    givenName: string
    surname: string
    email: string
    authorType: string | null
    autoDepositAvailable: boolean | null
    etransferEmail: string | null
  }
  issue: {
    id: string
    issueNumber: number
    title: string | null
    volume: {
      id: string
      volumeNumber: number
    }
  } | null
  // Legacy fields
  volume: number | null
  issueNumber: number | null
  hasMultimediaTypes: boolean
}

type IssueGroup = {
  issueId: string | null
  issueLabel: string
  volumeLabel: string
  articles: UnpaidArticle[]
  totalPayment: number
}

// Rate config type
interface RateConfig {
  tier1Rate: number
  tier2Rate: number
  tier3Rate: number
  researchBonus: number
  multimediaBonus: number
  timeSensitiveBonus: number
  professionalPhotoBonus: number
  professionalGraphicBonus: number
}

const DEFAULT_RATES: RateConfig = {
  tier1Rate: 2000,
  tier2Rate: 3500,
  tier3Rate: 5000,
  researchBonus: 1000,
  multimediaBonus: 500,
  timeSensitiveBonus: 500,
  professionalPhotoBonus: 1500,
  professionalGraphicBonus: 1500,
}

// Server function to fetch unpaid approved articles grouped by issue
const getUnpaidArticles = createServerFn({ method: 'GET' }).handler(async () => {
  const { db } = await import('@db/index')
  const { articles, authors, issues, volumes, articleMultimediaTypes } = await import('@db/schema')
  const { eq, and, or, isNull } = await import('drizzle-orm')

  // Get all approved articles that are NOT paid
  const unpaidArticles = await db.query.articles.findMany({
    where: and(
      eq(articles.internalStatus, 'Approved'),
      or(eq(articles.paymentStatus, false), isNull(articles.paymentStatus))
    ),
    with: {
      author: true,
      publicationIssue: {
        with: {
          volume: true,
        },
      },
      multimediaTypes: true,
    },
    orderBy: (articles, { desc }) => [desc(articles.updatedAt)],
  })

  return unpaidArticles.map((article) => ({
    id: article.id,
    title: article.title,
    articleTier: article.articleTier || 'Tier 1 (Basic)',
    paymentStatus: article.paymentStatus || false,
    paymentAmount: article.paymentAmount,
    paymentIsManual: article.paymentIsManual || false,
    paymentRateSnapshot: article.paymentRateSnapshot,
    paidAt: article.paidAt ? article.paidAt.toISOString() : null,
    hasResearchBonus: article.hasResearchBonus,
    hasTimeSensitiveBonus: article.hasTimeSensitiveBonus,
    hasMultimediaBonus: article.hasMultimediaBonus,
    hasProfessionalPhotos: article.hasProfessionalPhotos,
    hasProfessionalGraphics: article.hasProfessionalGraphics,
    author: {
      id: article.author.id,
      givenName: article.author.givenName,
      surname: article.author.surname,
      email: article.author.email,
      authorType: article.author.authorType,
      autoDepositAvailable: article.author.autoDepositAvailable,
      etransferEmail: article.author.etransferEmail,
    },
    issue: article.publicationIssue
      ? {
          id: article.publicationIssue.id,
          issueNumber: article.publicationIssue.issueNumber,
          title: article.publicationIssue.title,
          volume: {
            id: article.publicationIssue.volume.id,
            volumeNumber: article.publicationIssue.volume.volumeNumber,
          },
        }
      : null,
    volume: article.volume,
    issueNumber: article.issue,
    hasMultimediaTypes: article.multimediaTypes.some((t) =>
      ['Photo', 'Graphic', 'Video'].includes(t.multimediaType)
    ),
  }))
})

export const Route = createFileRoute('/utilities/payment-manager')({
  component: PaymentManagerPage,
})

function PaymentManagerPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [articles, setArticles] = useState<UnpaidArticle[]>([])
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [expandedArticles, setExpandedArticles] = useState<Set<string>>(new Set())
  const [rateConfig, setRateConfig] = useState<RateConfig>(DEFAULT_RATES)

  const loadArticles = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await getUnpaidArticles()
      setArticles(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load articles')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadArticles()
    getPaymentRateConfig().then((result) => {
      if (result.config) {
        setRateConfig({
          tier1Rate: result.config.tier1Rate,
          tier2Rate: result.config.tier2Rate,
          tier3Rate: result.config.tier3Rate,
          researchBonus: result.config.researchBonus,
          multimediaBonus: result.config.multimediaBonus,
          timeSensitiveBonus: result.config.timeSensitiveBonus,
          professionalPhotoBonus: result.config.professionalPhotoBonus,
          professionalGraphicBonus: result.config.professionalGraphicBonus,
        })
      }
    })
  }, [])

  // Group articles by issue
  const issueGroups: IssueGroup[] = (() => {
    const grouped = new Map<string, IssueGroup>()

    for (const article of articles) {
      let key: string
      let issueLabel: string
      let volumeLabel: string

      if (article.issue) {
        key = article.issue.id
        issueLabel = article.issue.title
          ? `Issue ${article.issue.issueNumber} — ${article.issue.title}`
          : `Issue ${article.issue.issueNumber}`
        volumeLabel = `Volume ${article.issue.volume.volumeNumber}`
      } else if (article.volume && article.issueNumber) {
        key = `legacy-v${article.volume}-i${article.issueNumber}`
        issueLabel = `Issue ${article.issueNumber}`
        volumeLabel = `Volume ${article.volume}`
      } else {
        key = 'unassigned'
        issueLabel = 'Unassigned'
        volumeLabel = 'No Volume'
      }

      if (!grouped.has(key)) {
        grouped.set(key, {
          issueId: article.issue?.id || null,
          issueLabel,
          volumeLabel,
          articles: [],
          totalPayment: 0,
        })
      }

      const group = grouped.get(key)!
      group.articles.push(article)
      group.totalPayment += article.paymentAmount || 0
    }

    return Array.from(grouped.values())
  })()

  // Apply filter
  const filteredGroups = issueGroups
    .map((group) => {
      if (!filter) return group
      const searchLower = filter.toLowerCase()
      const filteredArticles = group.articles.filter(
        (a) =>
          a.title.toLowerCase().includes(searchLower) ||
          a.author.givenName.toLowerCase().includes(searchLower) ||
          a.author.surname.toLowerCase().includes(searchLower) ||
          a.author.email.toLowerCase().includes(searchLower) ||
          group.issueLabel.toLowerCase().includes(searchLower) ||
          group.volumeLabel.toLowerCase().includes(searchLower)
      )
      return { ...group, articles: filteredArticles, totalPayment: filteredArticles.reduce((sum, a) => sum + (a.paymentAmount || 0), 0) }
    })
    .filter((g) => g.articles.length > 0)

  const totalArticles = filteredGroups.reduce((sum, g) => sum + g.articles.length, 0)
  const totalPayment = filteredGroups.reduce((sum, g) => sum + g.totalPayment, 0)

  const toggleExpanded = (articleId: string) => {
    setExpandedArticles((prev) => {
      const next = new Set(prev)
      if (next.has(articleId)) {
        next.delete(articleId)
      } else {
        next.add(articleId)
      }
      return next
    })
  }

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg)
    setTimeout(() => setSuccessMessage(null), 3000)
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
            <Banknote className="w-5 h-5" style={{ color: 'var(--fg-muted)' }} />
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
              Payment Manager
            </h1>
            <p
              style={{
                fontSize: '0.875rem',
                color: 'var(--fg-muted)',
                margin: '0.25rem 0 0 0',
              }}
            >
              Review and process payments for approved, unpaid articles
            </p>
          </div>
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
          <AlertCircle className="w-4 h-4" />
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
            <span>Loading unpaid articles...</span>
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
                <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
                  Unpaid Articles
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--fg-default)' }}>
                  {totalArticles}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
                  Issues
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--fg-default)' }}>
                  {filteredGroups.length}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
                  Total Owed
                </div>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 600,
                    color: totalPayment > 0 ? 'var(--accent)' : 'var(--fg-muted)',
                  }}
                >
                  {totalPayment > 0 ? formatCents(totalPayment) : '—'}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={loadArticles}
                  className="btn btn-secondary"
                  style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem', gap: '0.375rem' }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh
                </button>
              </div>
            </div>

            {articles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--fg-muted)' }}>
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
                  All caught up!
                </div>
                <div style={{ fontSize: '0.875rem' }}>
                  No approved articles with unpaid status found.
                </div>
              </div>
            ) : (
              <>
                {/* Filter */}
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ position: 'relative', maxWidth: '400px' }}>
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
                      placeholder="Filter by article, author, issue, or volume..."
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      className="input"
                      style={{ width: '100%', paddingLeft: '2.25rem' }}
                    />
                  </div>
                </div>

                {/* Issue Groups */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {filteredGroups.map((group) => (
                    <IssueGroupCard
                      key={group.issueId || group.issueLabel}
                      group={group}
                      expandedArticles={expandedArticles}
                      onToggleExpanded={toggleExpanded}
                      rateConfig={rateConfig}
                      onPaymentUpdate={() => {
                        loadArticles()
                        showSuccess('Payment updated')
                      }}
                      onMarkPaid={(articleTitle) => {
                        loadArticles()
                        showSuccess(`Marked "${articleTitle}" as paid`)
                      }}
                    />
                  ))}
                </div>

                {filteredGroups.length === 0 && filter && (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--fg-muted)' }}>
                    No articles match your filter.
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

// Issue Group Card Component
function IssueGroupCard({
  group,
  expandedArticles,
  onToggleExpanded,
  rateConfig,
  onPaymentUpdate,
  onMarkPaid,
}: {
  group: IssueGroup
  expandedArticles: Set<string>
  onToggleExpanded: (id: string) => void
  rateConfig: RateConfig
  onPaymentUpdate: () => void
  onMarkPaid: (title: string) => void
}) {
  return (
    <div
      style={{
        border: '0.5px solid var(--border-default)',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Issue Header */}
      <div
        style={{
          padding: '0.75rem 1rem',
          background: 'var(--bg-subtle)',
          borderBottom: '0.5px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <BookOpen className="w-4 h-4" style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--fg-default)' }}>
            {group.volumeLabel}
          </span>
          <span style={{ fontSize: '0.875rem', color: 'var(--fg-muted)', margin: '0 0.5rem' }}>
            /
          </span>
          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--fg-default)' }}>
            {group.issueLabel}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
            {group.articles.length} article{group.articles.length !== 1 ? 's' : ''}
          </span>
          {group.totalPayment > 0 && (
            <span
              style={{
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--accent)',
                padding: '0.125rem 0.5rem',
                background: 'var(--bg-surface)',
                borderRadius: '4px',
              }}
            >
              {formatCents(group.totalPayment)}
            </span>
          )}
        </div>
      </div>

      {/* Articles */}
      <div>
        {group.articles.map((article, idx) => (
          <ArticlePaymentRow
            key={article.id}
            article={article}
            isExpanded={expandedArticles.has(article.id)}
            onToggleExpanded={() => onToggleExpanded(article.id)}
            isLast={idx === group.articles.length - 1}
            rateConfig={rateConfig}
            onPaymentUpdate={onPaymentUpdate}
            onMarkPaid={() => onMarkPaid(article.title)}
          />
        ))}
      </div>
    </div>
  )
}

// Article Payment Row Component
function ArticlePaymentRow({
  article,
  isExpanded,
  onToggleExpanded,
  isLast,
  rateConfig,
  onPaymentUpdate,
  onMarkPaid,
}: {
  article: UnpaidArticle
  isExpanded: boolean
  onToggleExpanded: () => void
  isLast: boolean
  rateConfig: RateConfig
  onPaymentUpdate: () => void
  onMarkPaid: () => void
}) {
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [showManualInput, setShowManualInput] = useState(false)
  const [manualAmount, setManualAmount] = useState('')
  const [isSavingManual, setIsSavingManual] = useState(false)
  const [isMarkingPaid, setIsMarkingPaid] = useState(false)
  const [localPaymentAmount, setLocalPaymentAmount] = useState(article.paymentAmount)
  const [localBreakdown, setLocalBreakdown] = useState(() => {
    try {
      return article.paymentRateSnapshot ? JSON.parse(article.paymentRateSnapshot) : null
    } catch {
      return null
    }
  })

  const isEligibleForPayment = !['Faculty', 'Staff'].includes(article.author.authorType || '')

  const getTierBaseRate = () => {
    switch (article.articleTier) {
      case 'Tier 1 (Basic)':
        return rateConfig.tier1Rate
      case 'Tier 2 (Standard)':
        return rateConfig.tier2Rate
      case 'Tier 3 (Advanced)':
        return rateConfig.tier3Rate
      default:
        return rateConfig.tier1Rate
    }
  }

  const handleRecalculate = async () => {
    setIsRecalculating(true)
    try {
      const result = await calculateArticlePayment({ data: { articleId: article.id, recalculate: true } })
      if (result.success && result.calculation) {
        setLocalBreakdown(result.calculation)
        setLocalPaymentAmount(result.calculation.totalAmount)
      }
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
      await setManualPayment({ data: { articleId: article.id, amount: Math.round(amount * 100) } })
      setLocalPaymentAmount(Math.round(amount * 100))
      setShowManualInput(false)
      setManualAmount('')
      onPaymentUpdate()
    } catch (error) {
      console.error('Failed to set manual payment:', error)
    } finally {
      setIsSavingManual(false)
    }
  }

  const handleMarkAsPaid = async () => {
    if (!localPaymentAmount) return
    setIsMarkingPaid(true)
    try {
      await markPaymentComplete({ data: { articleId: article.id, amount: localPaymentAmount } })
      onMarkPaid()
    } catch (error) {
      console.error('Failed to mark as paid:', error)
    } finally {
      setIsMarkingPaid(false)
    }
  }

  const breakdown = localBreakdown

  return (
    <div
      style={{
        borderBottom: isLast ? 'none' : '0.5px solid var(--border-subtle)',
      }}
    >
      {/* Article Summary Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.75rem 1rem',
          cursor: 'pointer',
        }}
        onClick={onToggleExpanded}
      >
        {/* Expand toggle */}
        <div style={{ flexShrink: 0, color: 'var(--fg-muted)' }}>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>

        {/* Article + Author Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'var(--fg-default)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={article.title}
          >
            {article.title}
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--fg-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginTop: '0.125rem',
            }}
          >
            <User className="w-3 h-3" />
            <span>
              {article.author.givenName} {article.author.surname}
            </span>
            <span style={{ color: 'var(--fg-faint)' }}>|</span>
            <span>{article.author.email}</span>
            {article.author.etransferEmail && article.author.autoDepositAvailable && (
              <>
                <span style={{ color: 'var(--fg-faint)' }}>|</span>
                <Banknote className="w-3 h-3" style={{ color: 'var(--status-success)' }} />
                <span style={{ color: 'var(--status-success)' }}>{article.author.etransferEmail}</span>
              </>
            )}
          </div>
        </div>

        {/* Eligibility Warning */}
        {!isEligibleForPayment && (
          <span
            style={{
              fontSize: '0.6875rem',
              padding: '0.125rem 0.5rem',
              borderRadius: '4px',
              background: 'var(--status-warning-bg)',
              color: 'var(--status-warning)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {article.author.authorType} — Not Eligible
          </span>
        )}

        {/* Tier Badge */}
        <span
          style={{
            fontSize: '0.6875rem',
            padding: '0.125rem 0.5rem',
            borderRadius: '4px',
            background: 'var(--bg-subtle)',
            color: 'var(--fg-muted)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {article.articleTier}
        </span>

        {/* Payment Amount */}
        <div
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: localPaymentAmount ? 'var(--accent)' : 'var(--fg-faint)',
            minWidth: '70px',
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          {localPaymentAmount ? formatCents(localPaymentAmount) : '—'}
        </div>

        {/* View Article Link */}
        <Link
          to="/article/$articleId"
          params={{ articleId: article.id }}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: '0.75rem',
            color: 'var(--accent)',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {/* Expanded Payment Section */}
      {isExpanded && (
        <div
          style={{
            padding: '0 1rem 1rem 2.75rem',
          }}
        >
          <div
            style={{
              background: 'var(--bg-subtle)',
              borderRadius: '8px',
              padding: '1rem',
            }}
          >
            {/* Author Details Row */}
            <div
              style={{
                display: 'flex',
                gap: '1.5rem',
                marginBottom: '1rem',
                paddingBottom: '0.75rem',
                borderBottom: '0.5px solid var(--border-subtle)',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--fg-muted)', marginBottom: '0.125rem' }}>
                  Author
                </div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--fg-default)' }}>
                  {article.author.givenName} {article.author.surname}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--fg-muted)', marginBottom: '0.125rem' }}>
                  Email
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <Mail className="w-3 h-3" style={{ color: 'var(--fg-muted)' }} />
                  {article.author.email}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--fg-muted)', marginBottom: '0.125rem' }}>
                  Auto-Deposit
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  {article.author.autoDepositAvailable && article.author.etransferEmail ? (
                    <>
                      <Banknote className="w-3 h-3" style={{ color: 'var(--status-success)' }} />
                      <span style={{ color: 'var(--status-success)' }}>
                        {article.author.etransferEmail}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--fg-faint)' }}>Not available</span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--fg-muted)', marginBottom: '0.125rem' }}>
                  Author Type
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--fg-default)' }}>
                  {article.author.authorType || '—'}
                </div>
              </div>
            </div>

            {/* Not Eligible Warning */}
            {!isEligibleForPayment && (
              <div
                className="flex items-start gap-3 p-3 rounded-lg"
                style={{ background: 'var(--status-warning-bg)', marginBottom: '0.75rem' }}
              >
                <AlertCircle
                  className="w-4 h-4 mt-0.5 flex-shrink-0"
                  style={{ color: 'var(--status-warning)' }}
                />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--status-warning)' }}>
                    Not Eligible for Payment
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--fg-muted)' }}>
                    {article.author.authorType} members are not eligible for article payment
                  </p>
                </div>
              </div>
            )}

            {/* Payment Amount Display */}
            <div className="flex items-center gap-3" style={{ marginBottom: '0.75rem' }}>
              <div className="icon-container">
                <DollarSign className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--fg-default)' }}>
                  {localPaymentAmount ? formatCents(localPaymentAmount) : 'Not set'}
                </p>
                <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                  {article.paymentIsManual ? 'Manual' : 'Calculated'}
                </p>
              </div>
            </div>

            {/* Payment Breakdown */}
            {breakdown && !article.paymentIsManual && (
              <div
                className="p-3 rounded-lg text-sm space-y-2"
                style={{ background: 'var(--bg-surface)', marginBottom: '0.75rem' }}
              >
                <div className="flex justify-between">
                  <span style={{ color: 'var(--fg-muted)' }}>{breakdown.tierName}</span>
                  <span style={{ color: 'var(--fg-default)' }}>{formatCents(breakdown.tierRate)}</span>
                </div>
                {breakdown.bonuses?.map((bonus: { type: string; amount: number }, idx: number) => (
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
            <div className="space-y-2" style={{ marginBottom: '0.75rem' }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium" style={{ color: 'var(--fg-muted)' }}>
                  Tier & Bonuses
                </p>
              </div>

              {/* Tier Selector */}
              <div
                className="flex items-center justify-between p-2 rounded"
                style={{ background: 'var(--bg-surface)' }}
              >
                <div>
                  <p className="text-sm" style={{ color: 'var(--fg-default)' }}>
                    Article Tier
                  </p>
                  <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                    Base rate: {formatCents(getTierBaseRate())}
                  </p>
                </div>
                <div className="relative">
                  <select
                    value={article.articleTier}
                    onChange={async (e) => {
                      try {
                        await updateArticleTier({ data: { articleId: article.id, tier: e.target.value } })
                        handleRecalculate()
                      } catch (err) {
                        console.error('Failed to update tier:', err)
                      }
                    }}
                    className="text-xs px-2 py-1 rounded appearance-none pr-6"
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--fg-default)',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="Tier 1 (Basic)">Tier 1 (Basic)</option>
                    <option value="Tier 2 (Standard)">Tier 2 (Standard)</option>
                    <option value="Tier 3 (Advanced)">Tier 3 (Advanced)</option>
                  </select>
                </div>
              </div>

              {/* Bonus Toggles */}
              <InlineBonusToggle
                articleId={article.id}
                label="Multimedia Bonus"
                description={`Original photos, graphics, or video (+${formatCents(rateConfig.multimediaBonus)})`}
                field="hasMultimediaBonus"
                isActive={
                  article.hasMultimediaBonus !== null
                    ? article.hasMultimediaBonus
                    : article.hasMultimediaTypes
                }
                onToggle={handleRecalculate}
              />
              <InlineBonusToggle
                articleId={article.id}
                label="Research Bonus"
                description={`Extensive research or interviews (+${formatCents(rateConfig.researchBonus)})`}
                field="hasResearchBonus"
                isActive={article.hasResearchBonus || false}
                onToggle={handleRecalculate}
              />
              <InlineBonusToggle
                articleId={article.id}
                label="Time-Sensitive"
                description={`Short notice or breaking news (+${formatCents(rateConfig.timeSensitiveBonus)})`}
                field="hasTimeSensitiveBonus"
                isActive={article.hasTimeSensitiveBonus || false}
                onToggle={handleRecalculate}
              />
              <InlineBonusToggle
                articleId={article.id}
                label="Professional Photos"
                description={`High-quality professional photos (+${formatCents(rateConfig.professionalPhotoBonus)})`}
                field="hasProfessionalPhotos"
                isActive={article.hasProfessionalPhotos || false}
                onToggle={handleRecalculate}
              />
              <InlineBonusToggle
                articleId={article.id}
                label="Professional Graphics"
                description={`Professional graphics/infographics (+${formatCents(rateConfig.professionalGraphicBonus)})`}
                field="hasProfessionalGraphics"
                isActive={article.hasProfessionalGraphics || false}
                onToggle={handleRecalculate}
              />
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {localPaymentAmount && localPaymentAmount > 0 && (
                <Button variant="primary" size="sm" onClick={handleMarkAsPaid} disabled={isMarkingPaid}>
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
              <button
                type="button"
                className="btn btn-ghost text-xs px-2 py-1"
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
              </button>
              <button
                type="button"
                className="btn btn-ghost text-xs px-2 py-1"
                onClick={() => setShowManualInput(!showManualInput)}
              >
                <Calculator className="w-3 h-3 mr-1" />
                {showManualInput ? 'Cancel' : 'Set Manual'}
              </button>
            </div>

            {/* Manual Amount Input */}
            {showManualInput && (
              <div className="flex gap-2 mt-2">
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
                    placeholder={localPaymentAmount ? (localPaymentAmount / 100).toFixed(2) : '0.00'}
                    className="input pl-9 w-full"
                    onClick={(e) => e.stopPropagation()}
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
        </div>
      )}
    </div>
  )
}

// Inline Bonus Toggle (simplified, no separate component import needed)
function InlineBonusToggle({
  articleId,
  label,
  description,
  field,
  isActive,
  onToggle,
}: {
  articleId: string
  label: string
  description: string
  field: string
  isActive: boolean
  onToggle: () => void
}) {
  const [isToggling, setIsToggling] = useState(false)
  const [localActive, setLocalActive] = useState(isActive)

  const handleToggle = async () => {
    if (isToggling) return
    const newValue = !localActive
    setLocalActive(newValue)
    setIsToggling(true)
    try {
      await updateArticleBonusFlags({
        data: {
          articleId,
          [field]: newValue,
        },
      })
      onToggle()
    } catch (error) {
      console.error('Failed to toggle bonus:', error)
      setLocalActive(!newValue)
    } finally {
      setIsToggling(false)
    }
  }

  return (
    <div
      className="flex items-center justify-between p-2 rounded"
      style={{ background: 'var(--bg-surface)' }}
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
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          handleToggle()
        }}
        disabled={isToggling}
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{
          background: localActive ? 'var(--status-success-bg)' : 'var(--bg-muted)',
          color: localActive ? 'var(--status-success)' : 'var(--fg-muted)',
          cursor: 'pointer',
        }}
      >
        {isToggling ? '...' : localActive ? 'Yes' : 'No'}
      </button>
    </div>
  )
}
