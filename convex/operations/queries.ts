import { Store, newest, sumPayments } from "../lib/store";
import {
  IN_PROGRESS_FILTER,
  IN_PROGRESS_STATUSES,
  type Articles,
} from "../../shared/model";
export const DEFAULT_RATES = {
  tier1Rate: 2000,
  tier2Rate: 3500,
  tier3Rate: 5000,
  researchBonus: 1000,
  multimediaBonus: 500,
  timeSensitiveBonus: 500,
  professionalPhotoBonus: 1500,
  professionalGraphicBonus: 1500,
};
export async function articleDetails(s: Store, a: Articles) {
  const issue = a.issueId ? await s.get("issues", a.issueId) : null;
  return {
    ...a,
    author: await s.require("authors", a.authorId),
    attachments: await s.by("attachments", "articleId", a.id),
    multimediaTypes: await s.by("articleMultimediaTypes", "articleId", a.id),
    publicationIssue: issue
      ? { ...issue, volume: await s.require("volumes", issue.volumeId) }
      : null,
  };
}
// Search titles and author names, e.g. "bears" or "jorden evens"
const matchesSearch = (
  a: Articles,
  author: { givenName: string; surname: string; email: string } | undefined,
  search: string,
) => {
  const haystack = [
    a.title,
    author && `${author.givenName} ${author.surname}`,
    author?.email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
};

const isInProgress = (status: string | null) =>
  (IN_PROGRESS_STATUSES as readonly (string | null)[]).includes(status);

// Imported articles are created long after they were submitted, so recency
// follows the submission date when there is one
const submittedOrCreated = (a: Articles) =>
  (a.submittedAt ?? a.createdAt).getTime();
export const queries = {
  async getIssueArticles(s: Store, data: { issueId: string }) {
    return {
      articles: await Promise.all(
        (await s.by("articles", "issueId", data.issueId)).map((a) =>
          articleDetails(s, a),
        ),
      ),
    };
  },
  async getPaymentRateConfig(s: Store) {
    const config = (await s.all("paymentRateConfig"))[0];
    return {
      config: config || {
        ...DEFAULT_RATES,
        id: null,
        updatedAt: null,
        updatedBy: null,
      },
      exists: !!config,
    };
  },
  async getPaymentRateHistory(s: Store) {
    return {
      history: (await s.all("paymentRateHistory"))
        .sort((a, b) => +b.changedAt - +a.changedAt)
        .slice(0, 20),
    };
  },
  async getDashboardStats(s: Store) {
    const a = await s.all("articles");
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return {
      totalArticles: a.length,
      pendingReview: a.filter((a) => a.internalStatus === "Pending Review")
        .length,
      inProgress: a.filter((a) => isInProgress(a.internalStatus)).length,
      approved: a.filter((a) => a.internalStatus === "Approved").length,
      published: a.filter((a) => a.internalStatus === "Published").length,
      totalAuthors: (await s.all("authors")).length,
      thisMonth: a.filter((a) => submittedOrCreated(a) >= d.getTime()).length,
    };
  },
  async getRecentArticles(s: Store) {
    return {
      articles: await Promise.all(
        (await s.all("articles"))
          .sort((a, b) => submittedOrCreated(b) - submittedOrCreated(a))
          .slice(0, 5)
          .map((a) => articleDetails(s, a)),
      ),
    };
  },
  async getArticles(
    s: Store,
    data: {
      status?: string;
      tier?: string;
      search?: string;
      authorId?: string;
      issueId?: string;
      volumeId?: string;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: string;
    } = {},
  ) {
    const page = Math.max(1, Math.floor(data.page || 1)),
      limit = Math.min(1000, Math.max(1, Math.floor(data.limit || 20)));
    const issueIds = data.volumeId
      ? new Set(
          (await s.by("issues", "volumeId", data.volumeId)).map((i) => i.id),
        )
      : null;
    const authors = new Map((await s.all("authors")).map((a) => [a.id, a]));
    const rows = (await s.all("articles")).filter(
      (a) =>
        (!data.status ||
          a.internalStatus === data.status ||
          (data.status === IN_PROGRESS_FILTER &&
            isInProgress(a.internalStatus))) &&
        (!data.tier || a.articleTier === data.tier) &&
        (!data.authorId || a.authorId === data.authorId) &&
        (!data.issueId || a.issueId === data.issueId) &&
        (!issueIds || issueIds.has(a.issueId!)) &&
        (!data.search ||
          matchesSearch(a, authors.get(a.authorId), data.search)),
    );
    const key = (a: Articles): any[] => {
      switch (data.sortBy) {
        case "title":
          return [a.title];
        case "author": {
          const author = authors.get(a.authorId);
          return [`${author?.surname} ${author?.givenName}`.toLowerCase()];
        }
        case "status":
          return [a.internalStatus];
        case "submitted":
          return [a.submittedAt, a.createdAt];
        case "tier":
          return [a.articleTier];
        case "volume":
          return [a.volume, a.issue];
        default:
          return [a.createdAt];
      }
    };
    const direction = data.sortBy && data.sortOrder === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const ak = key(a),
        bk = key(b);
      for (let i = 0; i < ak.length; i++) {
        if (ak[i] === bk[i]) continue;
        if (ak[i] == null) return direction;
        if (bk[i] == null) return -direction;
        const diff =
          typeof ak[i] === "string"
            ? ak[i].localeCompare(bk[i])
            : Number(ak[i]) - Number(bk[i]);
        if (diff) return diff * direction;
      }
      return a.id.localeCompare(b.id);
    });
    return {
      articles: await Promise.all(
        rows
          .slice((page - 1) * limit, page * limit)
          .map((a) => articleDetails(s, a)),
      ),
      total: rows.length,
      page,
      limit,
      totalPages: Math.ceil(rows.length / limit),
    };
  },
  async getArticleById(s: Store, data: { id: string }) {
    const a = await s.get("articles", data.id);
    return {
      article: a
        ? {
            ...(await articleDetails(s, a)),
            notes: newest(await s.by("articleNotes", "articleId", a.id)),
            statusHistory: (
              await s.by("statusHistory", "articleId", a.id)
            ).sort((a, b) => +b.changedAt - +a.changedAt),
          }
        : null,
    };
  },
  async getAuthorById(s: Store, data: { id: string }) {
    const a = await s.get("authors", data.id);
    if (!a) return { author: null, stats: null };
    const rows = newest(await s.by("articles", "authorId", a.id)),
      paid = rows.filter((a) => a.paymentStatus);
    return {
      author: {
        ...a,
        articles: await Promise.all(rows.map((a) => articleDetails(s, a))),
      },
      stats: {
        totalArticles: rows.length,
        paidArticles: paid.length,
        totalEarnings: sumPayments(paid),
      },
    };
  },
  async getAuthors(s: Store, data?: { search?: string }) {
    const articles = await s.all("articles");
    return {
      authors: (await s.all("authors"))
        .filter(
          (a) =>
            !data?.search ||
            [a.givenName, a.surname, a.email].some((v) =>
              v.toLowerCase().includes(data.search!.toLowerCase()),
            ),
        )
        .sort((a, b) => a.surname.localeCompare(b.surname))
        .map((a) => ({
          ...a,
          articleCount: articles.filter((x) => x.authorId === a.id).length,
        })),
    };
  },
  async getVolumes(s: Store) {
    const articles = await s.all("articles"),
      issues = await s.all("issues");
    return {
      // Articles with volume/issue numbers but no issue record (older imports).
      // They're missing from issue counts and exports until linked.
      unlinkedArticleCount: articles.filter(
        (a) => a.volume !== null && a.issue !== null && !a.issueId,
      ).length,
      volumes: (await s.all("volumes"))
        .sort((a, b) => b.volumeNumber - a.volumeNumber)
        .map((v) => ({
          ...v,
          issues: issues
            .filter((i) => i.volumeId === v.id)
            .sort((a, b) => a.issueNumber - b.issueNumber)
            .map((i) => ({
              ...i,
              articleCount: articles.filter((a) => a.issueId === i.id).length,
            })),
        })),
    };
  },
  async getIssueById(s: Store, data: { id: string }) {
    const i = await s.get("issues", data.id);
    return {
      issue: i
        ? { ...i, volume: await s.require("volumes", i.volumeId) }
        : null,
    };
  },
  async getVolumeById(s: Store, data: { id: string }) {
    return { volume: await s.get("volumes", data.id) };
  },
  async getIssuesForVolume(s: Store, data: { volumeId: string }) {
    const volume = await s.require("volumes", data.volumeId);
    return {
      issues: (await s.by("issues", "volumeId", data.volumeId))
        .sort((a, b) => a.issueNumber - b.issueNumber)
        .map((i) => ({ ...i, volume })),
    };
  },
  async getSavedViews(s: Store) {
    return {
      success: true as const,
      views: (await s.all("savedArticleViews")).sort(
        (a, b) =>
          Number(b.isDefault) - Number(a.isDefault) ||
          +b.updatedAt - +a.updatedAt,
      ),
    };
  },
  async getDefaultView(s: Store) {
    return {
      success: true as const,
      view: (await s.all("savedArticleViews")).find((v) => v.isDefault) || null,
    };
  },
};
