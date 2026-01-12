import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  FileText,
  Search,
  ChevronLeft,
  ChevronRight,
  Paperclip,
  Image,
  DollarSign,
  EyeOff,
  ChevronDown,
  ChevronUp,
  List,
  Columns,
  BookOpen,
  ArrowUpDown,
} from "lucide-react";
import {
  StatusBadge,
  TierBadge,
  EmptyState,
  formatDate,
  Avatar,
  Button,
  Input,
} from "~/components/Layout";
import { getArticles, getIssueById, getVolumeById } from "~/lib/queries";

// Search params schema
type ViewMode = "list" | "board" | "issue";
type SortField = "title" | "author" | "volume" | "status" | "submitted" | "tier";
type SortOrder = "asc" | "desc";

type ArticlesSearch = {
  status?: string;
  tier?: string;
  search?: string;
  authorId?: string;
  issueId?: string;
  volumeId?: string;
  page?: number;
  view?: ViewMode;
  volume?: number;
  issue?: number;
  sortBy?: SortField;
  sortOrder?: SortOrder;
};

export const Route = createFileRoute("/articles")({
  component: ArticlesPage,
  // Cache loader data for 30 seconds to prevent refetching on navigation
  staleTime: 30_000,
  // Keep data in cache for 5 minutes even when inactive
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
      view: (search.view as ViewMode) || "list",
      volume: search.volume ? Number(search.volume) : undefined,
      issue: search.issue ? Number(search.issue) : undefined,
      sortBy: search.sortBy as SortField | undefined,
      sortOrder: search.sortOrder as SortOrder | undefined,
    };
  },
});

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "Draft", label: "Draft" },
  { value: "Pending Review", label: "Pending Review" },
  { value: "In Review", label: "In Review" },
  { value: "Needs Revision", label: "Needs Revision" },
  { value: "Approved", label: "Approved" },
  { value: "In Editing", label: "In Editing" },
  { value: "Ready for Publication", label: "Ready" },
  { value: "Published", label: "Published" },
  { value: "Archived", label: "Archived" },
];

const TIER_OPTIONS = [
  { value: "", label: "All Tiers" },
  { value: "Tier 1 (Basic)", label: "T1 Basic" },
  { value: "Tier 2 (Standard)", label: "T2 Standard" },
  { value: "Tier 3 (Advanced)", label: "T3 Advanced" },
];

function ArticlesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [searchInput, setSearchInput] = useState(search.search || "");
  const [data, setData] = useState<{
    articles: any[];
    total: number;
    page: number;
    totalPages: number;
  }>({ articles: [], total: 0, page: 1, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [filterInfo, setFilterInfo] = useState<{
    volumeNumber?: number;
    volumeYear?: number | null;
    issueNumber?: number;
    issueTitle?: string | null;
  } | null>(null);

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
          });
        }
      });
    } else if (search.volumeId) {
      getVolumeById({ data: { id: search.volumeId } }).then((result) => {
        if (result.volume) {
          setFilterInfo({
            volumeNumber: result.volume.volumeNumber,
            volumeYear: result.volume.year,
          });
        }
      });
    } else {
      setFilterInfo(null);
    }
  }, [search.issueId, search.volumeId]);

  // Fetch articles when search params change
  useEffect(() => {
    setIsLoading(true);
    // Build params object, only including defined values
    const params: Record<string, any> = { page: search.page || 1 };
    if (search.status) params.status = search.status;
    if (search.tier) params.tier = search.tier;
    if (search.search) params.search = search.search;
    if (search.authorId) params.authorId = search.authorId;
    if (search.issueId) params.issueId = search.issueId;
    if (search.volumeId) params.volumeId = search.volumeId;
    if (search.sortBy) params.sortBy = search.sortBy;
    if (search.sortOrder) params.sortOrder = search.sortOrder;

    getArticles({ data: params })
      .then((result) => {
        setData(result);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch articles:", err);
        setIsLoading(false);
      });
  }, [search.status, search.tier, search.search, search.authorId, search.issueId, search.volumeId, search.page, search.sortBy, search.sortOrder]);

  const { articles, total, page, totalPages } = data;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({
      search: (prev) => ({ ...prev, search: searchInput || undefined, page: 1 }),
    });
  };

  const handleFilterChange = (key: string, value: string) => {
    navigate({
      search: (prev) => ({
        ...prev,
        [key]: value || undefined,
        page: 1,
      }),
    });
  };

  const handlePageChange = (newPage: number) => {
    navigate({
      search: (prev) => ({ ...prev, page: newPage }),
    });
  };

  const hasFilters = search.status || search.tier || search.search;
  const viewMode = search.view || "list";
  const sortBy = search.sortBy;
  const sortOrder = search.sortOrder || "desc";

  const handleViewChange = (view: ViewMode) => {
    navigate({
      search: (prev) => ({ ...prev, view, page: 1 }),
    });
  };

  const handleSort = (field: SortField) => {
    navigate({
      search: (prev) => ({
        ...prev,
        sortBy: field,
        sortOrder: prev.sortBy === field && prev.sortOrder === "asc" ? "desc" : "asc",
        page: 1,
      }),
    });
  };

  // Group articles by status for board view
  const articlesByStatus = articles.reduce((acc: Record<string, any[]>, article: any) => {
    const status = article.internalStatus || "Draft";
    if (!acc[status]) acc[status] = [];
    acc[status].push(article);
    return acc;
  }, {});

  // Group articles by volume/issue for issue view
  const articlesByIssue = articles.reduce((acc: Record<string, { articles: any[]; volumeNumber?: number; issueNumber?: number }>, article: any) => {
    let key: string;
    let volumeNumber: number | undefined;
    let issueNumber: number | undefined;

    if (article.publicationIssue) {
      // Use new relationship
      volumeNumber = article.publicationIssue.volume?.volumeNumber;
      issueNumber = article.publicationIssue.issueNumber;
      key = `vol-${volumeNumber}-issue-${issueNumber}`;
    } else if (article.volume && article.issue) {
      // Fallback to legacy fields
      volumeNumber = article.volume;
      issueNumber = article.issue;
      key = `vol-${article.volume}-issue-${article.issue}`;
    } else if (article.volume) {
      volumeNumber = article.volume;
      key = `vol-${article.volume}`;
    } else {
      key = "unassigned";
    }

    if (!acc[key]) {
      acc[key] = { articles: [], volumeNumber, issueNumber };
    }
    acc[key].articles.push(article);
    return acc;
  }, {});

  // Sort issue keys (newest volume/issue first)
  const sortedIssueKeys = Object.keys(articlesByIssue).sort((a, b) => {
    if (a === "unassigned") return 1;
    if (b === "unassigned") return -1;
    const aData = articlesByIssue[a];
    const bData = articlesByIssue[b];
    // Sort by volume desc, then issue desc
    if (aData.volumeNumber !== bData.volumeNumber) {
      return (bData.volumeNumber || 0) - (aData.volumeNumber || 0);
    }
    return (bData.issueNumber || 0) - (aData.issueNumber || 0);
  });

  // Helper to format issue key for display
  const formatIssueLabel = (key: string) => {
    if (key === "unassigned") return "Unassigned";
    const data = articlesByIssue[key];
    if (data.volumeNumber && data.issueNumber) {
      return `Volume ${data.volumeNumber} · Issue ${data.issueNumber}`;
    }
    if (data.volumeNumber) {
      return `Volume ${data.volumeNumber}`;
    }
    return key;
  };

  // Build page title based on filters
  const getPageTitle = () => {
    if (filterInfo) {
      if (filterInfo.issueNumber !== undefined) {
        return `Volume ${filterInfo.volumeNumber} · Issue ${filterInfo.issueNumber}${filterInfo.issueTitle ? ` - ${filterInfo.issueTitle}` : ""}`;
      }
      return `Volume ${filterInfo.volumeNumber}${filterInfo.volumeYear ? ` (${filterInfo.volumeYear})` : ""}`;
    }
    return "Articles";
  };

  const clearPublicationFilter = () => {
    navigate({
      search: (prev) => ({
        ...prev,
        issueId: undefined,
        volumeId: undefined,
        page: 1,
      }),
    });
  };

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 className="page-title">{getPageTitle()}</h1>
            {filterInfo && (
              <button
                onClick={clearPublicationFilter}
                className="btn btn-ghost btn-sm"
                style={{ color: "var(--fg-muted)" }}
              >
                × Clear
              </button>
            )}
          </div>
          <p className="page-subtitle">
            {isLoading ? "Loading..." : `${total} ${total === 1 ? "article" : "articles"}${hasFilters ? " matching filters" : ""}`}
          </p>
        </div>

        {/* View Mode Toggle */}
        <div
          className="flex items-center gap-1 p-1 rounded-lg"
          style={{ background: "var(--bg-subtle)" }}
        >
          <button
            onClick={() => handleViewChange("list")}
            className={`btn !p-2 ${viewMode === "list" ? "btn-secondary" : "btn-ghost"}`}
            title="List View"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleViewChange("board")}
            className={`btn !p-2 ${viewMode === "board" ? "btn-secondary" : "btn-ghost"}`}
            title="Board View (by Status)"
          >
            <Columns className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleViewChange("issue")}
            className={`btn !p-2 ${viewMode === "issue" ? "btn-secondary" : "btn-ghost"}`}
            title="Issue View"
          >
            <BookOpen className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div
        className="flex flex-wrap items-center gap-2 p-3 rounded-lg"
        style={{
          background: "var(--bg-surface)",
          border: "0.5px solid var(--border-default)",
        }}
      >
        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 min-w-48">
          <Input
            placeholder="Search articles..."
            value={searchInput}
            onChange={setSearchInput}
            icon={Search}
          />
        </form>

        {/* Status Filter */}
        <FilterSelect
          value={search.status || ""}
          onChange={(v) => handleFilterChange("status", v)}
          options={STATUS_OPTIONS}
          placeholder="Status"
        />

        {/* Tier Filter */}
        <FilterSelect
          value={search.tier || ""}
          onChange={(v) => handleFilterChange("tier", v)}
          options={TIER_OPTIONS}
          placeholder="Tier"
        />

        {/* Clear Filters */}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              navigate({
                search: { page: 1 },
              })
            }
          >
            Clear
          </Button>
        )}
      </div>

      {/* Content based on view mode */}
      {articles.length === 0 ? (
        <div
          className="rounded-lg overflow-hidden"
          style={{
            background: "var(--bg-surface)",
            border: "0.5px solid var(--border-default)",
          }}
        >
          <EmptyState
            icon={FileText}
            title="No articles found"
            description={
              hasFilters
                ? "Try adjusting your filters"
                : "Articles submitted via Microsoft Forms will appear here"
            }
          />
        </div>
      ) : viewMode === "board" ? (
        /* Board View - Kanban by Status */
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STATUS_OPTIONS.filter(s => s.value).map((statusOpt) => {
            const statusArticles = articlesByStatus[statusOpt.value] || [];
            return (
              <div
                key={statusOpt.value}
                className="flex-shrink-0 w-72 rounded-lg"
                style={{
                  background: "var(--bg-surface)",
                  border: "0.5px solid var(--border-default)",
                }}
              >
                <div
                  className="px-3 py-2 flex items-center justify-between"
                  style={{ borderBottom: "0.5px solid var(--border-subtle)" }}
                >
                  <span className="text-sm font-medium" style={{ color: "var(--fg-default)" }}>
                    {statusOpt.label}
                  </span>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full"
                    style={{ background: "var(--bg-subtle)", color: "var(--fg-muted)" }}
                  >
                    {statusArticles.length}
                  </span>
                </div>
                <div className="p-2 space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
                  {statusArticles.length === 0 ? (
                    <p className="text-xs text-center py-4" style={{ color: "var(--fg-faint)" }}>
                      No articles
                    </p>
                  ) : (
                    statusArticles.map((article: any) => (
                      <BoardCard key={article.id} article={article} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === "issue" ? (
        /* Issue View - Grouped by Volume/Issue */
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {sortedIssueKeys.map((issueKey) => {
            const issueData = articlesByIssue[issueKey];
            return (
              <div key={issueKey}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  <BookOpen className="w-4 h-4" style={{ color: "var(--fg-muted)" }} />
                  <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--fg-default)", margin: 0 }}>
                    {formatIssueLabel(issueKey)}
                  </h2>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      padding: "0.125rem 0.5rem",
                      borderRadius: "9999px",
                      background: "var(--bg-subtle)",
                      color: "var(--fg-muted)",
                    }}
                  >
                    {issueData.articles.length}
                  </span>
                </div>
                <div
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-default)",
                    borderRadius: "8px",
                    overflow: "hidden",
                  }}
                >
                  {issueData.articles.map((article: any, index: number) => (
                    <IssueArticleRow
                      key={article.id}
                      article={article}
                      isLast={index === issueData.articles.length - 1}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List View - Default Table */
        <div
          className="rounded-lg overflow-hidden"
          style={{
            background: "var(--bg-surface)",
            border: "0.5px solid var(--border-default)",
          }}
        >
          {/* Table Header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 140px 70px 100px 100px 80px 60px",
              gap: "1rem",
              padding: "0.5rem 1rem",
              borderBottom: "0.5px solid var(--border-subtle)",
            }}
          >
            <SortableHeader field="title" label="Article" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
            <SortableHeader field="author" label="Author" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
            <SortableHeader field="volume" label="Vol/Issue" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
            <SortableHeader field="status" label="Status" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
            <SortableHeader field="submitted" label="Submitted" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
            <SortableHeader field="tier" label="Tier" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
            <span className="table-header text-right">Info</span>
          </div>

          {/* Table Body */}
          <div>
            {articles.map((article: any) => (
              <ArticleRow key={article.id} article={article} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderTop: "0.5px solid var(--border-subtle)" }}
            >
              <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
                {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1}
                  className="btn btn-ghost !p-1.5 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span
                  className="text-xs px-2 tabular-nums"
                  style={{ color: "var(--fg-muted)" }}
                >
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages}
                  className="btn btn-ghost !p-1.5 disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ArticleRow({ article }: { article: any }) {
  const authorName = article.author
    ? `${article.author.givenName} ${article.author.surname}`
    : "Unknown";

  return (
    <Link
      to="/article/$articleId"
      params={{ articleId: article.id }}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 140px 70px 100px 100px 80px 60px",
        gap: "1rem",
        padding: "0.75rem 1rem",
        alignItems: "center",
        borderBottom: "0.5px solid var(--border-subtle)",
        transition: "background 150ms ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-subtle)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {/* Title */}
      <div className="min-w-0">
        <span
          className="text-sm font-medium truncate block"
          style={{ color: "var(--fg-default)" }}
        >
          {article.title}
        </span>
      </div>

      {/* Author */}
      <div className="flex items-center gap-2 min-w-0">
        <Avatar name={authorName} size="sm" />
        <div className="min-w-0">
          <span
            className="text-sm truncate block"
            style={{ color: "var(--fg-default)" }}
          >
            {authorName}
          </span>
        </div>
      </div>

      {/* Volume/Issue */}
      <div>
        {article.volume || article.issue ? (
          <span
            className="text-xs tabular-nums px-1.5 py-0.5 rounded"
            style={{
              background: "var(--bg-subtle)",
              color: "var(--fg-muted)",
            }}
          >
            {article.volume && `V${article.volume}`}
            {article.volume && article.issue && "/"}
            {article.issue && `#${article.issue}`}
          </span>
        ) : (
          <span className="text-xs" style={{ color: "var(--fg-faint)" }}>—</span>
        )}
      </div>

      {/* Status */}
      <div>
        <StatusBadge status={article.internalStatus} />
      </div>

      {/* Date */}
      <div>
        <span
          className="text-xs tabular-nums"
          style={{ color: "var(--fg-muted)" }}
        >
          {formatDate(article.submittedAt || article.createdAt)}
        </span>
      </div>

      {/* Tier */}
      <div>
        <TierBadge tier={article.articleTier} />
      </div>

      {/* Info Icons */}
      <div className="flex items-center justify-end gap-1">
        {article.attachments?.length > 0 && (
          <span
            style={{ color: "var(--fg-faint)" }}
            title={`${article.attachments.length} attachments`}
          >
            <Paperclip className="w-3.5 h-3.5" />
          </span>
        )}
        {article.multimediaTypes?.length > 0 && (
          <span
            style={{ color: "var(--fg-faint)" }}
            title={`Multimedia: ${article.multimediaTypes.map((m: any) => m.multimediaType).join(", ")}`}
          >
            <Image className="w-3.5 h-3.5" />
          </span>
        )}
        {article.prefersAnonymity && (
          <span style={{ color: "var(--fg-faint)" }} title="Prefers anonymity">
            <EyeOff className="w-3.5 h-3.5" />
          </span>
        )}
        {article.paymentStatus && (
          <span style={{ color: "var(--status-success)" }} title="Paid">
            <DollarSign className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    </Link>
  );
}

function BoardCard({ article }: { article: any }) {
  const authorName = article.author
    ? `${article.author.givenName} ${article.author.surname}`
    : "Unknown";

  return (
    <Link
      to="/article/$articleId"
      params={{ articleId: article.id }}
      className="block p-3 rounded-md transition-colors"
      style={{
        background: "var(--bg-default)",
        border: "0.5px solid var(--border-subtle)",
      }}
    >
      <p
        className="text-sm font-medium line-clamp-2 mb-2"
        style={{ color: "var(--fg-default)" }}
      >
        {article.title}
      </p>
      <div className="flex items-center gap-2 mb-2">
        <Avatar name={authorName} size="sm" />
        <span className="text-xs truncate" style={{ color: "var(--fg-muted)" }}>
          {authorName}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <TierBadge tier={article.articleTier} />
        <span className="text-xs" style={{ color: "var(--fg-faint)" }}>
          {formatDate(article.submittedAt || article.createdAt)}
        </span>
      </div>
    </Link>
  );
}

function IssueArticleRow({ article, isLast }: { article: any; isLast: boolean }) {
  const authorName = article.author
    ? `${article.author.givenName} ${article.author.surname}`
    : "Unknown";

  return (
    <Link
      to="/article/$articleId"
      params={{ articleId: article.id }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.75rem 1rem",
        borderBottom: isLast ? "none" : "0.5px solid var(--border-subtle)",
        transition: "background 150ms ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-subtle)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: "0.875rem",
            fontWeight: 500,
            color: "var(--fg-default)",
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {article.title}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.25rem" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--fg-muted)" }}>
            {authorName}
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--fg-faint)" }}>·</span>
          <span style={{ fontSize: "0.75rem", color: "var(--fg-muted)" }}>
            {formatDate(article.submittedAt || article.createdAt)}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <StatusBadge status={article.internalStatus} />
        <TierBadge tier={article.articleTier} />
        {article.paymentStatus && (
          <DollarSign className="w-4 h-4" style={{ color: "var(--status-success)" }} />
        )}
      </div>
    </Link>
  );
}

function SortableHeader({
  field,
  label,
  sortBy,
  sortOrder,
  onSort,
}: {
  field: SortField;
  label: string;
  sortBy?: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
}) {
  const isActive = sortBy === field;

  return (
    <button
      onClick={() => onSort(field)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        fontSize: "11px",
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: isActive ? "var(--fg-default)" : "var(--fg-muted)",
        transition: "color 150ms ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg-default)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = isActive ? "var(--fg-default)" : "var(--fg-muted)")}
    >
      {label}
      {isActive ? (
        sortOrder === "asc" ? (
          <ChevronUp className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )
      ) : (
        <ArrowUpDown className="w-3 h-3" style={{ opacity: 0.5 }} />
      )}
    </button>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption?.value ? selectedOption.label : placeholder;

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="select-trigger pr-7"
        style={{
          appearance: "none",
          minWidth: "100px",
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
        style={{ color: "var(--fg-faint)" }}
      />
    </div>
  );
}
