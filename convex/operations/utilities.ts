import { Store } from "../lib/store";
import { articleDetails } from "./queries";
import { deleteArticleRecord, deleteAttachmentRecord } from "./mutations";
type DuplicateFile = {
  id: string;
  articleId: string;
  articleTitle: string;
  attachmentType: string;
  fileName: string;
  originalFileName: string;
  filePath: string;
  fileSize: number | null;
  caption: string | null;
  createdAt: string;
};

type DuplicateGroup = {
  key: string;
  matchType: "exact" | "similar" | "size";
  files: DuplicateFile[];
};

// Normalize filename for comparison - removes extension and converts to lowercase
function normalizeFileName(fileName: string): string {
  // Remove extension and normalize
  const lastDot = fileName.lastIndexOf(".");
  const baseName = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  return baseName
    .toLowerCase()
    .replace(/[_\-\s]+/g, "_")
    .trim();
}

export const utilityQueries = {
  async findDuplicates(s: Store) {
    const authorMap = new Map((await s.all("authors")).map((a) => [a.id, a]));
    const allArticles = (await s.all("articles"))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((a) => ({
        ...a,
        authorGivenName: authorMap.get(a.authorId)?.givenName || "",
        authorSurname: authorMap.get(a.authorId)?.surname || "",
        authorEmail: authorMap.get(a.authorId)?.email || "",
      }));
    // Group by normalized title + author
    const groups = new Map<string, typeof allArticles>();

    for (const article of allArticles) {
      // Normalize title: lowercase, remove extra spaces, trim
      const normalizedTitle = article.title
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

      // Create key from title + author email
      const key = `${normalizedTitle}|${article.authorEmail?.toLowerCase() || ""}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(article);
    }

    // Filter to only groups with duplicates
    const duplicateGroups = Array.from(groups.entries())
      .filter(([_, articles]) => articles.length > 1)
      .map(([key, articles]) => ({
        key,
        articles: articles.map((a) => ({
          ...a,
          submittedAt: a.submittedAt?.toISOString() || null,
          createdAt: a.createdAt.toISOString(),
        })),
      }));

    return {
      totalArticles: allArticles.length,
      duplicateGroups,
      totalDuplicates: duplicateGroups.reduce<number>(
        (sum, g) => sum + g.articles.length - 1,
        0,
      ),
    };
  },
  async findDuplicateFiles(s: Store) {
    const articles = new Map((await s.all("articles")).map((a) => [a.id, a]));
    const allAttachments = (await s.all("attachments"))
      .sort((a, b) => a.originalFileName.localeCompare(b.originalFileName))
      .map((a) => ({
        ...a,
        articleTitle: articles.get(a.articleId)?.title || "Unknown Article",
      }));
    // Group by normalized original filename (same name, possibly different extension)
    const byNormalizedName = new Map<string, typeof allAttachments>();
    // Group by exact original filename
    const byExactName = new Map<string, typeof allAttachments>();
    // Group by file size (for potential identical files)
    const bySize = new Map<string, typeof allAttachments>();

    for (const attachment of allAttachments) {
      // Exact name match (including extension)
      const exactKey = attachment.originalFileName.toLowerCase();
      if (!byExactName.has(exactKey)) {
        byExactName.set(exactKey, []);
      }
      byExactName.get(exactKey)!.push(attachment);

      // Normalized name match (same base name, different extension)
      const normalizedKey = normalizeFileName(attachment.originalFileName);
      if (!byNormalizedName.has(normalizedKey)) {
        byNormalizedName.set(normalizedKey, []);
      }
      byNormalizedName.get(normalizedKey)!.push(attachment);

      // File size match (only for files > 1KB to avoid false positives on tiny files)
      if (attachment.fileSize && attachment.fileSize > 1024) {
        const sizeKey = `size_${attachment.fileSize}`;
        if (!bySize.has(sizeKey)) {
          bySize.set(sizeKey, []);
        }
        bySize.get(sizeKey)!.push(attachment);
      }
    }

    // Build duplicate groups, prioritizing exact matches
    const duplicateGroups: DuplicateGroup[] = [];
    const processedIds = new Set<string>();

    // First, add exact name duplicates
    for (const [key, files] of byExactName.entries()) {
      if (files.length > 1) {
        const unprocessed = files.filter((f) => !processedIds.has(f.id));
        if (unprocessed.length > 1) {
          duplicateGroups.push({
            key: `exact_${key}`,
            matchType: "exact",
            files: unprocessed.map((f) => ({
              ...f,
              createdAt: f.createdAt.toISOString(),
              articleTitle: f.articleTitle || "Unknown Article",
            })),
          });
          unprocessed.forEach((f) => processedIds.add(f.id));
        }
      }
    }

    // Then add similar name duplicates (same base name, different extension)
    for (const [key, files] of byNormalizedName.entries()) {
      const unprocessed = files.filter((f) => !processedIds.has(f.id));
      if (unprocessed.length > 1) {
        // Check if they have different extensions (not already caught by exact match)
        const extensions = new Set(
          unprocessed.map((f) => {
            const lastDot = f.originalFileName.lastIndexOf(".");
            return lastDot > 0
              ? f.originalFileName.slice(lastDot).toLowerCase()
              : "";
          }),
        );
        if (extensions.size > 1) {
          duplicateGroups.push({
            key: `similar_${key}`,
            matchType: "similar",
            files: unprocessed.map((f) => ({
              ...f,
              createdAt: f.createdAt.toISOString(),
              articleTitle: f.articleTitle || "Unknown Article",
            })),
          });
          unprocessed.forEach((f) => processedIds.add(f.id));
        }
      }
    }

    // Finally add same-size duplicates (potential identical files with different names)
    for (const [key, files] of bySize.entries()) {
      const unprocessed = files.filter((f) => !processedIds.has(f.id));
      if (unprocessed.length > 1) {
        // Only group if they're in the same article (likely accidental double upload)
        const byArticle = new Map<string, typeof unprocessed>();
        for (const f of unprocessed) {
          if (!byArticle.has(f.articleId)) {
            byArticle.set(f.articleId, []);
          }
          byArticle.get(f.articleId)!.push(f);
        }

        for (const [articleId, articleFiles] of byArticle.entries()) {
          if (articleFiles.length > 1) {
            duplicateGroups.push({
              key: `size_${key}_${articleId}`,
              matchType: "size",
              files: articleFiles.map((f) => ({
                ...f,
                createdAt: f.createdAt.toISOString(),
                articleTitle: f.articleTitle || "Unknown Article",
              })),
            });
            articleFiles.forEach((f) => processedIds.add(f.id));
          }
        }
      }
    }

    return {
      totalFiles: allAttachments.length,
      duplicateGroups,
      totalDuplicates: duplicateGroups.reduce<number>(
        (sum, g) => sum + g.files.length - 1,
        0,
      ),
    };
  },
  async getUnpaidArticles(s: Store) {
    const unpaidArticles = await Promise.all(
      (await s.all("articles"))
        .filter((a) => a.internalStatus === "Approved" && !a.paymentStatus)
        .sort((a, b) => +b.updatedAt - +a.updatedAt)
        .map((a) => articleDetails(s, a)),
    );
    return unpaidArticles.map((article) => ({
      id: article.id,
      title: article.title,
      articleTier: article.articleTier || "Tier 1 (Basic)",
      paymentStatus: article.paymentStatus || false,
      paymentAmount: article.paymentAmount,
      paymentIsManual: article.paymentIsManual || false,
      paymentRateSnapshot: article.paymentRateSnapshot,
      paidAt: article.paidAt ? article.paidAt.toISOString() : null,
      hasResearchBonus: article.hasResearchBonus,
      hasTimeSensitiveBonus: article.hasTimeSensitiveBonus,
      hasMultimediaBonus: article.hasMultimediaBonus,
      hasProfessionalPhotos: article.hasProfessionalPhotos,
      hasProfessionalGraphics: article.hasProfessionalGraphics,
      author: {
        id: article.author.id,
        givenName: article.author.givenName,
        surname: article.author.surname,
        email: article.author.email,
        authorType: article.author.authorType,
        autoDepositAvailable: article.author.autoDepositAvailable,
        etransferEmail: article.author.etransferEmail,
      },
      issue: article.publicationIssue
        ? {
            id: article.publicationIssue.id,
            issueNumber: article.publicationIssue.issueNumber,
            title: article.publicationIssue.title,
            volume: {
              id: article.publicationIssue.volume.id,
              volumeNumber: article.publicationIssue.volume.volumeNumber,
            },
          }
        : null,
      volume: article.volume,
      issueNumber: article.issue,
      hasMultimediaTypes: article.multimediaTypes.some((t) =>
        ["Photo", "Graphic", "Video"].includes(t.multimediaType),
      ),
    }));
  },
};
export const utilityMutations = {
  async deleteFiles(s: Store, data: { attachmentIds: string[] }) {
    for (const id of new Set(data.attachmentIds))
      await deleteAttachmentRecord(s, id);
    return {
      success: true as const,
      deletedCount: new Set(data.attachmentIds).size,
    };
  },
  async mergeArticles(s: Store, data: { keepId: string; deleteIds: string[] }) {
    if (data.deleteIds.includes(data.keepId))
      throw new Error("Cannot delete the article being kept");
    const keep = await s.require("articles", data.keepId),
      ids = [...new Set(data.deleteIds)],
      forms = new Set((keep.formResponseId || "").split(",").filter(Boolean));
    for (const id of ids) {
      const a = await s.require("articles", id);
      if (a.authorId !== keep.authorId)
        throw new Error("Merge articles must have the same author");
      for (const form of (a.formResponseId || "").split(",").filter(Boolean))
        forms.add(form);
      for (const table of [
        "attachments",
        "articleNotes",
        "statusHistory",
      ] as const)
        for (const row of await s.by(table, "articleId", id))
          await s.patch(table, row.id, { articleId: keep.id });
      const types = new Set(
        (await s.by("articleMultimediaTypes", "articleId", keep.id)).map(
          (t) => t.multimediaType,
        ),
      );
      for (const row of await s.by("articleMultimediaTypes", "articleId", id)) {
        if (!types.has(row.multimediaType)) {
          await s.patch("articleMultimediaTypes", row.id, {
            articleId: keep.id,
          });
          types.add(row.multimediaType);
        }
      }
      await deleteArticleRecord(s, id);
    }
    await s.patch("articles", keep.id, {
      formResponseId: [...forms].join(",") || null,
      updatedAt: new Date(),
    });
    return { success: true as const, mergedCount: ids.length };
  },
};
