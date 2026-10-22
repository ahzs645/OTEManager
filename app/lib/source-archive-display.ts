export type SourceArticleProvenance = {
  archiveId: string;
  sourceKey: string;
  originalAuthorName?: string | null;
  kind?: string;
  recoveryStatus?: string;
  bodyFormat?: string;
  sourceVisibility?: string;
  originalArticleId?: string;
  originalDates?: {
    submittedAt?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  placements: Array<{
    documentId: string;
    pageNumbers: number[];
    section?: string;
  }>;
  provenance: Array<{ path: string }>;
};

export function readSourceProvenance(
  value: unknown,
): SourceArticleProvenance | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const source = parsed as Record<string, unknown>;
    if (
      source.schemaVersion !== "ote.source-article-provenance.v1" ||
      typeof source.archiveId !== "string" ||
      typeof source.sourceKey !== "string"
    )
      return null;
    return {
      archiveId: source.archiveId,
      sourceKey: source.sourceKey,
      originalAuthorName:
        typeof source.originalAuthorName === "string"
          ? source.originalAuthorName
          : null,
      kind: typeof source.kind === "string" ? source.kind : undefined,
      recoveryStatus:
        typeof source.recoveryStatus === "string"
          ? source.recoveryStatus
          : undefined,
      bodyFormat:
        typeof source.bodyFormat === "string" ? source.bodyFormat : undefined,
      sourceVisibility:
        typeof source.sourceVisibility === "string"
          ? source.sourceVisibility
          : undefined,
      originalArticleId:
        typeof source.originalArticleId === "string"
          ? source.originalArticleId
          : undefined,
      originalDates:
        source.originalDates && typeof source.originalDates === "object"
          ? Object.fromEntries(
              ["submittedAt", "createdAt", "updatedAt"].flatMap((key) => {
                const value = (source.originalDates as Record<string, unknown>)[
                  key
                ];
                return typeof value === "string" &&
                  Number.isFinite(Date.parse(value))
                  ? [[key, value]]
                  : [];
              }),
            )
          : undefined,
      placements: Array.isArray(source.placements)
        ? source.placements.flatMap((item: unknown) => {
            if (!item || typeof item !== "object") return [];
            const placement = item as Record<string, unknown>;
            return typeof placement.documentId === "string"
              ? [
                  {
                    documentId: placement.documentId,
                    pageNumbers: Array.isArray(placement.pageNumbers)
                      ? placement.pageNumbers.filter(
                          (page: unknown): page is number =>
                            typeof page === "number" &&
                            Number.isSafeInteger(page) &&
                            page > 0,
                        )
                      : [],
                    section:
                      typeof placement.section === "string"
                        ? placement.section
                        : undefined,
                  },
                ]
              : [];
          })
        : [],
      provenance: Array.isArray(source.provenance)
        ? source.provenance.flatMap((item: unknown) =>
            item &&
            typeof item === "object" &&
            typeof (item as Record<string, unknown>).path === "string"
              ? [{ path: (item as { path: string }).path }]
              : [],
          )
        : [],
    };
  } catch {
    return null;
  }
}

export function sourceRecoveryLabel(status?: string): string {
  switch (status) {
    case "complete":
      return "Original full text";
    case "recovered":
      return "Recovered text";
    case "source-backup":
      return "Original backup text";
    case "source-idml":
      return "Recovered from original layout";
    case "metadata-only":
      return "Metadata only · text not recovered";
    default:
      return status
        ? status.replaceAll("-", " ")
        : "Recovery status not recorded";
  }
}

type ArticleDisplay = {
  sourceProvenance?: string | null;
  author?: { givenName: string; surname: string } | null;
  submittedAt: Date | null;
  createdAt: Date;
};

export function articleDisplayAuthor(article: ArticleDisplay): string {
  const source = readSourceProvenance(article.sourceProvenance);
  if (source) return source.originalAuthorName?.trim() || "Author not recorded";
  return article.author
    ? `${article.author.givenName} ${article.author.surname}`.trim()
    : "Unknown";
}

export function articleDisplaySubmitted(article: ArticleDisplay): Date | null {
  const source = readSourceProvenance(article.sourceProvenance);
  if (source?.originalDates?.submittedAt)
    return new Date(source.originalDates.submittedAt);
  return article.submittedAt || (source ? null : article.createdAt);
}

export function sourceVisibilityLabel(value?: string): string | undefined {
  if (value === "alternate-idml-not-in-paired-pdf")
    return "Recovered from another original layout revision; this article is not visible in the paired PDF.";
  if (value === "not-in-pdf")
    return "This original article record is not visible in the paired PDF layout.";
  return undefined;
}
