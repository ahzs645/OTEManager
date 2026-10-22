import { Store } from "../lib/store";
import { fromDocument } from "../../shared/records";
import { validateFilePath } from "../../shared/file-path";
import type {
  Attachments,
  Articles,
  Issues,
  Volumes,
} from "../../shared/model";
import {
  eligibleSourceArticle,
  normalizeSourceText,
  parseSourceArchiveBundle,
  parseSourceProvenance,
  sourceArticleFingerprint,
  sourceDigest,
  sourcePublicationKey,
  sourceUuid,
  type SourceArchiveArticle,
  type SourceArchiveBundle,
  type SourceArchiveIssue,
  type SourceArchivePreview,
  type SourceArticleProvenance,
} from "../../shared/source-archive";

interface Request {
  bundle: unknown;
  documentIds?: string[];
  previewToken?: string;
}
interface Target {
  source: SourceArchiveArticle;
  documents: SourceArchiveIssue[];
  publicationKey: string;
  fingerprint: string;
  row: SourceArchivePreview["articles"][number];
}
interface Plan {
  bundle: SourceArchiveBundle;
  selected: SourceArchiveIssue[];
  preview: SourceArchivePreview;
  targets: Target[];
  issues: Map<
    string,
    {
      source: SourceArchiveIssue;
      volume: Volumes | null;
      issue: Issues | null;
      volumeId: string;
      issueId: string;
    }
  >;
}
const normalize = (value: string) => normalizeSourceText(value).toLowerCase();
const unique = <T>(items: T[]) => [...new Set(items)];
async function indexed(
  s: Store,
  table: string,
  index: string,
  fields: Record<string, unknown>,
  limit = 1001,
): Promise<any[]> {
  const rows = await s.ctx.db
    .query(table)
    .withIndex(index, (q: any) =>
      Object.entries(fields).reduce(
        (cursor, [key, value]) => cursor.eq(key, value),
        q,
      ),
    )
    .take(limit);
  if (rows.length === limit)
    throw new Error(
      `Source archive lookup exceeds its safe ${limit - 1} record limit`,
    );
  return rows.map((row: any) =>
    table === "storedFiles" ? row : fromDocument(table as any, row),
  );
}
async function one(
  s: Store,
  table: string,
  index: string,
  fields: Record<string, unknown>,
) {
  const rows = await indexed(s, table, index, fields, 2);
  return rows[0] ?? null;
}
function sameCopy(a: Articles, source: SourceArchiveArticle) {
  const original = parseSourceProvenance(a.sourceProvenance);
  return (
    normalize(a.title) === normalize(source.title) &&
    normalizeSourceText(a.content ?? "") ===
      normalizeSourceText(source.content) &&
    normalize(original?.originalAuthorName ?? "") ===
      normalize(source.authorName ?? "")
  );
}
async function planArchive(s: Store, request: Request): Promise<Plan> {
  const bundle = parseSourceArchiveBundle(request.bundle);
  if (
    request.documentIds &&
    (!Array.isArray(request.documentIds) ||
      request.documentIds.some(
        (id) =>
          typeof id !== "string" ||
          !bundle.issues.some((issue) => issue.documentId === id),
      ))
  )
    throw new Error("Unknown selected source document");
  const ids = new Set(
    request.documentIds ?? bundle.issues.map((issue) => issue.documentId),
  );
  const selected = bundle.issues.filter((issue) => ids.has(issue.documentId));
  if (!selected.length) throw new Error("Select at least one source document");
  const issues: Plan["issues"] = new Map();
  const publications: SourceArchivePreview["publications"] = [];
  for (const source of selected) {
    const key = sourcePublicationKey(source);
    let target = issues.get(key);
    if (!target) {
      const volume: Volumes | null = await one(
        s,
        "volumes",
        "by_volumeNumber",
        { volumeNumber: source.volumeNumber },
      );
      const volumeId =
        volume?.id ?? sourceUuid(`source-volume|${source.volumeNumber}`);
      const issue: Issues | null = volume
        ? await one(s, "issues", "by_volumeId_and_issueNumber", {
            volumeId,
            issueNumber: source.issueNumber,
          })
        : null;
      target = {
        source,
        volume,
        issue,
        volumeId,
        issueId: issue?.id ?? sourceUuid(`source-issue|${key}`),
      };
      issues.set(key, target);
    }
    publications.push({
      documentId: source.documentId,
      volumeId: target.volumeId,
      issueId: target.issueId,
      action: target.issue ? "existing" : "create",
    });
  }
  const targets: Target[] = [];
  const warnings: string[] = [];
  const plannedFingerprints = new Map<string, Target>();
  const originalPublications = new Map<string, string>();
  for (const source of bundle.articles) {
    const grouped = new Map<string, SourceArchiveIssue[]>();
    for (const document of selected.filter((issue) =>
      source.placements.some(
        (placement) => placement.documentId === issue.documentId,
      ),
    )) {
      const key = sourcePublicationKey(document);
      grouped.set(key, [...(grouped.get(key) ?? []), document]);
    }
    for (const [publicationKey, documents] of grouped) {
      const targetIssue = issues.get(publicationKey)!;
      const fingerprint = sourceArticleFingerprint(source, publicationKey);
      const row: Target["row"] = {
        sourceKey: source.sourceKey,
        title: source.title,
        authorName: source.authorName,
        articleId: null,
        issueId: targetIssue.issueId,
        documentIds: documents.map((document) => document.documentId),
        action: "create",
        reason: null,
        missingBody: !source.content.trim(),
        fillsMissingBody: false,
      };
      const target = { source, documents, publicationKey, fingerprint, row };
      targets.push(target);
      if (!eligibleSourceArticle(source)) {
        row.action = "excluded";
        row.reason =
          "Retained in the source catalogue; this is not a recovered article or editorial";
        continue;
      }
      const link = await one(
        s,
        "sourceArchiveLinks",
        "by_archiveId_and_sourceKey_and_publicationKey",
        {
          archiveId: bundle.archiveId,
          sourceKey: source.sourceKey,
          publicationKey,
        },
      );
      if (link) {
        const existing = await s.get("articles", link.articleId);
        row.articleId = link.articleId;
        if (
          existing &&
          link.sourceFingerprint !== fingerprint &&
          source.originalArticleId === existing.id &&
          !existing.content?.trim() &&
          source.content.trim()
        ) {
          row.action = "link";
          row.fillsMissingBody = true;
          row.reason =
            "Fill the empty original article body from verified recovered copy; other editorial fields remain unchanged";
        } else if (!existing || link.sourceFingerprint !== fingerprint) {
          row.action = "conflict";
          row.reason = !existing
            ? "Source link refers to a missing article"
            : "Source content changed after an earlier import; existing editorial data is preserved";
        } else row.action = "existing";
        continue;
      }
      if (source.originalArticleId) {
        const earlier = originalPublications.get(source.originalArticleId);
        if (earlier && earlier !== publicationKey) {
          row.action = "conflict";
          row.reason =
            "One original article ID cannot be assigned to two publication editions";
          continue;
        }
        originalPublications.set(source.originalArticleId, publicationKey);
        const original = await s.get("articles", source.originalArticleId);
        if (original) {
          if (
            (original.volume !== null &&
              original.volume !== documents[0].volumeNumber) ||
            (original.issue !== null &&
              original.issue !== documents[0].issueNumber)
          ) {
            row.action = "conflict";
            row.articleId = original.id;
            row.reason =
              "Original article belongs to a different publication edition";
          } else {
            row.action = "link";
            row.articleId = original.id;
            row.fillsMissingBody =
              !original.content?.trim() && Boolean(source.content.trim());
            row.reason = row.fillsMissingBody
              ? "Fill the empty original article body from verified recovered copy; other editorial fields remain unchanged"
              : "Exact original article ID; existing copy, status, payment and author fields are preserved";
          }
          continue;
        }
      }
      const candidates: Articles[] = await indexed(
        s,
        "articles",
        "by_sourceFingerprint",
        { sourceFingerprint: fingerprint },
      );
      const match =
        !source.originalArticleId &&
        candidates.find(
          (article) =>
            article.issueId === targetIssue.issueId &&
            sameCopy(article, source),
        );
      const planned = plannedFingerprints.get(fingerprint);
      if (match) {
        row.action = "link";
        row.articleId = match.id;
        row.reason = "Same recovered article in another source variant";
      } else if (
        !source.originalArticleId &&
        planned &&
        normalize(planned.source.title) === normalize(source.title) &&
        normalizeSourceText(planned.source.content) ===
          normalizeSourceText(source.content) &&
        normalize(planned.source.authorName ?? "") ===
          normalize(source.authorName ?? "")
      ) {
        row.action = "link";
        row.articleId = planned.row.articleId;
        row.reason =
          "Same recovered article in another selected source variant";
      } else {
        row.articleId =
          source.originalArticleId ??
          sourceUuid(
            `source-article|${bundle.archiveId}|${source.sourceKey}|${publicationKey}`,
          );
        const collision = await s.get("articles", row.articleId);
        if (collision) {
          row.action = "conflict";
          row.reason =
            "Generated article identity is already used by a different record";
        } else plannedFingerprints.set(fingerprint, target);
      }
    }
  }
  if (selected.some((issue) => !issue.releaseDate))
    warnings.push(
      "Some original release dates are not recorded; they will remain empty.",
    );
  if (
    targets.some(
      (target) =>
        target.row.missingBody && eligibleSourceArticle(target.source),
    )
  )
    warnings.push(
      "Metadata-only articles have no recovered body. No placeholder body or submission date will be invented.",
    );
  const articles = targets.map((target) => target.row);
  const count = (action: string) =>
    articles.filter((article) => article.action === action).length;
  const preview: SourceArchivePreview = {
    success: true,
    archiveId: bundle.archiveId,
    previewToken: sourceDigest(
      JSON.stringify({ bundle, documentIds: [...ids].sort() }),
    ),
    publications,
    articles,
    summary: {
      documents: selected.length,
      publications: issues.size,
      eligible: articles.filter((article) => article.action !== "excluded")
        .length,
      create: count("create"),
      link: count("link"),
      existing: count("existing"),
      conflicts: count("conflict"),
      excluded: count("excluded"),
      missingBodies: articles.filter(
        (article) => article.action !== "excluded" && article.missingBody,
      ).length,
    },
    warnings,
  };
  return { bundle, selected, preview, targets, issues };
}
function mergeProvenance(
  existing: string | null | undefined,
  bundle: SourceArchiveBundle,
  source: SourceArchiveArticle,
): string {
  const prior = parseSourceProvenance(existing);
  const value: SourceArticleProvenance = {
    schemaVersion: "ote.source-article-provenance.v1",
    archiveId: prior?.archiveId ?? bundle.archiveId,
    sourceKey: prior?.sourceKey ?? source.sourceKey,
    sourceKeys: unique([...(prior?.sourceKeys ?? []), source.sourceKey]),
    originalAuthorName: prior?.originalAuthorName ?? source.authorName,
    kind: prior?.kind ?? source.kind,
    recoveryStatus:
      prior?.recoveryStatus === "metadata-only" && source.content.trim()
        ? (source.recoveryStatus ?? "recovered")
        : (prior?.recoveryStatus ?? source.recoveryStatus ?? null),
    bodyFormat:
      prior?.recoveryStatus === "metadata-only" && source.content.trim()
        ? source.bodyFormat
        : (prior?.bodyFormat ?? source.bodyFormat),
    originalArticleId:
      prior?.originalArticleId ?? source.originalArticleId ?? null,
    originalAuthorSourceId:
      prior?.originalAuthorSourceId ?? source.authorSourceId ?? null,
    sourceVisibility:
      prior?.recoveryStatus === "metadata-only" && source.content.trim()
        ? (source.sourceVisibility ?? prior?.sourceVisibility ?? null)
        : (prior?.sourceVisibility ?? source.sourceVisibility ?? null),
    ...(prior?.originalDates || source.originalDates
      ? {
          originalDates: {
            submittedAt:
              prior?.originalDates?.submittedAt ??
              source.originalDates?.submittedAt ??
              null,
            createdAt:
              prior?.originalDates?.createdAt ??
              source.originalDates?.createdAt ??
              null,
            updatedAt:
              prior?.originalDates?.updatedAt ??
              source.originalDates?.updatedAt ??
              null,
          },
        }
      : {}),
    placements: unique(
      [...(prior?.placements ?? []), ...source.placements].map((item) =>
        JSON.stringify(item),
      ),
    ).map((item) => JSON.parse(item)),
    provenance: unique(
      [...(prior?.provenance ?? []), ...source.provenance].map((item) =>
        JSON.stringify(item),
      ),
    ).map((item) => JSON.parse(item)),
  };
  return JSON.stringify(value);
}
async function sourceAuthor(
  s: Store,
  bundle: SourceArchiveBundle,
  source: SourceArchiveArticle,
) {
  if (source.authorSourceId) {
    const original = await s.get("authors", source.authorSourceId);
    if (original) return original;
  }
  const sourceAuthorKey = `${bundle.archiveId}|${source.authorSourceId ? `id:${source.authorSourceId}` : source.authorName?.trim() ? `byline:${normalize(source.authorName)}` : "unattributed"}`;
  const existing = await one(s, "authors", "by_sourceAuthorKey", {
    sourceAuthorKey,
  });
  if (existing) return existing;
  return s.insert("authors", {
    id: source.authorSourceId ?? sourceUuid(`source-author|${sourceAuthorKey}`),
    sourceAuthorKey,
    givenName: source.authorName?.trim() || "Author not recorded",
    surname: "",
    email: "",
    role: null,
    authorType: null,
    studentType: null,
    autoDepositAvailable: null,
    etransferEmail: null,
  });
}
export const sourceArchiveQueries = {
  previewSourceArchive: async (s: Store, request: Request) =>
    (await planArchive(s, request)).preview,
};
export const sourceArchiveMutations = {
  addSourceArchiveAttachment: async (
    s: Store,
    request: {
      articleId: string;
      sourceKey: string;
      archiveId?: string;
      filePath: string;
      fileName: string;
      originalFileName: string;
      attachmentType: Attachments["attachmentType"];
      fileSize: number;
      mimeType: string | null;
      caption?: string | null;
      photoNumber?: number | null;
      sha256?: string;
    },
  ) => {
    const article = await s.require("articles", request.articleId);
    const links = await indexed(s, "sourceArchiveLinks", "by_articleId", {
      articleId: article.id,
    });
    if (
      !links.some(
        (link) =>
          link.sourceKey === request.sourceKey &&
          (!request.archiveId || link.archiveId === request.archiveId),
      )
    )
      throw new Error(
        "Attachment does not belong to an imported source article",
      );
    const filePath = validateFilePath(request.filePath);
    if (
      !Number.isSafeInteger(request.fileSize) ||
      request.fileSize < 0 ||
      request.fileSize > 100 * 1024 ** 2 ||
      !request.fileName ||
      !request.originalFileName ||
      (request.sha256 && !/^[a-f0-9]{64}$/i.test(request.sha256))
    )
      throw new Error("Invalid source attachment metadata");
    const stored = await one(s, "storedFiles", "by_path", { path: filePath });
    if (
      !stored ||
      stored.size !== request.fileSize ||
      (request.sha256 &&
        stored.sha256?.toLowerCase() !== request.sha256.toLowerCase())
    )
      throw new Error("Source attachment bytes have not been stored");
    const existing = (
      await indexed(s, "attachments", "by_articleId", { articleId: article.id })
    ).find((attachment) => attachment.filePath === filePath);
    if (existing)
      return { success: true as const, created: false, attachment: existing };
    const attachment = await s.insert("attachments", {
      id: sourceUuid(`source-attachment|${article.id}|${filePath}`),
      articleId: article.id,
      filePath,
      fileName: request.fileName,
      originalFileName: request.originalFileName,
      attachmentType: request.attachmentType,
      fileSize: request.fileSize,
      mimeType: request.mimeType,
      caption: request.caption ?? null,
      photoNumber: request.photoNumber ?? null,
      includeInExport: true,
    });
    return { success: true as const, created: true, attachment };
  },
  importSourceArchive: async (s: Store, request: Request) => {
    const plan = await planArchive(s, request);
    if (
      !request.previewToken ||
      request.previewToken !== plan.preview.previewToken
    )
      throw new Error(
        "Review this source archive preview before importing the same manifest and selected documents",
      );
    for (const [publicationKey, target] of plan.issues) {
      if (!target.volume) {
        const existingVolume = await s.get("volumes", target.volumeId);
        if (
          existingVolume &&
          existingVolume.volumeNumber !== target.source.volumeNumber
        )
          throw new Error("Source volume identity collision");
        target.volume =
          existingVolume ??
          (await s.insert("volumes", {
            id: target.volumeId,
            volumeNumber: target.source.volumeNumber,
            year: null,
            startDate: null,
            endDate: null,
          }));
      }
      const docs = plan.selected.filter(
        (issue) => sourcePublicationKey(issue) === publicationKey,
      );
      const knownDate = docs.find((issue) => issue.releaseDate)?.releaseDate;
      let previous: any = null;
      try {
        previous = target.issue?.sourceProvenance
          ? JSON.parse(target.issue.sourceProvenance)
          : null;
      } catch {
        /* Preserve source data through the explicit current fields below. */
      }
      const sources = unique(
        [
          ...(Array.isArray(previous?.documents) ? previous.documents : []),
          ...docs,
        ].map((doc) => JSON.stringify(doc)),
      )
        .map((doc) => JSON.parse(doc))
        .sort((a, b) => a.documentId.localeCompare(b.documentId));
      const provenance = JSON.stringify({
        schemaVersion: "ote.source-publication-provenance.v1",
        archiveId: plan.bundle.archiveId,
        publicationKey,
        documents: sources,
      });
      if (!target.issue)
        target.issue = await s.insert("issues", {
          id: target.issueId,
          volumeId: target.volumeId,
          issueNumber: target.source.issueNumber,
          title: null,
          releaseDate: knownDate ? new Date(knownDate + "T00:00:00Z") : null,
          sourceProvenance: provenance,
        });
      else if (
        provenance !== target.issue.sourceProvenance ||
        (previous?.schemaVersion === "ote.source-publication-provenance.v1" &&
          !target.issue.releaseDate &&
          knownDate)
      )
        await s.patch("issues", target.issue.id, {
          sourceProvenance: provenance,
          ...(previous?.schemaVersion ===
            "ote.source-publication-provenance.v1" &&
          !target.issue.releaseDate &&
          knownDate
            ? { releaseDate: new Date(knownDate + "T00:00:00Z") }
            : {}),
        });
    }
    const results: {
      sourceKey: string;
      articleId: string | null;
      issueId: string | null;
      action: string;
      reason: string | null;
    }[] = [];
    for (const target of plan.targets) {
      const { source, row, publicationKey, fingerprint } = target;
      if (row.action === "conflict" || row.action === "excluded") {
        results.push({ ...row });
        continue;
      }
      let article = await s.get("articles", row.articleId!);
      if (!article) {
        if (row.action !== "create")
          throw new Error(
            "Source variant refers to an article that has not been created",
          );
        const author = await sourceAuthor(s, plan.bundle, source);
        article = await s.insert("articles", {
          id: row.articleId!,
          title: source.title,
          authorId: author.id,
          content: source.content.trim() ? source.content : null,
          volume: target.documents[0].volumeNumber,
          issue: target.documents[0].issueNumber,
          issueId: row.issueId,
          internalStatus: "Archived",
          automationStatus: null,
          articleTier: null,
          paymentStatus: null,
          paymentAmount: null,
          paymentIsManual: null,
          paymentRateSnapshot: null,
          paymentCalculatedAt: null,
          paidAt: null,
          isFeatured: null,
          hasResearchBonus: null,
          hasTimeSensitiveBonus: null,
          hasMultimediaBonus: null,
          hasProfessionalPhotos: null,
          hasProfessionalGraphics: null,
          prefersAnonymity: source.prefersAnonymity ?? null,
          submittedAt: source.originalDates?.submittedAt
            ? new Date(source.originalDates.submittedAt)
            : null,
          sourceImportKey: `${plan.bundle.archiveId}|${source.sourceKey}|${publicationKey}`,
          sourceFingerprint: fingerprint,
          sourceProvenance: mergeProvenance(null, plan.bundle, source),
        });
      } else {
        const provenance = mergeProvenance(
          article.sourceProvenance,
          plan.bundle,
          source,
        );
        if (provenance !== article.sourceProvenance || row.fillsMissingBody)
          article = await s.patch("articles", article.id, {
            sourceProvenance: provenance,
            ...(row.fillsMissingBody && !article.content?.trim()
              ? {
                  content: source.content,
                  ...(article.sourceImportKey
                    ? { sourceFingerprint: fingerprint }
                    : {}),
                }
              : {}),
          });
      }
      const currentLink = await one(
        s,
        "sourceArchiveLinks",
        "by_archiveId_and_sourceKey_and_publicationKey",
        {
          archiveId: plan.bundle.archiveId,
          sourceKey: source.sourceKey,
          publicationKey,
        },
      );
      if (currentLink && currentLink.sourceFingerprint !== fingerprint)
        await s.patch("sourceArchiveLinks", currentLink.id, {
          sourceFingerprint: fingerprint,
        });
      else if (!currentLink)
        await s.insert("sourceArchiveLinks", {
          id: sourceUuid(
            `source-link|${plan.bundle.archiveId}|${source.sourceKey}|${publicationKey}`,
          ),
          archiveId: plan.bundle.archiveId,
          sourceKey: source.sourceKey,
          publicationKey,
          articleId: article.id,
          sourceFingerprint: fingerprint,
        });
      results.push({ ...row });
    }
    return {
      ...plan.preview,
      imported: results.filter((row) => row.action === "create").length,
      linked: results.filter((row) => row.action === "link").length,
      existing: results.filter((row) => row.action === "existing").length,
      conflicts: results.filter((row) => row.action === "conflict").length,
      results,
    };
  },
};
