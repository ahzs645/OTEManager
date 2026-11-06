import { Store } from "../lib/store";
import { PUBLICATION_RESULTS, type ArticlePublications } from "../../shared/model";

type PublicationInput = {
  articleId: string;
  siteUrl: string;
  remotePostId?: number | null;
  remoteUrl?: string | null;
  remoteEditUrl?: string | null;
  remoteStatus?: string | null;
  contentFingerprint?: string | null;
  mediaMap?: Record<string, unknown> | null;
  lastAction?: string | null;
  lastResult: (typeof PUBLICATION_RESULTS)[number];
  lastError?: string | null;
  warnings?: string[] | null;
};

const forSite = async (s: Store, articleId: string, siteUrl: string) =>
  (await s.by("articlePublications", "articleId", articleId)).find(
    (row) => row.siteUrl === siteUrl,
  ) ?? null;

export const publicationQueries = {
  /** Publication records for the given articles, keyed by article ID. */
  async getArticlePublications(s: Store, data: { articleIds: string[] }) {
    const result: Record<string, ArticlePublications[]> = {};
    for (const id of [...new Set(data.articleIds)])
      result[id] = await s.by("articlePublications", "articleId", id);
    return { publications: result };
  },
};

export const publicationMutations = {
  /**
   * Records the outcome of sending an article to a site. A failed send keeps
   * the previously known remote post so the next send updates it.
   */
  async recordArticlePublication(s: Store, data: PublicationInput) {
    await s.require("articles", data.articleId);
    if (!PUBLICATION_RESULTS.includes(data.lastResult))
      throw new Error("Invalid publication result");
    const existing = await forSite(s, data.articleId, data.siteUrl);
    const failed = data.lastResult === "failed";
    const values: Partial<ArticlePublications> = {
      lastResult: data.lastResult,
      lastAction: data.lastAction ?? null,
      lastError: data.lastError ?? null,
      warnings: data.warnings?.length ? JSON.stringify(data.warnings) : null,
      lastPushedAt: new Date(),
      updatedAt: new Date(),
    };
    if (!failed) {
      Object.assign(values, {
        remotePostId: data.remotePostId ?? existing?.remotePostId ?? null,
        remoteUrl: data.remoteUrl ?? null,
        remoteEditUrl: data.remoteEditUrl ?? null,
        remoteStatus: data.remoteStatus ?? null,
        contentFingerprint: data.contentFingerprint ?? null,
      });
    }
    // Media uploaded before a later step failed is still reusable.
    if (data.mediaMap) values.mediaMap = JSON.stringify(data.mediaMap);
    const row = existing
      ? await s.patch("articlePublications", existing.id, values)
      : await s.insert("articlePublications", {
          articleId: data.articleId,
          siteUrl: data.siteUrl,
          destination: "wordpress",
          ...values,
        });
    return { success: true as const, publication: row };
  },
};
