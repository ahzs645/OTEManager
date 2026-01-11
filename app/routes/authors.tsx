import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Users, Search, Mail, FileText, DollarSign, User, ChevronDown, ArrowUpDown } from "lucide-react";
import { EmptyState, Input } from "~/components/Layout";
import { getAuthors } from "~/lib/queries";

export const Route = createFileRoute("/authors")({
  component: AuthorsPage,
  loader: () => getAuthors(),
});

type SortOption = "name-asc" | "name-desc" | "articles-desc" | "articles-asc" | "recent";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "articles-desc", label: "Most articles" },
  { value: "articles-asc", label: "Least articles" },
  { value: "recent", label: "Recently added" },
];

function AuthorsPage() {
  const { authors } = Route.useLoaderData();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");

  const sortedAndFilteredAuthors = useMemo(() => {
    let result = [...authors];

    // Filter
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter((author: any) =>
        author.givenName.toLowerCase().includes(searchLower) ||
        author.surname.toLowerCase().includes(searchLower) ||
        author.email.toLowerCase().includes(searchLower)
      );
    }

    // Sort
    result.sort((a: any, b: any) => {
      switch (sortBy) {
        case "name-asc":
          return `${a.surname} ${a.givenName}`.localeCompare(`${b.surname} ${b.givenName}`);
        case "name-desc":
          return `${b.surname} ${b.givenName}`.localeCompare(`${a.surname} ${a.givenName}`);
        case "articles-desc":
          return (b.articleCount || 0) - (a.articleCount || 0);
        case "articles-asc":
          return (a.articleCount || 0) - (b.articleCount || 0);
        case "recent":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default:
          return 0;
      }
    });

    return result;
  }, [authors, search, sortBy]);

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Authors</h1>
        <p className="page-subtitle">
          {authors.length} contributor{authors.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Filters Bar */}
      <div
        className="flex flex-wrap items-center gap-3 p-3 rounded-lg"
        style={{
          background: "var(--bg-surface)",
          border: "0.5px solid var(--border-default)",
        }}
      >
        {/* Search */}
        <div className="flex-1 min-w-48">
          <Input
            placeholder="Search authors..."
            value={search}
            onChange={setSearch}
            icon={Search}
          />
        </div>

        {/* Sort */}
        <div className="relative">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="select-trigger pr-8"
            style={{ minWidth: "140px" }}
          >
            {SORT_OPTIONS.map((opt) => (
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
      </div>

      {/* Authors Grid */}
      <div
        className="rounded-lg overflow-hidden"
        style={{
          background: "var(--bg-surface)",
          border: "0.5px solid var(--border-default)",
        }}
      >
        {sortedAndFilteredAuthors.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search ? "No authors found" : "No authors yet"}
            description={
              search
                ? "Try adjusting your search"
                : "Authors will be created automatically when articles are submitted"
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
            {sortedAndFilteredAuthors.map((author: any) => (
              <AuthorCard key={author.id} author={author} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AuthorCard({
  author,
}: {
  author: {
    id: string;
    givenName: string;
    surname: string;
    email: string;
    role: string;
    articleCount: number;
    autoDepositAvailable: boolean;
    etransferEmail?: string;
  };
}) {
  return (
    <Link
      to="/author/$authorId"
      params={{ authorId: author.id }}
      className="border rounded-lg p-4 hover:shadow-md transition-shadow block"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <User className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-medium" style={{ color: 'var(--fg-default)' }}>
              {author.givenName} {author.surname}
            </h3>
            <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>{author.role}</p>
          </div>
        </div>
        {author.autoDepositAvailable && (
          <span
            className="inline-flex items-center px-2 py-1 text-xs rounded-full"
            style={{ background: 'var(--status-success-bg)', color: 'var(--status-success)' }}
            title="Auto-deposit enabled"
          >
            <DollarSign className="w-3 h-3" />
          </span>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center text-sm" style={{ color: 'var(--fg-muted)' }}>
          <Mail className="w-4 h-4 mr-2" />
          <span className="truncate">{author.email}</span>
        </div>
        <div className="flex items-center text-sm" style={{ color: 'var(--fg-muted)' }}>
          <FileText className="w-4 h-4 mr-2" />
          {author.articleCount} article{author.articleCount !== 1 ? "s" : ""}
        </div>
        {author.etransferEmail && author.etransferEmail !== author.email && (
          <div className="flex items-center text-sm" style={{ color: 'var(--fg-muted)' }}>
            <DollarSign className="w-4 h-4 mr-2" />
            <span className="truncate" title="E-transfer email">
              {author.etransferEmail}
            </span>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
        <span className="text-sm" style={{ color: 'var(--accent)' }}>
          View details
        </span>
        <span style={{ color: 'var(--fg-faint)' }}>→</span>
      </div>
    </Link>
  );
}
