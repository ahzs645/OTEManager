import { Store, newest, sumPayments } from "../lib/store";
import { articleDetails, queries } from "./queries";
import type { Articles, Authors } from "../../shared/model";
interface DateRange {
  startDate?: string;
  endDate?: string;
}
interface CrossFilter {
  tier?: string;
  bonus?: string;
  authorType?: string;
  studentType?: string;
  paymentStatus?: boolean;
  semester?: { semester: string; year: number };
}
const bonuses = {
  Research: "hasResearchBonus",
  "Time-Sensitive": "hasTimeSensitiveBonus",
  Multimedia: "hasMultimediaBonus",
  "Pro Photos": "hasProfessionalPhotos",
  "Pro Graphics": "hasProfessionalGraphics",
} as const;
function inRange(date: Date | null, data: DateRange = {}) {
  if (!data.startDate && !data.endDate) return true;
  if (!date) return false;
  const end = data.endDate ? new Date(data.endDate) : null;
  if (end && /^\d{4}-\d{2}-\d{2}$/.test(data.endDate!))
    end.setUTCHours(23, 59, 59, 999);
  return (
    (!data.startDate || date >= new Date(data.startDate)) &&
    (!end || date <= end)
  );
}
function semester(date: Date) {
  const m = date.getUTCMonth();
  return m >= 8 ? "Fall" : m < 4 ? "Winter" : "Summer";
}
function inSemester(a: Articles, f: { semester: string; year: number }) {
  const date = a.submittedAt || a.createdAt;
  return semester(date) === f.semester && date.getUTCFullYear() === f.year;
}
function average(rows: Articles[]) {
  const valued = rows.filter((a) => a.paymentAmount !== null);
  return valued.length ? Math.round(sumPayments(valued) / valued.length) : 0;
}
function stats(paid: Articles[], unpaid: Articles[]) {
  return {
    totalPayments: sumPayments(paid),
    avgPayment: average(paid),
    paidCount: paid.length,
    unpaidCount: unpaid.length,
    unpaidAmount: sumPayments(unpaid),
  };
}
function status(rows: Articles[]) {
  const paid = rows.filter(
      (a) => a.paymentStatus === true && a.paymentAmount !== null,
    ),
    unpaid = rows.filter(
      (a) => !a.paymentStatus && a.paymentAmount !== null,
    );
  return {
    paid: { count: paid.length, amount: sumPayments(paid) },
    unpaid: { count: unpaid.length, amount: sumPayments(unpaid) },
  };
}
function tiers(rows: Articles[]) {
  return {
    tierStats: ["Tier 1 (Basic)", "Tier 2 (Standard)", "Tier 3 (Advanced)"].map(
      (tier) => {
        const r = rows.filter(
          (a) => a.articleTier === tier && a.paymentAmount !== null,
        );
        return {
          tier,
          tierLabel: tier.split(" (")[0],
          articleCount: r.length,
          totalPayment: sumPayments(r),
          avgPayment: average(r),
        };
      },
    ),
  };
}
function bonusStats(rows: Articles[]) {
  return {
    bonuses: Object.entries(bonuses).map(([name, field]) => {
      const r = rows.filter((a) => a[field]);
      return {
        name,
        count: r.length,
        percentage: rows.length
          ? Math.round((r.length / rows.length) * 100)
          : 0,
        totalAmount: sumPayments(r),
      };
    }),
    totalArticles: rows.length,
  };
}
function authorStats(rows: Articles[], authors: Authors[]) {
  return authors
    .map((a) => {
      const r = rows.filter((x) => x.authorId === a.id);
      return {
        authorId: a.id,
        givenName: a.givenName,
        surname: a.surname,
        authorType: a.authorType,
        name: `${a.givenName} ${a.surname}`,
        totalEarnings: sumPayments(r),
        articleCount: r.length,
      };
    })
    .filter((a) => a.articleCount > 0)
    .sort((a, b) => b.totalEarnings - a.totalEarnings);
}
function byAuthorType(rows: Articles[], authors: Authors[]) {
  const map = new Map(authors.map((a) => [a.id, a]));
  const groups = new Map<Authors["authorType"], Articles[]>();
  for (const r of rows) {
    const a = map.get(r.authorId);
    if (a) {
      const list = groups.get(a.authorType) || [];
      list.push(r);
      groups.set(a.authorType, list);
    }
  }
  return {
    byType: [...groups].map(([authorType, r]) => ({
      authorType,
      totalEarnings: sumPayments(r),
      articleCount: r.length,
    })),
  };
}
function byStudentType(rows: Articles[], authors: Authors[]) {
  const map = new Map(authors.map((a) => [a.id, a]));
  const groups = new Map<Authors["studentType"], Articles[]>();
  for (const r of rows) {
    const a = map.get(r.authorId);
    if (a?.authorType === "Student") {
      const list = groups.get(a.studentType) || [];
      list.push(r);
      groups.set(a.studentType, list);
    }
  }
  return {
    byStudentType: [...groups].map(([studentType, r]) => ({
      studentType,
      totalEarnings: sumPayments(r),
      articleCount: r.length,
    })),
  };
}
async function articleList(
  s: Store,
  predicate: (a: Articles) => boolean,
  limit = 20,
) {
  return {
    articles: await Promise.all(
      newest((await s.all("articles")).filter(predicate))
        .slice(0, Math.min(1000, Math.max(1, limit)))
        .map((a) => articleDetails(s, a)),
    ),
  };
}
async function authorsWithStats(
  s: Store,
  predicate: (a: Authors) => boolean,
  limit = 20,
) {
  const paid = (await s.all("articles")).filter((a) => a.paymentStatus);
  return {
    authors: newest((await s.all("authors")).filter(predicate))
      .slice(0, limit)
      .map((a) => {
        const r = paid.filter((r) => r.authorId === a.id);
        return { ...a, articleCount: r.length, totalEarnings: sumPayments(r) };
      }),
  };
}
export const analytics = {
  async getAllAnalyticsWithCrossFilter(
    s: Store,
    data: DateRange & { crossFilter?: CrossFilter } = {},
  ) {
    const authors = await s.all("authors"),
      map = new Map(authors.map((a) => [a.id, a])),
      f = data.crossFilter || {};
    const rows = (await s.all("articles")).filter((a) => {
      const author = map.get(a.authorId);
      const bonus = f.bonus ? bonuses[f.bonus as keyof typeof bonuses] : null;
      return (
        inRange(a.createdAt, data) &&
        (!f.tier || a.articleTier === f.tier) &&
        (!bonus || a[bonus] === true) &&
        (!f.authorType || author?.authorType === f.authorType) &&
        (!f.studentType ||
          (f.studentType === "Unknown"
            ? author?.studentType === null
            : author?.studentType === f.studentType)) &&
        (f.paymentStatus === undefined ||
          Boolean(a.paymentStatus) === f.paymentStatus) &&
        (!f.semester || inSemester(a, f.semester))
      );
    });
    const paid = rows.filter((a) => a.paymentStatus === true),
      unpaid = rows.filter(
        (a) => !a.paymentStatus && a.paymentAmount !== null,
      );
    return {
      paymentStats: stats(
        paid.filter((a) => a.paymentAmount !== null),
        unpaid,
      ),
      statusBreakdown: status(rows),
      tierAnalytics: tiers(rows),
      bonusFrequency: bonusStats(rows),
      topAuthors: { topAuthors: authorStats(paid, authors).slice(0, 10) },
      authorTypeEarnings: byAuthorType(paid, authors),
      studentTypeEarnings: byStudentType(paid, authors),
    };
  },
  async getPaymentStats(s: Store, data: DateRange = {}) {
    const rows = await s.all("articles");
    return stats(
      rows.filter((a) => a.paymentStatus === true && inRange(a.paidAt, data)),
      rows.filter(
        (a) =>
          !a.paymentStatus &&
          inRange(a.submittedAt || a.createdAt, data),
      ),
    );
  },
  async getPaymentStatusBreakdown(s: Store, data: DateRange = {}) {
    return status(
      (await s.all("articles")).filter((a) => inRange(a.createdAt, data)),
    );
  },
  async getTierAnalytics(s: Store, data: DateRange = {}) {
    return tiers(
      (await s.all("articles")).filter((a) => inRange(a.createdAt, data)),
    );
  },
  async getBonusFrequency(s: Store, data: DateRange = {}) {
    return bonusStats(
      (await s.all("articles")).filter((a) => inRange(a.createdAt, data)),
    );
  },
  async getTopEarningAuthors(
    s: Store,
    data: DateRange & { limit?: number } = {},
  ) {
    return {
      topAuthors: authorStats(
        (await s.all("articles")).filter(
          (a) => a.paymentStatus && inRange(a.paidAt, data),
        ),
        await s.all("authors"),
      ).slice(0, data.limit || 10),
    };
  },
  async getEarningsByAuthorType(s: Store, data: DateRange = {}) {
    return byAuthorType(
      (await s.all("articles")).filter(
        (a) => a.paymentStatus && inRange(a.paidAt, data),
      ),
      await s.all("authors"),
    );
  },
  async getEarningsByStudentType(s: Store, data: DateRange = {}) {
    return byStudentType(
      (await s.all("articles")).filter(
        (a) => a.paymentStatus && inRange(a.paidAt, data),
      ),
      await s.all("authors"),
    );
  },
  async getMonthlySpendingTrends(s: Store, data: { months?: number } = {}) {
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - (data.months || 12));
    const groups = new Map<string, Articles[]>();
    for (const a of await s.all("articles")) {
      if (!a.paymentStatus || a.paymentAmount === null || a.createdAt < cutoff)
        continue;
      const key = a.createdAt.toISOString().slice(0, 7),
        rows = groups.get(key) || [];
      rows.push(a);
      groups.set(key, rows);
    }
    return {
      trends: [...groups]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, r]) => ({
          month,
          monthLabel: new Date(month + "-01T12:00:00Z").toLocaleDateString(
            "en-US",
            { month: "short", year: "numeric", timeZone: "UTC" },
          ),
          totalSpent: sumPayments(r),
          articleCount: r.length,
        })),
    };
  },
  async getSemesterBreakdown(s: Store, data: { years?: number } = {}) {
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - (data.years || 3));
    const groups = new Map<
      string,
      {
        label: string;
        semester: string;
        year: number;
        totalSpent: number;
        articleCount: number;
      }
    >();
    for (const a of await s.all("articles")) {
      const date = a.submittedAt || a.createdAt;
      if (!a.paymentStatus || a.paymentAmount === null || date < cutoff)
        continue;
      const sem = semester(date),
        year = date.getUTCFullYear(),
        label = `${sem} ${year}`,
        r = groups.get(label) || {
          label,
          semester: sem,
          year,
          totalSpent: 0,
          articleCount: 0,
        };
      r.totalSpent += a.paymentAmount;
      r.articleCount++;
      groups.set(label, r);
    }
    const order: Record<string, number> = { Winter: 0, Summer: 1, Fall: 2 };
    return {
      semesters: [...groups.values()].sort(
        (a, b) => a.year - b.year || order[a.semester] - order[b.semester],
      ),
    };
  },
  async getArticlesByTier(s: Store, data: { tier: string; limit?: number }) {
    return articleList(s, (a) => a.articleTier === data.tier, data.limit);
  },
  async getArticlesByBonus(
    s: Store,
    data: { bonusType: string; limit?: number },
  ) {
    const key = bonuses[data.bonusType as keyof typeof bonuses];
    return articleList(s, (a) => !!key && a[key] === true, data.limit);
  },
  async getArticlesByPaymentStatus(
    s: Store,
    data: { paid: boolean; limit?: number },
  ) {
    return articleList(
      s,
      (a) => Boolean(a.paymentStatus) === data.paid && a.paymentAmount !== null,
      data.limit,
    );
  },
  async getArticlesBySemester(
    s: Store,
    data: { semester: string; year: number; limit?: number },
  ) {
    return articleList(
      s,
      (a) =>
        !!a.paymentStatus && a.paymentAmount !== null && inSemester(a, data),
      data.limit || 30,
    );
  },
  async getAuthorWithArticles(
    s: Store,
    data: { authorId: string; limit?: number },
  ) {
    const result = await queries.getAuthorById(s, { id: data.authorId });
    return {
      author: result.author
        ? {
            ...result.author,
            articles: result.author.articles.slice(0, data.limit || 10),
            articleCount: result.stats!.paidArticles,
            totalEarnings: result.stats!.totalEarnings,
          }
        : null,
    };
  },
  async getAuthorsByType(
    s: Store,
    data: { authorType: string; limit?: number },
  ) {
    return authorsWithStats(
      s,
      (a) => a.authorType === data.authorType,
      data.limit,
    );
  },
  async getAuthorsByStudentType(
    s: Store,
    data: { studentType: string; limit?: number },
  ) {
    return authorsWithStats(
      s,
      (a) =>
        data.studentType === "Unknown"
          ? a.authorType === "Student" && a.studentType === null
          : a.studentType === data.studentType,
      data.limit,
    );
  },
};
