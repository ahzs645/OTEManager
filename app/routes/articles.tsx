import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
import { getArticles } from "~/lib/queries";

// Search params schema
type ArticlesSearch = {
  status?: string;
  tier?: string;
  search?: string;
  authorId?: string;
  page?: number;
};

export const Route = createFileRoute("/articles")({
  component: ArticlesPage,
  validateSearch: (search: Record<string, unknown>): ArticlesSearch => {
    return {
      status: search.status as string | undefined,
      tier: search.tier as string | undefined,
      search: search.search as string | undefined,
      authorId: search.authorId as string | undefined,
      page: Number(search.page) || 1,
    };
  },
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ deps }) => {
    return getArticles({
      status: deps.search.status,
      tier: deps.search.tier,
      search: deps.search.search,
      authorId: deps.search.authorId,
      page: deps.search.page,
    });
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
  const { articles, total, page, totalPages } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [searchInput, setSearchInput] = useState(search.search || "");

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

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1 className="page-title">Articles</h1>
          <p className="page-subtitle">
            {total} {total === 1 ? "article" : "articles"}
            {hasFilters && " matching filters"}
          </p>
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

      {/* Articles Table */}
      <div
        className="rounded-lg overflow-hidden"
        style={{
          background: "var(--bg-surface)",
          border: "0.5px solid var(--border-default)",
        }}
      >
        {articles.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No articles found"
            description={
              hasFilters
                ? "Try adjusting your filters"
                : "Articles submitted via Microsoft Forms will appear here"
            }
          />
        ) : (
          <>
            {/* Table Header */}
            <div
              className="grid gap-4 px-4 py-2"
              style={{
                gridTemplateColumns: "1fr 140px 100px 100px 80px 60px",
                borderBottom: "0.5px solid var(--border-subtle)",
              }}
            >
              <span className="table-header">Article</span>
              <span className="table-header">Author</span>
              <span className="table-header">Status</span>
              <span className="table-header">Submitted</span>
              <span className="table-header">Tier</span>
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
          </>
        )}
      </div>
    </div>
  );
}

function ArticleRow({ article }: { article: any }) {
  const authorName = article.author
    ? `${article.author.givenName} ${article.author.surname}`
    : "Unknown";

  return (
    <Link
      to="/articles/$articleId"
      params={{ articleId: article.id }}
      className="grid gap-4 px-4 py-3 items-center table-row"
      style={{
        gridTemplateColumns: "1fr 140px 100px 100px 80px 60px",
        display: "grid",
      }}
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
