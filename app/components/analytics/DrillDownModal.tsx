import { X, FileText, User, DollarSign, Calendar, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { StatusBadge, TierBadge, Avatar } from "~/components/Layout";

// Format cents to dollars
function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export type DrillDownType =
  | "tier"
  | "bonus"
  | "author"
  | "authorType"
  | "semester"
  | "paymentStatus";

interface Article {
  id: string;
  title: string;
  articleTier: string;
  internalStatus: string;
  paymentAmount: number | null;
  paymentStatus: boolean;
  createdAt: string;
  author?: {
    id: string;
    givenName: string;
    surname: string;
  } | null;
}

interface Author {
  id: string;
  givenName: string;
  surname: string;
  email: string;
  authorType: string | null;
  articleCount?: number;
  totalEarnings?: number;
}

interface DrillDownData {
  type: DrillDownType;
  title: string;
  subtitle?: string;
  articles?: Article[];
  authors?: Author[];
  author?: Author & { articles?: Article[] };
}

interface DrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: DrillDownData | null;
  isLoading?: boolean;
}

export function DrillDownModal({ isOpen, onClose, data, isLoading }: DrillDownModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl max-h-[80vh] mx-4 rounded-lg shadow-xl overflow-hidden flex flex-col"
        style={{ background: "var(--bg-surface)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--border-default)" }}
        >
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--fg-default)" }}>
              {data?.title || "Loading..."}
            </h2>
            {data?.subtitle && (
              <p className="text-sm mt-0.5" style={{ color: "var(--fg-muted)" }}>
                {data.subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-black/5 transition-colors"
          >
            <X className="w-5 h-5" style={{ color: "var(--fg-muted)" }} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div
                className="animate-spin rounded-full h-8 w-8 border-2 border-current border-t-transparent"
                style={{ color: "var(--accent)" }}
              />
            </div>
          ) : data?.articles ? (
            <ArticleList articles={data.articles} />
          ) : data?.authors ? (
            <AuthorList authors={data.authors} />
          ) : data?.author ? (
            <AuthorDetail author={data.author} />
          ) : (
            <div className="text-center py-12" style={{ color: "var(--fg-muted)" }}>
              No data available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ArticleList({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return (
      <div className="text-center py-8" style={{ color: "var(--fg-muted)" }}>
        No articles found
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {articles.map((article) => {
        const authorName = article.author
          ? `${article.author.givenName} ${article.author.surname}`
          : "Unknown";

        return (
          <Link
            key={article.id}
            to="/article/$articleId"
            params={{ articleId: article.id }}
            className="block p-3 rounded-lg border transition-colors hover:border-blue-300"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--bg-root)"
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 flex-shrink-0" style={{ color: "var(--fg-muted)" }} />
                  <span className="font-medium truncate" style={{ color: "var(--fg-default)" }}>
                    {article.title}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-xs" style={{ color: "var(--fg-muted)" }}>
                  <span>{authorName}</span>
                  <span>·</span>
                  <span>{formatDate(article.createdAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {article.paymentAmount && (
                  <span
                    className="text-sm font-medium"
                    style={{ color: article.paymentStatus ? "var(--status-success)" : "var(--fg-muted)" }}
                  >
                    {formatCents(article.paymentAmount)}
                  </span>
                )}
                <TierBadge tier={article.articleTier} />
                <StatusBadge status={article.internalStatus} />
                <ExternalLink className="w-3.5 h-3.5" style={{ color: "var(--fg-faint)" }} />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function AuthorList({ authors }: { authors: Author[] }) {
  if (authors.length === 0) {
    return (
      <div className="text-center py-8" style={{ color: "var(--fg-muted)" }}>
        No authors found
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {authors.map((author) => (
        <Link
          key={author.id}
          to="/author/$authorId"
          params={{ authorId: author.id }}
          className="block p-3 rounded-lg border transition-colors hover:border-blue-300"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--bg-root)"
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={`${author.givenName} ${author.surname}`} size="sm" />
              <div>
                <div className="font-medium" style={{ color: "var(--fg-default)" }}>
                  {author.givenName} {author.surname}
                </div>
                <div className="text-xs" style={{ color: "var(--fg-muted)" }}>
                  {author.email}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              {author.articleCount !== undefined && (
                <span style={{ color: "var(--fg-muted)" }}>
                  {author.articleCount} articles
                </span>
              )}
              {author.totalEarnings !== undefined && (
                <span className="font-medium" style={{ color: "var(--status-success)" }}>
                  {formatCents(author.totalEarnings)}
                </span>
              )}
              <ExternalLink className="w-3.5 h-3.5" style={{ color: "var(--fg-faint)" }} />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function AuthorDetail({ author }: { author: Author & { articles?: Article[] } }) {
  return (
    <div className="space-y-4">
      {/* Author header */}
      <Link
        to="/author/$authorId"
        params={{ authorId: author.id }}
        className="flex items-center gap-4 p-4 rounded-lg border transition-colors hover:border-blue-300"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-root)"
        }}
      >
        <Avatar name={`${author.givenName} ${author.surname}`} />
        <div className="flex-1">
          <div className="font-medium text-lg" style={{ color: "var(--fg-default)" }}>
            {author.givenName} {author.surname}
          </div>
          <div className="text-sm" style={{ color: "var(--fg-muted)" }}>
            {author.email} · {author.authorType || "Unknown type"}
          </div>
        </div>
        <div className="text-right">
          {author.totalEarnings !== undefined && (
            <div className="text-xl font-semibold" style={{ color: "var(--status-success)" }}>
              {formatCents(author.totalEarnings)}
            </div>
          )}
          {author.articleCount !== undefined && (
            <div className="text-sm" style={{ color: "var(--fg-muted)" }}>
              {author.articleCount} articles
            </div>
          )}
        </div>
      </Link>

      {/* Author's articles */}
      {author.articles && author.articles.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2" style={{ color: "var(--fg-muted)" }}>
            Recent Articles
          </h3>
          <ArticleList articles={author.articles} />
        </div>
      )}
    </div>
  );
}
