import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { FileText, List, Columns, BookOpen, Plus, X } from 'lucide-react'
import { EmptyState, Button, LoadingSpinner } from '~/components/Layout'
import { getArticles, getIssueById, getVolumeById, getAuthors } from '~/lib/queries'
import { getDefaultView, createArticle, type SavedViewConfig } from '~/lib/mutations'
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
  const [isLoadingDefaultView, setIsLoadingDefaultView] = useState(false)

  // Add Article Modal State
  const [showAddModal, setShowAddModal] = useState(false)
  const [authors, setAuthors] = useState<{ id: string; givenName: string; surname: string; email: string }[]>([])
  const [isLoadingAuthors, setIsLoadingAuthors] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newArticle, setNewArticle] = useState({
    title: '',
    authorId: '',
    authorGivenName: '',
    authorSurname: '',
    authorEmail: '',
    articleTier: 'Tier 1 (Basic)',
    prefersAnonymity: false,
    useNewAuthor: false,
  })

  // Load default view when navigating to /articles with no params
  useEffect(() => {
    // Skip if already loading or if we have a savedViewId
    if (isLoadingDefaultView || search.savedViewId) return

    // Check if URL has any meaningful params (user-set filters/sort/specific filters)
    const hasSearchParams = search.status || search.tier || search.search ||
                           search.sortBy || search.sortOrder || search.view !== 'list' ||
                           search.issueId || search.volumeId || search.authorId

    // Only load default view if URL is "clean" (no filters, no saved view)
    if (!hasSearchParams) {
      setIsLoadingDefaultView(true)
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
        setIsLoadingDefaultView(false)
      }).catch(() => {
        setIsLoadingDefaultView(false)
      })
    }
  }, [search.savedViewId, search.status, search.tier, search.search, search.sortBy, search.sortOrder, search.view, search.issueId, search.volumeId, search.authorId])

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

  // Load authors when modal opens
  const handleOpenAddModal = async () => {
    setShowAddModal(true)
    setIsLoadingAuthors(true)
    try {
      const result = await getAuthors()
      setAuthors(result.authors || [])
    } catch (error) {
      console.error('Failed to load authors:', error)
    } finally {
      setIsLoadingAuthors(false)
    }
  }

  const handleCloseAddModal = () => {
    setShowAddModal(false)
    setNewArticle({
      title: '',
      authorId: '',
      authorGivenName: '',
      authorSurname: '',
      authorEmail: '',
      articleTier: 'Tier 1 (Basic)',
      prefersAnonymity: false,
      useNewAuthor: false,
    })
  }

  const handleCreateArticle = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newArticle.title) {
      alert('Title is required')
      return
    }
    if (!newArticle.useNewAuthor && !newArticle.authorId) {
      alert('Please select an author or create a new one')
      return
    }
    if (newArticle.useNewAuthor && (!newArticle.authorGivenName || !newArticle.authorSurname || !newArticle.authorEmail)) {
      alert('Please fill in all author fields')
      return
    }

    setIsCreating(true)
    try {
      const result = await createArticle({
        data: {
          title: newArticle.title,
          authorId: newArticle.useNewAuthor ? undefined : newArticle.authorId,
          authorGivenName: newArticle.useNewAuthor ? newArticle.authorGivenName : undefined,
          authorSurname: newArticle.useNewAuthor ? newArticle.authorSurname : undefined,
          authorEmail: newArticle.useNewAuthor ? newArticle.authorEmail : undefined,
          articleTier: newArticle.articleTier,
          prefersAnonymity: newArticle.prefersAnonymity,
        },
      })
      if (result.success && result.articleId) {
        handleCloseAddModal()
        // Navigate to the new article
        navigate({ to: '/article/$articleId', params: { articleId: result.articleId } })
      } else {
        alert('Failed to create article: ' + (result.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to create article:', error)
      alert('Failed to create article')
    } finally {
      setIsCreating(false)
    }
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

        {/* Add Article Button, Saved Views, and View Mode Toggle */}
        <div className="flex items-center gap-3">
          <Button onClick={handleOpenAddModal} variant="primary" size="sm">
            <Plus className="w-4 h-4" />
            Add Article
          </Button>
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

      {/* Add Article Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          onClick={handleCloseAddModal}
        >
          <div
            className="w-full max-w-lg rounded-lg shadow-xl"
            style={{ background: 'var(--bg-surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: '1px solid var(--border-default)' }}
            >
              <h2 className="font-semibold" style={{ color: 'var(--fg-default)' }}>
                Add New Article
              </h2>
              <button onClick={handleCloseAddModal} className="btn btn-ghost !p-2">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateArticle} className="p-4 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--fg-default)' }}>
                  Title <span style={{ color: 'var(--status-error)' }}>*</span>
                </label>
                <input
                  type="text"
                  value={newArticle.title}
                  onChange={(e) => setNewArticle({ ...newArticle, title: e.target.value })}
                  className="input w-full"
                  placeholder="Article title"
                  required
                />
              </div>

              {/* Author Selection */}
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--fg-default)' }}>
                  Author <span style={{ color: 'var(--status-error)' }}>*</span>
                </label>

                <div className="flex items-center gap-4 mb-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      checked={!newArticle.useNewAuthor}
                      onChange={() => setNewArticle({ ...newArticle, useNewAuthor: false })}
                    />
                    Existing Author
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      checked={newArticle.useNewAuthor}
                      onChange={() => setNewArticle({ ...newArticle, useNewAuthor: true })}
                    />
                    New Author
                  </label>
                </div>

                {!newArticle.useNewAuthor ? (
                  isLoadingAuthors ? (
                    <div className="flex items-center gap-2 py-2">
                      <LoadingSpinner size="sm" />
                      <span className="text-sm" style={{ color: 'var(--fg-muted)' }}>Loading authors...</span>
                    </div>
                  ) : (
                    <select
                      value={newArticle.authorId}
                      onChange={(e) => setNewArticle({ ...newArticle, authorId: e.target.value })}
                      className="select-trigger w-full"
                    >
                      <option value="">Select an author...</option>
                      {authors.map((author) => (
                        <option key={author.id} value={author.id}>
                          {author.givenName} {author.surname} ({author.email})
                        </option>
                      ))}
                    </select>
                  )
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={newArticle.authorGivenName}
                        onChange={(e) => setNewArticle({ ...newArticle, authorGivenName: e.target.value })}
                        className="input"
                        placeholder="First name"
                      />
                      <input
                        type="text"
                        value={newArticle.authorSurname}
                        onChange={(e) => setNewArticle({ ...newArticle, authorSurname: e.target.value })}
                        className="input"
                        placeholder="Last name"
                      />
                    </div>
                    <input
                      type="email"
                      value={newArticle.authorEmail}
                      onChange={(e) => setNewArticle({ ...newArticle, authorEmail: e.target.value })}
                      className="input w-full"
                      placeholder="Email address"
                    />
                  </div>
                )}
              </div>

              {/* Tier */}
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--fg-default)' }}>
                  Article Tier
                </label>
                <select
                  value={newArticle.articleTier}
                  onChange={(e) => setNewArticle({ ...newArticle, articleTier: e.target.value })}
                  className="select-trigger w-full"
                >
                  <option value="Tier 1 (Basic)">Tier 1 (Basic)</option>
                  <option value="Tier 2 (Standard)">Tier 2 (Standard)</option>
                  <option value="Tier 3 (Advanced)">Tier 3 (Advanced)</option>
                </select>
              </div>

              {/* Anonymity */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newArticle.prefersAnonymity}
                    onChange={(e) => setNewArticle({ ...newArticle, prefersAnonymity: e.target.checked })}
                  />
                  <span className="text-sm" style={{ color: 'var(--fg-default)' }}>
                    Author prefers anonymity
                  </span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={handleCloseAddModal}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isCreating}>
                  {isCreating ? <LoadingSpinner size="sm" /> : 'Create Article'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
