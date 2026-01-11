import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Users, Search, Mail, FileText, DollarSign, User } from "lucide-react";
import { EmptyState } from "~/components/Layout";
import { getAuthors } from "~/lib/queries";

export const Route = createFileRoute("/authors")({
  component: AuthorsPage,
  loader: () => getAuthors(),
});

function AuthorsPage() {
  const { authors } = Route.useLoaderData();
  const [search, setSearch] = useState("");

  const filteredAuthors = authors.filter((author: any) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      author.givenName.toLowerCase().includes(searchLower) ||
      author.surname.toLowerCase().includes(searchLower) ||
      author.email.toLowerCase().includes(searchLower)
    );
  });

  return (
    <>
      {/* Page Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Authors</h2>
        <p className="text-sm text-gray-500">
          Manage contributors and their payment information ({authors.length}{" "}
          total)
        </p>
      </div>

      {/* Search */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search authors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Authors Grid */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {filteredAuthors.length === 0 ? (
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
            {filteredAuthors.map((author: any) => (
              <AuthorCard key={author.id} author={author} />
            ))}
          </div>
        )}
      </div>
    </>
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
    <div className="border rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <User className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">
              {author.givenName} {author.surname}
            </h3>
            <p className="text-sm text-gray-500">{author.role}</p>
          </div>
        </div>
        {author.autoDepositAvailable && (
          <span
            className="inline-flex items-center px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full"
            title="Auto-deposit enabled"
          >
            <DollarSign className="w-3 h-3" />
          </span>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center text-sm text-gray-500">
          <Mail className="w-4 h-4 mr-2" />
          <a
            href={`mailto:${author.email}`}
            className="hover:text-blue-600 truncate"
          >
            {author.email}
          </a>
        </div>
        <div className="flex items-center text-sm text-gray-500">
          <FileText className="w-4 h-4 mr-2" />
          {author.articleCount} article{author.articleCount !== 1 ? "s" : ""}
        </div>
        {author.etransferEmail && author.etransferEmail !== author.email && (
          <div className="flex items-center text-sm text-gray-500">
            <DollarSign className="w-4 h-4 mr-2" />
            <span className="truncate" title="E-transfer email">
              {author.etransferEmail}
            </span>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t">
        <Link
          to="/articles"
          search={{ authorId: author.id }}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          View articles →
        </Link>
      </div>
    </div>
  );
}
