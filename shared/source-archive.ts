import { z } from "zod";

const boundedText = (max: number) => z.string().max(max);
const sourceFile = z
  .object({
    path: boundedText(1000).min(1),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    url: z.string().url().optional(),
  })
  .passthrough();
const issueSchema = z
  .object({
    documentId: boundedText(200).min(1),
    label: boundedText(500).min(1),
    volumeNumber: z.number().int().min(1).max(1000),
    issueNumber: z.number().int().min(1).max(1000),
    releaseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    pageCount: z.number().int().min(1).max(256),
    source: sourceFile,
  })
  .passthrough();
const placementSchema = z
  .object({
    documentId: boundedText(200).min(1),
    pageNumbers: z.array(z.number().int().min(1).max(256)).max(256),
    section: boundedText(300).nullable().optional(),
  })
  .passthrough();
const sourceDatesSchema = z.object({
  submittedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }).nullable(),
  updatedAt: z.string().datetime({ offset: true }).nullable(),
});
const articleSchema = z
  .object({
    sourceKey: boundedText(200).min(1),
    title: boundedText(2000).min(1),
    authorName: boundedText(500).nullable(),
    content: boundedText(500000),
    bodyFormat: z.enum(["plain", "markdown"]),
    kind: z.enum([
      "article",
      "editorial",
      "recurring",
      "photo-feature",
      "placeholder",
    ]),
    placements: z.array(placementSchema).min(1).max(64),
    provenance: z.array(sourceFile).min(1).max(64),
    photos: z.array(z.record(z.unknown())).max(100).default([]),
    originalArticleId: boundedText(200).min(1).optional(),
    authorSourceId: boundedText(200).min(1).optional(),
    recoveryStatus: boundedText(100).optional(),
    sourceVisibility: boundedText(100).optional(),
    prefersAnonymity: z.boolean().nullable().optional(),
    originalDates: sourceDatesSchema.optional(),
  })
  .passthrough();
const archiveSchema = z
  .object({
    schemaVersion: z.literal("ote.source-archive.v1"),
    archiveId: boundedText(200).min(1),
    issues: z.array(issueSchema).min(1).max(64),
    articles: z.array(articleSchema).max(1000),
    assets: z.array(z.record(z.unknown())).max(2000).default([]),
    coverage: z.record(z.unknown()).default({}),
  })
  .passthrough();

export type SourceArchiveBundle = z.infer<typeof archiveSchema>;
export type SourceArchiveIssue = z.infer<typeof issueSchema>;
export type SourceArchiveArticle = z.infer<typeof articleSchema>;
export type SourceArchiveAction =
  "create" | "link" | "existing" | "conflict" | "excluded";
export interface SourceArchivePreview {
  success: true;
  archiveId: string;
  previewToken: string;
  summary: {
    documents: number;
    publications: number;
    eligible: number;
    create: number;
    link: number;
    existing: number;
    conflicts: number;
    excluded: number;
    missingBodies: number;
  };
  publications: {
    documentId: string;
    volumeId: string;
    issueId: string;
    action: "create" | "existing";
  }[];
  articles: {
    sourceKey: string;
    title: string;
    authorName: string | null;
    articleId: string | null;
    issueId: string | null;
    documentIds: string[];
    action: SourceArchiveAction;
    reason: string | null;
    missingBody: boolean;
    fillsMissingBody?: boolean;
  }[];
  warnings: string[];
}
export interface SourceArticleProvenance {
  schemaVersion: "ote.source-article-provenance.v1";
  archiveId: string;
  sourceKey: string;
  originalAuthorName: string | null;
  kind: SourceArchiveArticle["kind"];
  recoveryStatus: string | null;
  bodyFormat: SourceArchiveArticle["bodyFormat"];
  originalArticleId: string | null;
  originalAuthorSourceId?: string | null;
  sourceVisibility?: string | null;
  originalDates?: SourceArchiveArticle["originalDates"];
  placements: SourceArchiveArticle["placements"];
  provenance: SourceArchiveArticle["provenance"];
  sourceKeys: string[];
}

export function parseSourceArchiveBundle(input: unknown): SourceArchiveBundle {
  let value: unknown = input;
  if (typeof value === "string") value = JSON.parse(value);
  const serialized = JSON.stringify(value);
  if (
    !serialized ||
    new TextEncoder().encode(serialized).length > 6 * 1024 ** 2
  )
    throw new Error("Source metadata must fit within 6 MiB");
  const result = archiveSchema.safeParse(value);
  if (!result.success)
    throw new Error(
      "Invalid source archive: " +
        result.error.issues
          .slice(0, 5)
          .map((issue) => issue.path.join(".") + " " + issue.message)
          .join("; "),
    );
  const bundle = result.data;
  const documents = new Map<string, SourceArchiveIssue>();
  for (const issue of bundle.issues) {
    if (documents.has(issue.documentId))
      throw new Error("Duplicate source document ID");
    if (
      issue.releaseDate &&
      new Date(issue.releaseDate + "T00:00:00Z").toISOString().slice(0, 10) !==
        issue.releaseDate
    )
      throw new Error("Invalid source release date");
    documents.set(issue.documentId, issue);
  }
  const keys = new Set<string>();
  for (const article of bundle.articles) {
    if (keys.has(article.sourceKey))
      throw new Error("Duplicate source article key");
    keys.add(article.sourceKey);
    for (const placement of article.placements) {
      const document = documents.get(placement.documentId);
      if (
        !document ||
        placement.pageNumbers.some((page) => page > document.pageCount) ||
        new Set(placement.pageNumbers).size !== placement.pageNumbers.length
      )
        throw new Error(
          "Source article placement is outside its source document",
        );
    }
  }
  return bundle;
}

export function parseSourceProvenance(
  value: unknown,
): SourceArticleProvenance | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed?.schemaVersion === "ote.source-article-provenance.v1"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export const normalizeSourceText = (value: string) =>
  value.normalize("NFC").replace(/\s+/gu, " ").trim();
export const sourcePublicationKey = (
  issue: Pick<SourceArchiveIssue, "volumeNumber" | "issueNumber">,
) => `${issue.volumeNumber}:${issue.issueNumber}`;
export const eligibleSourceArticle = (article: SourceArchiveArticle) =>
  ["article", "editorial"].includes(article.kind) &&
  (Boolean(article.content.trim()) ||
    article.recoveryStatus === "metadata-only");

/** Stable non-security identity digest; every match is checked against its full source key/copy. */
export function sourceDigest(value: string): string {
  let a = 2166136261,
    b = 2246822507,
    c = 3266489909,
    d = 668265263;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ code, 3266489917);
    c = Math.imul(c ^ code, 668265263);
    d = Math.imul(d ^ code, 374761393);
  }
  return [a, b, c, d]
    .map((n) => (n >>> 0).toString(16).padStart(8, "0"))
    .join("");
}
export function sourceUuid(value: string): string {
  const hex = sourceDigest(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
export const sourceArticleFingerprint = (
  article: SourceArchiveArticle,
  publicationKey: string,
) =>
  sourceDigest(
    JSON.stringify([
      publicationKey,
      normalizeSourceText(article.title).toLowerCase(),
      normalizeSourceText(article.content),
      normalizeSourceText(article.authorName ?? "").toLowerCase(),
      article.bodyFormat,
    ]),
  );
