import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { FileText, List, Columns, BookOpen } from 'lucide-react'
import { EmptyState, Button } from '~/components/Layout'
import { getArticles, getIssueById, getVolumeById } from '~/lib/queries'
import { getDefaultView, type SavedViewConfig } from '~/lib/mutations'
import {
  FilterBar,
  ListView,
  BoardView,
  IssueView,
  SavedViewSelector,
  type ViewMode,
  type SortField,
  type SortOrder,
  type Article,
} from '~/components/articles'

// Search params schema
type ArticlesSearch = {
  status?: string
  tier?: string
  search?: string
  authorId?: string
  issueId?: string
  volumeId?: string
  page?: number
  view?: ViewMode
  volume?: number
  issue?: number
  sortBy?: SortField
  sortOrder?: SortOrder
  savedViewId?: string // Track active saved view
}

export const Route = createFileRoute('/articles')({
  component: ArticlesPage,
  staleTime: 30_000,
  gcTime: 5 * 60 * 1000,
  validateSearch: (search: Record<string, unknown>): ArticlesSearch => {
    return {
      status: search.status as string | undefined,
      tier: search.tier as string | undefined,
      search: search.search as string | undefined,
      authorId: search.authorId as string | undefined,
      issueId: search.issueId as string | undefined,
      volumeId: search.volumeId as string | undefined,
      page: Number(search.page) || 1,
      view: (search.view as ViewMode) || 'list',
      volume: search.volume ? Number(search.volume) : undefined,
      issue: search.issue ? Number(search.issue) : undefined,
      sortBy: search.sortBy as SortField | undefined,
      sortOrder: search.sortOrder as SortOrder | undefined,
      savedViewId: search.savedViewId as string | undefined,
    }
  },
})

function ArticlesPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [searchInput, setSearchInput] = useState(search.search || '')
  const [data, setData] = useState<{
    articles: Article[]
    total: number
    page: number
    totalPages: number
  }>({ articles: [], total: 0, page: 1, totalPages: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [filterInfo, setFilterInfo] = useState<{
    volumeNumber?: number
    volumeYear?: number | null
    issueNumber?: number
    issueTitle?: string | null
  } | null>(null)
  const hasLoadedDefaultView = useRef(false)

  // Load default view on mount (only if no search params are set)
  useEffect(() => {
    if (hasLoadedDefaultView.current) return
    hasLoadedDefaultView.current = true

    // If we already have a savedViewId in URL, we're good (persisted from before)
    if (search.savedViewId) return

    const hasSearchParams = search.status || search.tier || search.search ||
                           search.sortBy || search.view !== 'list'

    if (!hasSearchParams) {
      getDefaultView().then((result) => {
        if (result.success && result.view) {
          navigate({
            search: {
              page: 1,
              status: result.view.status || undefined,
              tier: result.view.tier || undefined,
              search: result.view.search || undefined,
              sortBy: result.view.sortBy as SortField | undefined,
              sortOrder: result.view.sortOrder as SortOrder | undefined,
              view: (result.view.viewMode as ViewMode) || 'list',
              savedViewId: result.view.id,
            },
            replace: true,
          })
          if (result.view.search) {
            setSearchInput(result.view.search)
          }
        }
      })
    }
  }, [])

  // Fetch filter info when filtering by volume or issue
  useEffect(() => {
    if (search.issueId) {
      getIssueById({ data: { id: search.issueId } }).then((result) => {
        if (result.issue) {
          setFilterInfo({
            volumeNumber: result.issue.volume?.volumeNumber,
            volumeYear: result.issue.volume?.year,
            issueNumber: result.issue.issueNumber,
            issueTitle: result.issue.title,
          })
        }
      })
    } else if (search.volumeId) {
      getVolumeById({ data: { id: search.volumeId } }).then((result) => {
        if (result.volume) {
          setFilterInfo({
            volumeNumber: result.volume.volumeNumber,
            volumeYear: result.volume.year,
          })
        }
      })
    } else {
      setFilterInfo(null)
    }
  }, [search.issueId, search.volumeId])

  // Fetch articles when search params change
  useEffect(() => {
    setIsLoading(true)
    const params: Record<string, any> = { page: search.page || 1 }
    if (search.status) params.status = search.status
    if (search.tier) params.tier = search.tier
    if (search.search) params.search = search.search
    if (search.authorId) params.authorId = search.authorId
    if (search.issueId) params.issueId = search.issueId
    if (search.volumeId) params.volumeId = search.volumeId
    if (search.sortBy) params.sortBy = search.sortBy
    if (search.sortOrder) params.sortOrder = search.sortOrder

    getArticles({ data: params })
      .then((result) => {
        setData(result)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('Failed to fetch articles:', err)
        setIsLoading(false)
      })
  }, [search.status, search.tier, search.search, search.authorId, search.issueId, search.volumeId, search.page, search.sortBy, search.sortOrder])

  const { articles, total, page, totalPages } = data
  const hasFilters = search.status || search.tier || search.search
  const viewMode = search.view || 'list'
  const sortBy = search.sortBy
  const sortOrder = search.sortOrder || 'desc'

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    navigate({
      search: (prev) => ({ ...prev, search: searchInput || undefined, page: 1, savedViewId: undefined }),
    })
  }

  const handleFilterChange = (key: string, value: string) => {
    navigate({
      search: (prev) => ({
        ...prev,
        [key]: value || undefined,
        page: 1,
        savedViewId: undefined, // Clear active view on manual filter change
      }),
    })
  }

  const handlePageChange = (newPage: number) => {
    navigate({
      search: (prev) => ({ ...prev, page: newPage }),
    })
  }

  const handleViewChange = (view: ViewMode) => {
    navigate({
      search: (prev) => ({ ...prev, view, page: 1, savedViewId: undefined }),
    })
  }

  const handleSort = (field: SortField) => {
    navigate({
      search: (prev) => ({
        ...prev,
        sortBy: field,
        sortOrder: prev.sortBy === field && prev.sortOrder === 'asc' ? 'desc' : 'asc',
        page: 1,
        savedViewId: undefined, // Clear active view on manual sort change
      }),
    })
  }

  const handleSelectView = (config: SavedViewConfig, viewId: string) => {
    navigate({
      search: {
        page: 1,
        status: config.status || undefined,
        tier: config.tier || undefined,
        search: config.search || undefined,
        sortBy: config.sortBy as SortField | undefined,
        sortOrder: config.sortOrder as SortOrder | undefined,
        view: (config.viewMode as ViewMode) || 'list',
        savedViewId: viewId,
      },
    })
    if (config.search) {
      setSearchInput(config.search)
    } else {
      setSearchInput('')
    }
  }

  const handleActiveViewChange = (viewId: string | undefined) => {
    navigate({
      search: (prev) => ({ ...prev, savedViewId: viewId }),
    })
  }

  // Build current config for saved views
  const currentConfig: SavedViewConfig = {
    status: search.status,
    tier: search.tier,
    search: search.search,
    sortBy: search.sortBy,
    sortOrder: search.sortOrder,
    viewMode: viewMode,
  }

  const clearPublicationFilter = () => {
    navigate({
      search: (prev) => ({
        ...prev,
        issueId: undefined,
        volumeId: undefined,
        page: 1,
      }),
    })
  }

  const handleClearFilters = () => {
    navigate({ search: { page: 1 } })
  }

  // Group articles by status for board view
  const articlesByStatus = articles.reduce((acc: Record<string, Article[]>, article) => {
    const status = article.internalStatus || 'Draft'
    if (!acc[status]) acc[status] = []
    acc[status].push(article)
    return acc
  }, {})

  // Group articles by volume/issue for issue view
  const articlesByIssue = articles.reduce((acc: Record<string, { articles: Article[]; volumeNumber?: number; issueNumber?: number }>, article) => {
    let key: string
    let volumeNumber: number | undefined
    let issueNumber: number | undefined

    if (article.publicationIssue) {
      volumeNumber = article.publicationIssue.volume?.volumeNumber
      issueNumber = article.publicationIssue.issueNumber
      key = `vol-${volumeNumber}-issue-${issueNumber}`
    } else if (article.volume && article.issue) {
      volumeNumber = article.volume
      issueNumber = article.issue
      key = `vol-${article.volume}-issue-${article.issue}`
    } else if (article.volume) {
      volumeNumber = article.volume
      key = `vol-${article.volume}`
    } else {
      key = 'unassigned'
    }

    if (!acc[key]) {
      acc[key] = { articles: [], volumeNumber, issueNumber }
    }
    acc[key].articles.push(article)
    return acc
  }, {})

  // Sort issue keys (newest volume/issue first)
  const sortedIssueKeys = Object.keys(articlesByIssue).sort((a, b) => {
    if (a === 'unassigned') return 1
    if (b === 'unassigned') return -1
    const aData = articlesByIssue[a]
    const bData = articlesByIssue[b]
    if (aData.volumeNumber !== bData.volumeNumber) {
      return (bData.volumeNumber || 0) - (aData.volumeNumber || 0)
    }
    return (bData.issueNumber || 0) - (aData.issueNumber || 0)
  })

  // Build page title based on filters
  const getPageTitle = () => {
    if (filterInfo) {
      if (filterInfo.issueNumber !== undefined) {
        return `Volume ${filterInfo.volumeNumber} · Issue ${filterInfo.issueNumber}${filterInfo.issueTitle ? ` - ${filterInfo.issueTitle}` : ''}`
      }
      return `Volume ${filterInfo.volumeNumber}${filterInfo.volumeYear ? ` (${filterInfo.volumeYear})` : ''}`
    }
    return 'Articles'
  }

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h1 className="page-title">{getPageTitle()}</h1>
            {filterInfo && (
              <button
                onClick={clearPublicationFilter}
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--fg-muted)' }}
              >
                × Clear
              </button>
            )}
          </div>
          <p className="page-subtitle">
            {isLoading ? 'Loading...' : `${total} ${total === 1 ? 'article' : 'articles'}${hasFilters ? ' matching filters' : ''}`}
          </p>
        </div>

        {/* Saved Views and View Mode Toggle */}
        <div className="flex items-center gap-3">
          <SavedViewSelector
            currentConfig={currentConfig}
            onSelectView={handleSelectView}
            activeViewId={search.savedViewId}
            onActiveViewChange={handleActiveViewChange}
          />
          <div
            className="flex items-center gap-1 p-1 rounded-lg"
            style={{ background: 'var(--bg-subtle)' }}
          >
            <button
              onClick={() => handleViewChange('list')}
              className={`btn !p-2 ${viewMode === 'list' ? 'btn-secondary' : 'btn-ghost'}`}
              title="List View"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleViewChange('board')}
              className={`btn !p-2 ${viewMode === 'board' ? 'btn-secondary' : 'btn-ghost'}`}
              title="Board View (by Status)"
            >
              <Columns className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleViewChange('issue')}
              className={`btn !p-2 ${viewMode === 'issue' ? 'btn-secondary' : 'btn-ghost'}`}
              title="Issue View"
            >
              <BookOpen className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <FilterBar
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        onSearchSubmit={handleSearch}
        statusFilter={search.status || ''}
        tierFilter={search.tier || ''}
        onFilterChange={handleFilterChange}
        hasFilters={!!hasFilters}
        onClearFilters={handleClearFilters}
      />

      {/* Content based on view mode */}
      {articles.length === 0 ? (
        <div
          className="rounded-lg overflow-hidden"
          style={{
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-default)',
          }}
        >
          <EmptyState
            icon={FileText}
            title="No articles found"
            description={
              hasFilters
                ? 'Try adjusting your filters'
                : 'Articles submitted via Microsoft Forms will appear here'
            }
          />
        </div>
      ) : viewMode === 'board' ? (
        <BoardView articlesByStatus={articlesByStatus} />
      ) : viewMode === 'issue' ? (
        <IssueView articlesByIssue={articlesByIssue} sortedIssueKeys={sortedIssueKeys} />
      ) : (
        <ListView
          articles={articles}
          total={total}
          page={page}
          totalPages={totalPages}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  )
}
