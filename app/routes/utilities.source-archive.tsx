import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  ExternalLink,
  FileArchive,
  RefreshCw,
  Upload,
} from "lucide-react";
import { LoadingSpinner } from "~/components/Layout";
import {
  sourceRecoveryLabel,
  sourceVisibilityLabel,
} from "~/lib/source-archive-display";
import {
  parseSourceArchiveBundle,
  eligibleSourceArticle,
  type SourceArchiveBundle as SourceManifest,
  type SourceArchiveIssue as SourceIssue,
  type SourceArchivePreview,
} from "../../shared/source-archive";

type ImportReview = SourceArchivePreview & {
  files?: {
    referenced: number;
    available: number;
    missing: number;
    created?: number;
    skipped?: number;
    failed?: number;
  };
};

export const Route = createFileRoute("/utilities/source-archive")({
  component: SourceArchivePage,
});

const cataloguePath = "/designcraft/source-archive.json";
const panelStyle = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
};
const muted = { color: "var(--fg-muted)" };

function safeWebUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function sourcePdfUrl(
  source: SourceIssue["source"],
  page?: number,
): string | undefined {
  const url =
    safeWebUrl(source.url) ||
    (/^(?:originals|pdfs)\/[a-zA-Z0-9._/-]+\.pdf$/.test(source.path) &&
    !source.path.includes("..")
      ? `/designcraft/${source.path}`
      : undefined);
  return url && page ? `${url.split("#")[0]}#page=${page}` : url || undefined;
}

async function readManifestFile(file: File): Promise<SourceManifest> {
  if (file.size > 64 * 1024 * 1024)
    throw new Error(
      "Choose a source archive ZIP under 64 MiB or upload its JSON manifest.",
    );
  if (!/\.zip$/i.test(file.name)) {
    if (file.size > 6 * 1024 * 1024)
      throw new Error("The metadata manifest must be under 6 MiB.");
    return parseSourceArchiveBundle(await file.text());
  }
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter(
    (entry) =>
      !entry.dir &&
      /(?:^|\/)(?:source-archive|manifest)\.json$/i.test(entry.name),
  );
  const preferred = entries.filter((entry) =>
    /(?:^|\/)source-archive\.json$/i.test(entry.name),
  );
  const candidates = preferred.length ? preferred : entries;
  if (candidates.length !== 1)
    throw new Error(
      "The ZIP must contain one source-archive.json manifest. You can also upload the JSON file directly.",
    );
  const entry = candidates[0] as (typeof candidates)[number] & {
    _data?: { uncompressedSize?: number };
  };
  if ((entry._data?.uncompressedSize || 0) > 6 * 1024 * 1024)
    throw new Error("The metadata manifest must be under 6 MiB.");
  const text = await candidates[0].async("string");
  return parseSourceArchiveBundle(text);
}

