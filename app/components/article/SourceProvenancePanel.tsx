import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Section } from "~/components/Layout";
import {
  readSourceProvenance,
  sourceRecoveryLabel,
  sourceVisibilityLabel,
} from "~/lib/source-archive-display";

type SourceDocument = { documentId: string; label: string; pdf: string };

export function SourceProvenancePanel({
  value,
}: {
  value: string | null | undefined;
}) {
  const source = readSourceProvenance(value);
  const archiveId = source?.archiveId;
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  useEffect(() => {
    if (!archiveId) return;
    const controller = new AbortController();
    fetch("/designcraft/source-issues.json", { signal: controller.signal })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { issues?: unknown[] })
          : null,
      )
      .then((catalogue) => {
        if (controller.signal.aborted) return;
        setDocuments(
          (catalogue?.issues || []).flatMap((item: unknown) => {
            if (!item || typeof item !== "object") return [];
            const document = item as Record<string, unknown>;
            return typeof document.documentId === "string" &&
              typeof document.label === "string" &&
              typeof document.pdf === "string" &&
              /^originals\/[a-zA-Z0-9._-]+\.pdf$/.test(document.pdf)
              ? [
                  {
                    documentId: document.documentId,
                    label: document.label,
                    pdf: document.pdf,
                  },
                ]
              : [];
          }),
        );
      })
      .catch(() => {});
    return () => controller.abort();
  }, [archiveId]);
  if (!source) return null;
  return (
    <Section title="Original source">
      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
            Original byline
          </p>
          <p>{source.originalAuthorName || "Author not recorded"}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
            Article recovery
          </p>
          <p>{sourceRecoveryLabel(source.recoveryStatus)}</p>
        </div>
        {sourceVisibilityLabel(source.sourceVisibility) && (
          <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
            {sourceVisibilityLabel(source.sourceVisibility)}
          </p>
        )}
        {source.originalDates &&
          Object.entries(source.originalDates).map(([key, date]) => (
            <div key={key}>
              <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
                {key === "submittedAt"
                  ? "Original submission"
                  : key === "createdAt"
                    ? "Original record created"
                    : "Original record updated"}
              </p>
              <time dateTime={date} className="text-xs">
                {date.replace("T", " ").replace(/(?:\.000)?Z$/, " UTC")}
              </time>
            </div>
          ))}
        {source.placements.map((placement, index) => {
          const document = documents.find(
            (item) => item.documentId === placement.documentId,
          );
          const pages = placement.pageNumbers.length
            ? `Page${placement.pageNumbers.length === 1 ? "" : "s"} ${placement.pageNumbers.join(", ")}`
            : "Page not identified";
          return (
            <div key={`${placement.documentId}-${index}`}>
              <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
                {pages}
                {placement.section ? ` · ${placement.section}` : ""}
              </p>
              {document ? (
                <a
                  href={`/designcraft/${document.pdf}${placement.pageNumbers[0] ? `#page=${placement.pageNumbers[0]}` : ""}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)" }}
                >
                  {document.label} ↗
                </a>
              ) : (
                <p className="break-words">{placement.documentId}</p>
              )}
            </div>
          );
        })}
        {source.provenance.map((file, index) => (
          <p
            key={index}
            className="text-xs break-all"
            style={{ color: "var(--fg-muted)" }}
          >
            Source: {file.path}
          </p>
        ))}
        {source.originalArticleId && (
          <p className="text-xs break-all" style={{ color: "var(--fg-muted)" }}>
            Original article ID: {source.originalArticleId}
          </p>
        )}
        <Link
          to="/utilities/source-archive"
          className="text-xs"
          style={{ color: "var(--accent)" }}
        >
          Review source archive →
        </Link>
      </div>
    </Section>
  );
}
