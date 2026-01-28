import { createFileRoute, Link } from "@tanstack/react-router";
import {
  FileText,
  Users,
  Clock,
  CheckCircle,
  TrendingUp,
  ChevronRight,
  Paperclip,
  Image,
} from "lucide-react";
import {
  StatCard,
  StatusBadge,
  TierBadge,
  EmptyState,
  formatRelativeTime,
  Section,
  Avatar,
} from "~/components/Layout";
import { getDashboardStats, getRecentArticles } from "~/lib/queries";

export const Route = createFileRoute("/")({
  component: Dashboard,
  // Cache loader data for 30 seconds to prevent refetching on navigation
  staleTime: 30_000,
  // Keep data in cache for 5 minutes even when inactive
  gcTime: 5 * 60 * 1000,
  loader: async () => {
    const [stats, recent] = await Promise.all([
      getDashboardStats(),
      getRecentArticles(),
    ]);
    return { stats, recentArticles: recent.articles };
  },
});

function Dashboard() {
  const { stats, recentArticles } = Route.useLoaderData();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Overview of article submissions</p>
      </div>

      {/* Stats Grid - Compact 2x3 layout */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          title="Total"
          value={stats.totalArticles}
          icon={FileText}
          href="/articles"
        />
        <StatCard
          title="Pending"
          value={stats.pendingReview}
          icon={Clock}
          href="/articles?status=Pending+Review"
        />
        <StatCard
          title="In Progress"
          value={stats.inProgress}
          icon={TrendingUp}
          href="/articles?status=In+Review"
        />
        <StatCard
          title="Published"
          value={stats.published}
          icon={CheckCircle}
        />
        <StatCard
          title="Authors"
          value={stats.totalAuthors}
          icon={Users}
          href="/authors"
        />
        <StatCard
          title="This Month"
          value={stats.thisMonth}
          icon={TrendingUp}
        />
      </div>

      {/* Quick Actions - Minimal */}
      {stats.pendingReview > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-lg"
          style={{
            background: "var(--status-pending-bg)",
            border: "0.5px solid var(--border-default)",
          }}
        >
          <Clock className="w-4 h-4" style={{ color: "var(--status-pending)" }} />
          <span className="text-sm" style={{ color: "var(--fg-default)" }}>
            <strong>{stats.pendingReview}</strong> articles waiting for review
          </span>
          <Link
            to="/articles"
            search={{ status: "Pending Review" }}
            className="ml-auto text-sm font-medium flex items-center gap-1"
            style={{ color: "var(--accent)" }}
          >
            Review now
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      {/* Recent Submissions */}
      <Section
        title="Recent Submissions"
        action={
          <Link
            to="/articles"
            className="text-xs font-medium flex items-center gap-1"
            style={{ color: "var(--accent)" }}
          >
            View all
            <ChevronRight className="w-3 h-3" />
          </Link>
        }
        noPadding
      >
        {recentArticles.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No submissions yet"
            description="Articles submitted via Microsoft Forms will appear here"
          />
        ) : (
          <div>
            {recentArticles.map((article: any, index: number) => (
              <ArticleListItem
                key={article.id}
                article={article}
                isLast={index === recentArticles.length - 1}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function ArticleListItem({
  article,
  isLast,
}: {
  article: any;
  isLast: boolean;
}) {
  const authorName = article.author
    ? `${article.author.givenName} ${article.author.surname}`
    : "Unknown";

  return (
    <Link
      to="/article/$articleId"
      params={{ articleId: article.id }}
      className="list-item list-item-clickable"
      style={{ borderBottom: isLast ? "none" : undefined }}
    >
      {/* Avatar */}
      <Avatar name={authorName} size="sm" />

      {/* Content */}
      <div className="flex-1 min-w-0 ml-3">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-medium truncate"
            style={{ color: "var(--fg-default)" }}
          >
            {article.title}
          </span>
        </div>
        <div
          className="flex items-center gap-2 mt-0.5 text-xs"
          style={{ color: "var(--fg-muted)" }}
        >
          <span>{authorName}</span>
          <span>·</span>
          <span suppressHydrationWarning>{formatRelativeTime(article.submittedAt || article.createdAt)}</span>
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 ml-3">
        {/* Attachment indicators */}
        <div className="flex items-center gap-1">
          {article.attachments?.length > 0 && (
            <span style={{ color: "var(--fg-faint)" }} title="Has attachments">
              <Paperclip className="w-3.5 h-3.5" />
            </span>
          )}
          {article.multimediaTypes?.length > 0 && (
            <span style={{ color: "var(--fg-faint)" }} title="Has multimedia">
              <Image className="w-3.5 h-3.5" />
            </span>
          )}
        </div>

        {/* Tier */}
        <TierBadge tier={article.articleTier} />

        {/* Status */}
        <StatusBadge status={article.internalStatus} />

        {/* Arrow */}
        <ChevronRight className="w-4 h-4" style={{ color: "var(--fg-faint)" }} />
      </div>
    </Link>
  );
}