function SourceArchivePage() {
  const [manifest, setManifest] = useState<SourceManifest | null>(null);
  const [label, setLabel] = useState("Bundled original issue archive");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"loading" | "preview" | "import" | null>(
    "loading",
  );
  const [error, setError] = useState("");
  const [review, setReview] = useState<ImportReview | null>(null);
  const [imported, setImported] = useState(false);
  const [query, setQuery] = useState("");
  const [inventory, setInventory] = useState(false);
  const [publishedFolder, setPublishedFolder] = useState<string>();
  const [pendingZip, setPendingZip] = useState<File | null>(null);
  const reviewRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (review) reviewRef.current?.scrollIntoView({ block: "start" });
  }, [review]);

  const acceptManifest = (
    next: SourceManifest,
    name: string,
    zip: File | null = null,
  ) => {
    setManifest(next);
    setLabel(name);
    setSelected(new Set(next.issues.map((issue) => issue.documentId)));
    setReview(null);
    setImported(false);
    setError("");
    setQuery("");
    setPendingZip(zip);
  };

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      fetch(cataloguePath, { signal: controller.signal }).then(
        async (response) => {
          if (!response.ok)
            throw new Error(
              "The bundled source archive is unavailable. Upload its JSON manifest or ZIP to continue.",
            );
          return parseSourceArchiveBundle(await response.json());
        },
      ),
      fetch("/designcraft/source-archive-drive.json", {
        signal: controller.signal,
      }).then(async (response) =>
        response.ok
          ? ((await response.json()) as { folderUrl?: string })
          : null,
      ),
    ]).then(([catalogue, publication]) => {
      if (controller.signal.aborted) return;
      if (catalogue.status === "fulfilled")
        acceptManifest(catalogue.value, "Bundled original issue archive");
      else
        setError(
          catalogue.reason instanceof Error
            ? catalogue.reason.message
            : "Could not load source archive.",
        );
      if (publication.status === "fulfilled")
        setPublishedFolder(safeWebUrl(publication.value?.folderUrl));
      setBusy(null);
    });
    return () => controller.abort();
  }, []);

  const loadBundled = async () => {
    setBusy("loading");
    setError("");
    try {
      const response = await fetch(cataloguePath);
      if (!response.ok)
        throw new Error("The bundled source archive is unavailable.");
      acceptManifest(
        parseSourceArchiveBundle(await response.json()),
        "Bundled original issue archive",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load source archive.",
      );
    } finally {
      setBusy(null);
    }
  };

  const uploadManifest = async (file: File) => {
    setBusy("loading");
    setError("");
    try {
      acceptManifest(
        await readManifestFile(file),
        file.name,
        /\.zip$/i.test(file.name) ? file : null,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not read source archive.",
      );
    } finally {
      setBusy(null);
    }
  };

  const runImport = async (preview: boolean) => {
    if (!manifest || !selected.size || (!preview && !review)) return;
    setBusy(preview ? "preview" : "import");
    setError("");
    if (preview) {
      setReview(null);
      setImported(false);
    }
    try {
      let body: FormData | string;
      if (pendingZip) {
        const form = new FormData();
        form.append("file", pendingZip);
        form.append("preview", String(preview));
        form.append("issueIds", JSON.stringify([...selected]));
        if (!preview && review?.previewToken)
          form.append("previewToken", review.previewToken);
        body = form;
      } else {
        body = JSON.stringify({
          manifest,
          issueIds: [...selected],
          preview,
          previewToken: preview ? undefined : review?.previewToken,
        });
      }
      const response = await fetch("/api/source-archive/import", {
        method: "POST",
        headers:
          typeof body === "string"
            ? { "Content-Type": "application/json" }
            : undefined,
        body,
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error || "Source archive import failed.");
      setReview(result as ImportReview);
      setImported(!preview);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Source archive import failed.",
      );
    } finally {
      setBusy(null);
    }
  };

  const selectedArticles =
    manifest?.articles.filter((article) =>
      article.placements.some((placement) =>
        selected.has(placement.documentId),
      ),
    ) || [];
  const eligible = selectedArticles.filter(eligibleSourceArticle);
  const inventoryCount = selectedArticles.length - eligible.length;
  const visibleArticles = selectedArticles.filter(
    (article) =>
      eligibleSourceArticle(article) !== inventory &&
      `${article.title} ${article.authorName || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const missingBodies = eligible.filter(
    (article) => !article.content?.trim(),
  ).length;
  const manifestDrive = manifest?.drive as { folderUrl?: string } | undefined;
  const folderUrl = safeWebUrl(manifestDrive?.folderUrl) || publishedFolder;
  const issueMap = new Map(
    manifest?.issues.map((issue) => [issue.documentId, issue]),
  );

  return (
    <div className="page-container space-y-5">
      <div>
        <Link
          to="/utilities"
          className="inline-flex items-center gap-1 text-sm mb-3"
          style={muted}
        >
          <ArrowLeft className="w-4 h-4" /> Utilities
        </Link>
        <h1 className="page-title">Original issue archive</h1>
        <p className="page-subtitle">
          Review original articles and publication metadata from the nine source
          archives. Missing text, bylines, and release dates remain explicit.
        </p>
        <div
          className="flex flex-wrap gap-3 mt-3 text-sm"
          style={{ color: "var(--accent)" }}
        >
          <Link to="/publications">Publications</Link>
          <Link to="/articles">Articles</Link>
          <Link to="/utilities/designcraft">Recreate complete issues</Link>
          {folderUrl && (
            <a
              href={folderUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1"
            >
              Generated files on Drive <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      <section
        className="rounded-lg p-4 space-y-3"
        style={panelStyle}
        aria-label="Source archive input"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Source manifest</h2>
            <p className="text-sm mt-1" style={muted}>
              {label}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={loadBundled}
              disabled={!!busy}
            >
              <RefreshCw className="w-4 h-4" /> Bundled archive
            </button>
            <label
              className={`btn btn-secondary btn-sm ${busy ? "opacity-50" : "cursor-pointer"}`}
            >
              <Upload className="w-4 h-4" /> Open JSON or ZIP
              <input
                type="file"
                accept=".json,.zip,application/json,application/zip"
                className="sr-only"
                aria-label="Open source archive JSON or ZIP"
                disabled={!!busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadManifest(file);
                }}
              />
            </label>
            <a
              className="btn btn-ghost btn-sm"
              href={cataloguePath}
              download="source-archive.json"
            >
              Download manifest
            </a>
          </div>
        </div>
        <p className="text-xs" style={muted}>
          JSON preserves source media references. ZIP imports can also include
          original documents and photos listed in the manifest. Missing files
          remain explicit.
        </p>
      </section>

      {busy === "loading" && (
        <div className="flex items-center gap-2 text-sm" role="status">
          <LoadingSpinner size="sm" /> Loading archive…
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex gap-2 rounded-lg p-4"
          style={{ ...panelStyle, color: "var(--status-error)" }}
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {manifest && (
        <>
          <section
            className="rounded-lg p-4 space-y-3"
            style={panelStyle}
            aria-label="Source issues"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                Source issues · {selected.size} of {manifest.issues.length}{" "}
                selected
              </h2>
              <div className="flex gap-2">
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!!busy}
                  onClick={() => {
                    setSelected(
                      new Set(manifest.issues.map((issue) => issue.documentId)),
                    );
                    setReview(null);
                    setImported(false);
                  }}
                >
                  Select all
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!!busy}
                  onClick={() => {
                    setSelected(new Set());
                    setReview(null);
                    setImported(false);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
            <p className="text-sm" style={muted}>
              Multiple PDFs of the same edition share one publication and
              article record. Original placements remain attached to each source
              document.
            </p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {manifest.issues.map((issue) => (
                <div
                  key={issue.documentId}
                  className="rounded-md p-3"
                  style={{ border: "1px solid var(--border-subtle)" }}
                >
                  <label className="flex gap-2 items-start cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(issue.documentId)}
                      disabled={!!busy}
                      onChange={() => {
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(issue.documentId))
                            next.delete(issue.documentId);
                          else next.add(issue.documentId);
                          return next;
                        });
                        setReview(null);
                        setImported(false);
                      }}
                    />
                    <span className="text-sm font-medium">{issue.label}</span>
                  </label>
                  <p className="mt-2 text-xs" style={muted}>
                    {issue.volumeNumber
                      ? `Volume ${issue.volumeNumber}`
                      : "Volume not recorded"}{" "}
                    ·{" "}
                    {issue.issueNumber
                      ? `Issue ${issue.issueNumber}`
                      : "Issue not recorded"}{" "}
                    · {issue.pageCount} pages
                  </p>
                  <p className="mt-1 text-xs" style={muted}>
                    {issue.releaseDate
                      ? `Release: ${issue.releaseDate.slice(0, 10)}`
                      : "Release date not verified"}
                  </p>
                  {sourcePdfUrl(issue.source) && (
                    <a
                      className="inline-flex items-center gap-1 text-xs mt-2"
                      style={{ color: "var(--accent)" }}
                      href={sourcePdfUrl(issue.source)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source PDF <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section
            className="rounded-lg p-4 space-y-3"
            style={panelStyle}
            aria-label="Article recovery review"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  {eligible.length} original articles · {inventoryCount} section
                  and media records
                </h2>
                <p className="text-sm mt-1" style={muted}>
                  {missingBodies} articles have metadata only. New archive
                  articles use Archived status; payment information remains
                  unverified.
                </p>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => void runImport(true)}
                disabled={!!busy || !selected.size}
              >
                {busy === "preview" ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <FileArchive className="w-4 h-4" />
                )}{" "}
                Review import
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={`btn btn-sm ${!inventory ? "btn-secondary" : "btn-ghost"}`}
                onClick={() => setInventory(false)}
              >
                Articles ({eligible.length})
              </button>
              <button
                className={`btn btn-sm ${inventory ? "btn-secondary" : "btn-ghost"}`}
                onClick={() => setInventory(true)}
              >
                Sections and media ({inventoryCount})
              </button>
              <input
                className="input flex-1 min-w-48"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find title or original byline"
                aria-label="Find source article"
              />
            </div>
            {inventory && (
              <p className="text-sm" style={muted}>
                Recurring sections, advertisements, photo features, and
                placeholders remain source inventory. They are excluded from
                article imports.
              </p>
            )}
            <div className="space-y-2">
              {visibleArticles.map((article) => (
                <details
                  key={article.sourceKey}
                  className="rounded-md p-3"
                  style={{ border: "1px solid var(--border-subtle)" }}
                >
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{article.title}</span>
                    <span style={muted}>
                      {" "}
                      · {article.authorName || "Author not recorded"}
                    </span>
                    <span className="badge badge-default ml-2">
                      {sourceRecoveryLabel(article.recoveryStatus)}
                    </span>
                    {inventory && (
                      <span className="badge badge-default ml-2">
                        {article.kind}
                      </span>
                    )}
                  </summary>
                  <div className="mt-3 space-y-3 text-sm">
                    <div className="space-y-1" style={muted}>
                      {article.placements.map((placement, index) => {
                        const issue = issueMap.get(placement.documentId);
                        const pages = placement.pageNumbers.length
                          ? `page${placement.pageNumbers.length === 1 ? "" : "s"} ${placement.pageNumbers.join(", ")}`
                          : "page not identified";
                        const href =
                          issue &&
                          sourcePdfUrl(issue.source, placement.pageNumbers[0]);
                        return (
                          <p key={`${placement.documentId}-${index}`}>
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: "var(--accent)" }}
                              >
                                {issue?.label || placement.documentId} · {pages}
                              </a>
                            ) : (
                              `${issue?.label || placement.documentId} · ${pages}`
                            )}
                            {placement.section ? ` · ${placement.section}` : ""}
                          </p>
                        );
                      })}
                    </div>
                    {sourceVisibilityLabel(article.sourceVisibility) && (
                      <p style={muted}>
                        {sourceVisibilityLabel(article.sourceVisibility)}
                      </p>
                    )}
                    {manifest.assets.some(
                      (asset) =>
                        asset.sourceKey === article.sourceKey &&
                        asset.assetRole !== "source-reference",
                    ) && (
                      <div className="space-y-1">
                        <p className="font-medium">
                          Original documents and photos
                        </p>
                        {manifest.assets
                          .filter(
                            (asset) =>
                              asset.sourceKey === article.sourceKey &&
                              asset.assetRole !== "source-reference",
                          )
                          .map((asset, index) => (
                            <p
                              key={
                                typeof asset.id === "string" ? asset.id : index
                              }
                              className="text-xs"
                              style={muted}
                            >
                              {typeof asset.originalFileName === "string"
                                ? asset.originalFileName
                                : typeof asset.path === "string"
                                  ? asset.path
                                  : "Original file"}{" "}
                              ·{" "}
                              {asset.attachmentType === "photo"
                                ? "Photo"
                                : "Document"}{" "}
                              ·{" "}
                              {asset.availability === "available"
                                ? "Source file found"
                                : asset.availability === "missing"
                                  ? "Source file missing"
                                  : "Availability not recorded"}
                            </p>
                          ))}
                      </div>
                    )}
                    {article.content?.trim() ? (
                      <pre
                        className="text-sm whitespace-pre-wrap font-sans max-h-96 overflow-auto rounded-md p-3"
                        style={{ background: "var(--bg-subtle)" }}
                      >
                        {article.content}
                      </pre>
                    ) : (
                      <p style={muted}>
                        Original title and available metadata are preserved.
                        Full article text has not been recovered.
                      </p>
                    )}
                    {article.provenance?.map((source, index) => (
                      <p
                        key={index}
                        className="text-xs break-all"
                        style={muted}
                      >
                        Source: {source.path}
                        {source.notes
                          ? ` · ${Array.isArray(source.notes) ? source.notes.join(" ") : source.notes}`
                          : ""}
                      </p>
                    ))}
                  </div>
                </details>
              ))}
              {!visibleArticles.length && (
                <p className="py-4 text-sm" style={muted}>
                  No matching source records in the selected issues.
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {review && (
        <section
          ref={reviewRef}
          className="rounded-lg p-4 space-y-4"
          style={panelStyle}
          aria-label="Import results"
        >
          <h2 className="font-semibold flex items-center gap-2">
            {imported && (
              <CheckCircle
                className="w-5 h-5"
                style={{ color: "var(--status-success)" }}
              />
            )}
            {imported
              ? "Source archive import complete"
              : "Reviewed database changes"}
          </h2>
          <p className="text-sm" style={muted}>
            {review.summary.publications} publications · {review.summary.create}{" "}
            new articles · {review.summary.link} existing articles to link ·{" "}
            {review.summary.existing} already imported ·{" "}
            {review.summary.conflicts} conflicts · {review.summary.excluded}{" "}
            inventory records excluded
          </p>
          {review.files && (
            <p className="text-sm" style={muted}>
              {review.files.referenced} original files referenced ·{" "}
              {review.files.available} available · {review.files.missing}{" "}
              missing
              {review.files.created !== undefined
                ? ` · ${review.files.created} newly attached`
                : ""}
              {review.files.skipped ? ` · ${review.files.skipped} already attached` : ""}
              {review.files.failed
                ? ` · ${review.files.failed} file imports need retry`
                : ""}
            </p>
          )}
          {review.warnings.length > 0 && (
            <ul className="list-disc pl-5 text-sm space-y-1" style={muted}>
              {review.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
          {!imported && (
            <button
              className="btn btn-primary"
              disabled={
                !!busy ||
                !(
                  review.summary.create +
                  review.summary.link +
                  (review.files?.available || 0)
                )
              }
              onClick={() => void runImport(false)}
            >
              {busy === "import" && <LoadingSpinner size="sm" />} Import
              reviewed records
            </button>
          )}
          {imported && (
            <div
              className="flex flex-wrap gap-3 text-sm"
              style={{ color: "var(--accent)" }}
            >
              <Link to="/publications">Open Publications →</Link>
              <Link to="/articles" search={{ status: "Archived" }}>
                Open archived Articles →
              </Link>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
                  <th className="p-2">Original article</th>
                  <th className="p-2">Byline</th>
                  <th className="p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {review.articles.map((article) => (
                  <tr
                    key={`${article.sourceKey}-${article.issueId || article.documentIds.join("_")}`}
                    style={{ borderBottom: "1px solid var(--border-subtle)" }}
                  >
                    <td className="p-2">
                      {imported &&
                      article.articleId &&
                      !["conflict", "excluded"].includes(article.action) ? (
                        <Link
                          to="/article/$articleId"
                          params={{ articleId: article.articleId }}
                          style={{ color: "var(--accent)" }}
                        >
                          {article.title}
                        </Link>
                      ) : (
                        article.title
                      )}
                      {article.missingBody && (
                        <span className="block text-xs" style={muted}>
                          Metadata only
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {article.authorName || "Author not recorded"}
                    </td>
                    <td className="p-2">
                      <span className="capitalize">{article.action}</span>
                      {article.reason && (
                        <span className="block text-xs" style={muted}>
                          {article.reason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
