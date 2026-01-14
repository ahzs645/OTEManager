import { createServerFn } from "@tanstack/start";

// Date range filter type
interface DateRangeFilter {
  startDate?: string;
  endDate?: string;
}

// Get overall payment statistics
export const getPaymentStats = createServerFn({ method: "POST" })
  .validator((data: DateRangeFilter) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { sum, count, avg, eq, and, gte, lte } = await import("drizzle-orm");

      // Build date filter conditions
      const conditions = [];
      if (data?.startDate) {
        conditions.push(gte(articles.paidAt, new Date(data.startDate)));
      }
      if (data?.endDate) {
        conditions.push(lte(articles.paidAt, new Date(data.endDate)));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Run queries in parallel
      const [totalResult, paidResult, unpaidResult] = await Promise.all([
        // Total payment amount and average
        db
          .select({
            totalPayments: sum(articles.paymentAmount),
            avgPayment: avg(articles.paymentAmount),
            totalArticles: count(),
          })
          .from(articles)
          .where(and(eq(articles.paymentStatus, true), whereClause)),
        // Paid count
        db
          .select({ count: count() })
          .from(articles)
          .where(and(eq(articles.paymentStatus, true), whereClause)),
        // Unpaid with calculated payment
        db
          .select({ count: count(), totalAmount: sum(articles.paymentAmount) })
          .from(articles)
          .where(and(eq(articles.paymentStatus, false), whereClause)),
      ]);

      return {
        totalPayments: Number(totalResult[0]?.totalPayments) || 0,
        avgPayment: Math.round(Number(totalResult[0]?.avgPayment)) || 0,
        paidCount: paidResult[0]?.count || 0,
        unpaidCount: unpaidResult[0]?.count || 0,
        unpaidAmount: Number(unpaidResult[0]?.totalAmount) || 0,
      };
    } catch (error) {
      console.error("Failed to get payment stats:", error);
      return {
        totalPayments: 0,
        avgPayment: 0,
        paidCount: 0,
        unpaidCount: 0,
        unpaidAmount: 0,
      };
    }
  });

// Get payment status breakdown (pie chart data)
export const getPaymentStatusBreakdown = createServerFn({ method: "POST" })
  .validator((data: DateRangeFilter) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { sum, count, eq, and, gte, lte, isNotNull } = await import("drizzle-orm");

      const conditions = [];
      if (data?.startDate) {
        conditions.push(gte(articles.createdAt, new Date(data.startDate)));
      }
      if (data?.endDate) {
        conditions.push(lte(articles.createdAt, new Date(data.endDate)));
      }
      // Only articles with calculated payment
      conditions.push(isNotNull(articles.paymentAmount));

      const baseWhere = conditions.length > 0 ? and(...conditions) : undefined;

      const [paidResult, unpaidResult] = await Promise.all([
        db
          .select({ count: count(), total: sum(articles.paymentAmount) })
          .from(articles)
          .where(and(eq(articles.paymentStatus, true), baseWhere)),
        db
          .select({ count: count(), total: sum(articles.paymentAmount) })
          .from(articles)
          .where(and(eq(articles.paymentStatus, false), baseWhere)),
      ]);

      return {
        paid: {
          count: paidResult[0]?.count || 0,
          amount: Number(paidResult[0]?.total) || 0,
        },
        unpaid: {
          count: unpaidResult[0]?.count || 0,
          amount: Number(unpaidResult[0]?.total) || 0,
        },
      };
    } catch (error) {
      console.error("Failed to get payment status breakdown:", error);
      return {
        paid: { count: 0, amount: 0 },
        unpaid: { count: 0, amount: 0 },
      };
    }
  });

// Get tier distribution and average payment per tier
export const getTierAnalytics = createServerFn({ method: "POST" })
  .validator((data: DateRangeFilter) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { sum, count, avg, eq, and, gte, lte, isNotNull } = await import("drizzle-orm");

      const conditions = [];
      if (data?.startDate) {
        conditions.push(gte(articles.createdAt, new Date(data.startDate)));
      }
      if (data?.endDate) {
        conditions.push(lte(articles.createdAt, new Date(data.endDate)));
      }
      conditions.push(isNotNull(articles.paymentAmount));

      const baseWhere = conditions.length > 0 ? and(...conditions) : undefined;

      // Query for each tier
      const tiers = ["Tier 1 (Basic)", "Tier 2 (Standard)", "Tier 3 (Advanced)"] as const;

      const tierResults = await Promise.all(
        tiers.map(async (tier) => {
          const [result] = await db
            .select({
              articleCount: count(),
              totalPayment: sum(articles.paymentAmount),
              avgPayment: avg(articles.paymentAmount),
            })
            .from(articles)
            .where(and(eq(articles.articleTier, tier), baseWhere));

          return {
            tier,
            tierLabel: tier.replace(" (Basic)", "").replace(" (Standard)", "").replace(" (Advanced)", ""),
            articleCount: result?.articleCount || 0,
            totalPayment: Number(result?.totalPayment) || 0,
            avgPayment: Math.round(Number(result?.avgPayment)) || 0,
          };
        })
      );

      return { tierStats: tierResults };
    } catch (error) {
      console.error("Failed to get tier analytics:", error);
      return { tierStats: [] };
    }
  });

// Get bonus frequency (bar chart data)
export const getBonusFrequency = createServerFn({ method: "POST" })
  .validator((data: DateRangeFilter) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { count, eq, and, gte, lte } = await import("drizzle-orm");

      const conditions = [];
      if (data?.startDate) {
        conditions.push(gte(articles.createdAt, new Date(data.startDate)));
      }
      if (data?.endDate) {
        conditions.push(lte(articles.createdAt, new Date(data.endDate)));
      }

      const baseWhere = conditions.length > 0 ? and(...conditions) : undefined;

      // Count each bonus type
      const [research, timeSensitive, multimedia, proPhotos, proGraphics, totalArticles] = await Promise.all([
        db
          .select({ count: count() })
          .from(articles)
          .where(and(eq(articles.hasResearchBonus, true), baseWhere)),
        db
          .select({ count: count() })
          .from(articles)
          .where(and(eq(articles.hasTimeSensitiveBonus, true), baseWhere)),
        db
          .select({ count: count() })
          .from(articles)
          .where(and(eq(articles.hasMultimediaBonus, true), baseWhere)),
        db
          .select({ count: count() })
          .from(articles)
          .where(and(eq(articles.hasProfessionalPhotos, true), baseWhere)),
        db
          .select({ count: count() })
          .from(articles)
          .where(and(eq(articles.hasProfessionalGraphics, true), baseWhere)),
        db
          .select({ count: count() })
          .from(articles)
          .where(baseWhere),
      ]);

      const total = totalArticles[0]?.count || 1; // Avoid division by zero

      return {
        bonuses: [
          { name: "Research", count: research[0]?.count || 0, percentage: Math.round(((research[0]?.count || 0) / total) * 100) },
          { name: "Time-Sensitive", count: timeSensitive[0]?.count || 0, percentage: Math.round(((timeSensitive[0]?.count || 0) / total) * 100) },
          { name: "Multimedia", count: multimedia[0]?.count || 0, percentage: Math.round(((multimedia[0]?.count || 0) / total) * 100) },
          { name: "Pro Photos", count: proPhotos[0]?.count || 0, percentage: Math.round(((proPhotos[0]?.count || 0) / total) * 100) },
          { name: "Pro Graphics", count: proGraphics[0]?.count || 0, percentage: Math.round(((proGraphics[0]?.count || 0) / total) * 100) },
        ],
        totalArticles: total,
      };
    } catch (error) {
      console.error("Failed to get bonus frequency:", error);
      return { bonuses: [], totalArticles: 0 };
    }
  });

// Get top earning authors
export const getTopEarningAuthors = createServerFn({ method: "POST" })
  .validator((data: DateRangeFilter & { limit?: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles, authors } = await import("@db/index");
      const { sum, count, eq, and, gte, lte, desc } = await import("drizzle-orm");

      const conditions = [eq(articles.paymentStatus, true)];
      if (data?.startDate) {
        conditions.push(gte(articles.paidAt, new Date(data.startDate)));
      }
      if (data?.endDate) {
        conditions.push(lte(articles.paidAt, new Date(data.endDate)));
      }

      const whereClause = and(...conditions);
      const limit = data?.limit || 10;

      const topAuthors = await db
        .select({
          authorId: articles.authorId,
          givenName: authors.givenName,
          surname: authors.surname,
          authorType: authors.authorType,
          totalEarnings: sum(articles.paymentAmount),
          articleCount: count(),
        })
        .from(articles)
        .innerJoin(authors, eq(articles.authorId, authors.id))
        .where(whereClause)
        .groupBy(articles.authorId, authors.givenName, authors.surname, authors.authorType)
        .orderBy(desc(sum(articles.paymentAmount)))
        .limit(limit);

      return {
        topAuthors: topAuthors.map((a) => ({
          ...a,
          name: `${a.givenName} ${a.surname}`,
          totalEarnings: Number(a.totalEarnings) || 0,
        })),
      };
    } catch (error) {
      console.error("Failed to get top earning authors:", error);
      return { topAuthors: [] };
    }
  });

// Get earnings by author type
export const getEarningsByAuthorType = createServerFn({ method: "POST" })
  .validator((data: DateRangeFilter) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles, authors } = await import("@db/index");
      const { sum, count, eq, and, gte, lte } = await import("drizzle-orm");

      const conditions = [eq(articles.paymentStatus, true)];
      if (data?.startDate) {
        conditions.push(gte(articles.paidAt, new Date(data.startDate)));
      }
      if (data?.endDate) {
        conditions.push(lte(articles.paidAt, new Date(data.endDate)));
      }

      const whereClause = and(...conditions);

      const byType = await db
        .select({
          authorType: authors.authorType,
          totalEarnings: sum(articles.paymentAmount),
          articleCount: count(),
        })
        .from(articles)
        .innerJoin(authors, eq(articles.authorId, authors.id))
        .where(whereClause)
        .groupBy(authors.authorType);

      return {
        byType: byType.map((t) => ({
          ...t,
          totalEarnings: Number(t.totalEarnings) || 0,
        })),
      };
    } catch (error) {
      console.error("Failed to get earnings by author type:", error);
      return { byType: [] };
    }
  });

// Get monthly spending trends (uses createdAt for grouping, paymentAmount for totals)
export const getMonthlySpendingTrends = createServerFn({ method: "POST" })
  .validator((data: { months?: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { sql, sum, count, gte, eq, and, isNotNull } = await import("drizzle-orm");

      const monthsBack = data?.months || 12;
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - monthsBack);

      // Use createdAt for grouping (always populated), filter by paymentStatus
      const trends = await db
        .select({
          month: sql<string>`to_char(${articles.createdAt}, 'YYYY-MM')`,
          totalSpent: sum(articles.paymentAmount),
          articleCount: count(),
        })
        .from(articles)
        .where(and(
          gte(articles.createdAt, startDate),
          eq(articles.paymentStatus, true),
          isNotNull(articles.paymentAmount)
        ))
        .groupBy(sql`to_char(${articles.createdAt}, 'YYYY-MM')`)
        .orderBy(sql`to_char(${articles.createdAt}, 'YYYY-MM')`);

      return {
        trends: trends.map((t) => ({
          ...t,
          monthLabel: t.month ? formatMonthLabel(t.month) : "",
          totalSpent: Number(t.totalSpent) || 0,
        })),
      };
    } catch (error) {
      console.error("Failed to get monthly spending trends:", error);
      return { trends: [] };
    }
  });

// UNBC Semester definitions
// Fall: Sep-Dec, Winter: Jan-Apr, Summer: May-Aug
type Semester = "Fall" | "Winter" | "Summer";

function getSemesterFromMonth(month: number): Semester {
  if (month >= 9 && month <= 12) return "Fall";
  if (month >= 1 && month <= 4) return "Winter";
  return "Summer";
}

function getSemesterYear(date: Date): string {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const semester = getSemesterFromMonth(month);
  // For Fall semester, use current year. For Winter/Summer, use current year.
  return `${semester} ${year}`;
}

// Get semester breakdown (UNBC: Fall Sep-Dec, Winter Jan-Apr, Summer May-Aug)
export const getSemesterBreakdown = createServerFn({ method: "POST" })
  .validator((data: { years?: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { sql, sum, count, gte, eq, and, isNotNull } = await import("drizzle-orm");

      const yearsBack = data?.years || 3;
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - yearsBack);

      // Get all paid articles with their creation dates
      const articleData = await db
        .select({
          createdAt: articles.createdAt,
          paymentAmount: articles.paymentAmount,
        })
        .from(articles)
        .where(and(
          gte(articles.createdAt, startDate),
          eq(articles.paymentStatus, true),
          isNotNull(articles.paymentAmount)
        ));

      // Group by semester
      const semesterMap = new Map<string, { totalSpent: number; articleCount: number; semester: Semester; year: number }>();

      for (const article of articleData) {
        const date = new Date(article.createdAt);
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        const semester = getSemesterFromMonth(month);
        const key = `${semester} ${year}`;

        const existing = semesterMap.get(key) || { totalSpent: 0, articleCount: 0, semester, year };
        existing.totalSpent += article.paymentAmount || 0;
        existing.articleCount += 1;
        semesterMap.set(key, existing);
      }

      // Convert to array and sort by year and semester order
      const semesterOrder: Record<Semester, number> = { Winter: 0, Summer: 1, Fall: 2 };
      const semesters = Array.from(semesterMap.entries())
        .map(([label, data]) => ({
          label,
          ...data,
        }))
        .sort((a, b) => {
          if (a.year !== b.year) return a.year - b.year;
          return semesterOrder[a.semester] - semesterOrder[b.semester];
        });

      return { semesters };
    } catch (error) {
      console.error("Failed to get semester breakdown:", error);
      return { semesters: [] };
    }
  });

// Helper to format month label (e.g., "2024-01" -> "Jan 2024")
function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
}

// Get earnings by student type (for students only)
export const getEarningsByStudentType = createServerFn({ method: "POST" })
  .validator((data: DateRangeFilter) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles, authors } = await import("@db/index");
      const { sum, count, eq, and, gte, lte } = await import("drizzle-orm");

      const conditions = [
        eq(articles.paymentStatus, true),
        eq(authors.authorType, "Student"),
      ];
      if (data?.startDate) {
        conditions.push(gte(articles.paidAt, new Date(data.startDate)));
      }
      if (data?.endDate) {
        conditions.push(lte(articles.paidAt, new Date(data.endDate)));
      }

      const whereClause = and(...conditions);

      const byStudentType = await db
        .select({
          studentType: authors.studentType,
          totalEarnings: sum(articles.paymentAmount),
          articleCount: count(),
        })
        .from(articles)
        .innerJoin(authors, eq(articles.authorId, authors.id))
        .where(whereClause)
        .groupBy(authors.studentType);

      return {
        byStudentType: byStudentType.map((t) => ({
          ...t,
          totalEarnings: Number(t.totalEarnings) || 0,
        })),
      };
    } catch (error) {
      console.error("Failed to get earnings by student type:", error);
      return { byStudentType: [] };
    }
  });

// ============================================
// DRILL-DOWN QUERIES
// ============================================

// Get articles by tier
export const getArticlesByTier = createServerFn({ method: "POST" })
  .validator((data: { tier: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq, desc, isNotNull } = await import("drizzle-orm");

      const articleList = await db.query.articles.findMany({
        where: eq(articles.articleTier, data.tier as any),
        with: { author: true },
        orderBy: [desc(articles.createdAt)],
        limit: data.limit || 20,
      });

      return { articles: articleList };
    } catch (error) {
      console.error("Failed to get articles by tier:", error);
      return { articles: [] };
    }
  });

// Get articles by bonus type
export const getArticlesByBonus = createServerFn({ method: "POST" })
  .validator((data: { bonusType: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq, desc } = await import("drizzle-orm");

      // Map bonus name to field
      const bonusFieldMap: Record<string, keyof typeof articles> = {
        "Research": "hasResearchBonus",
        "Time-Sensitive": "hasTimeSensitiveBonus",
        "Multimedia": "hasMultimediaBonus",
        "Pro Photos": "hasProfessionalPhotos",
        "Pro Graphics": "hasProfessionalGraphics",
      };

      const field = bonusFieldMap[data.bonusType];
      if (!field) {
        return { articles: [] };
      }

      const articleList = await db.query.articles.findMany({
        where: eq(articles[field] as any, true),
        with: { author: true },
        orderBy: [desc(articles.createdAt)],
        limit: data.limit || 20,
      });

      return { articles: articleList };
    } catch (error) {
      console.error("Failed to get articles by bonus:", error);
      return { articles: [] };
    }
  });

// Get articles by payment status
export const getArticlesByPaymentStatus = createServerFn({ method: "POST" })
  .validator((data: { paid: boolean; limit?: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq, desc, and, isNotNull } = await import("drizzle-orm");

      const articleList = await db.query.articles.findMany({
        where: and(
          eq(articles.paymentStatus, data.paid),
          isNotNull(articles.paymentAmount)
        ),
        with: { author: true },
        orderBy: [desc(articles.createdAt)],
        limit: data.limit || 20,
      });

      return { articles: articleList };
    } catch (error) {
      console.error("Failed to get articles by payment status:", error);
      return { articles: [] };
    }
  });

// Get author with their articles
export const getAuthorWithArticles = createServerFn({ method: "POST" })
  .validator((data: { authorId: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, authors, articles } = await import("@db/index");
      const { eq, desc, sum, count, and } = await import("drizzle-orm");

      const author = await db.query.authors.findFirst({
        where: eq(authors.id, data.authorId),
        with: {
          articles: {
            orderBy: [desc(articles.createdAt)],
            limit: data.limit || 10,
          },
        },
      });

      if (!author) {
        return { author: null };
      }

      // Get stats
      const [statsResult] = await db
        .select({
          totalEarnings: sum(articles.paymentAmount),
          articleCount: count(),
        })
        .from(articles)
        .where(and(eq(articles.authorId, data.authorId), eq(articles.paymentStatus, true)));

      return {
        author: {
          ...author,
          totalEarnings: Number(statsResult?.totalEarnings) || 0,
          articleCount: Number(statsResult?.articleCount) || 0,
        },
      };
    } catch (error) {
      console.error("Failed to get author with articles:", error);
      return { author: null };
    }
  });

// Get authors by type
export const getAuthorsByType = createServerFn({ method: "POST" })
  .validator((data: { authorType: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, authors, articles } = await import("@db/index");
      const { eq, desc, sum, count, and } = await import("drizzle-orm");

      const authorList = await db.query.authors.findMany({
        where: eq(authors.authorType, data.authorType as any),
        orderBy: [desc(authors.createdAt)],
        limit: data.limit || 20,
      });

      // Get article counts and earnings for each author
      const authorsWithStats = await Promise.all(
        authorList.map(async (author) => {
          const [stats] = await db
            .select({
              articleCount: count(),
              totalEarnings: sum(articles.paymentAmount),
            })
            .from(articles)
            .where(and(eq(articles.authorId, author.id), eq(articles.paymentStatus, true)));

          return {
            ...author,
            articleCount: Number(stats?.articleCount) || 0,
            totalEarnings: Number(stats?.totalEarnings) || 0,
          };
        })
      );

      return { authors: authorsWithStats };
    } catch (error) {
      console.error("Failed to get authors by type:", error);
      return { authors: [] };
    }
  });

// Get articles by semester
export const getArticlesBySemester = createServerFn({ method: "POST" })
  .validator((data: { semester: string; year: number; limit?: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { and, gte, lte, desc, eq, isNotNull } = await import("drizzle-orm");

      // Calculate date range for semester
      let startMonth: number, endMonth: number;
      switch (data.semester) {
        case "Fall":
          startMonth = 9; // September
          endMonth = 12;  // December
          break;
        case "Winter":
          startMonth = 1; // January
          endMonth = 4;   // April
          break;
        case "Summer":
          startMonth = 5; // May
          endMonth = 8;   // August
          break;
        default:
          return { articles: [] };
      }

      const startDate = new Date(data.year, startMonth - 1, 1);
      const endDate = new Date(data.year, endMonth, 0); // Last day of end month

      const articleList = await db.query.articles.findMany({
        where: and(
          gte(articles.createdAt, startDate),
          lte(articles.createdAt, endDate),
          eq(articles.paymentStatus, true),
          isNotNull(articles.paymentAmount)
        ),
        with: { author: true },
        orderBy: [desc(articles.createdAt)],
        limit: data.limit || 30,
      });

      return { articles: articleList };
    } catch (error) {
      console.error("Failed to get articles by semester:", error);
      return { articles: [] };
    }
  });

// Get authors by student type
export const getAuthorsByStudentType = createServerFn({ method: "POST" })
  .validator((data: { studentType: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, authors, articles } = await import("@db/index");
      const { eq, desc, sum, count, and, isNull } = await import("drizzle-orm");

      // Handle "Unknown" student type as null
      const whereCondition = data.studentType === "Unknown"
        ? and(eq(authors.authorType, "Student"), isNull(authors.studentType))
        : eq(authors.studentType, data.studentType as any);

      const authorList = await db.query.authors.findMany({
        where: whereCondition,
        orderBy: [desc(authors.createdAt)],
        limit: data.limit || 20,
      });

      // Get article counts and earnings for each author
      const authorsWithStats = await Promise.all(
        authorList.map(async (author) => {
          const [stats] = await db
            .select({
              articleCount: count(),
              totalEarnings: sum(articles.paymentAmount),
            })
            .from(articles)
            .where(and(eq(articles.authorId, author.id), eq(articles.paymentStatus, true)));

          return {
            ...author,
            articleCount: Number(stats?.articleCount) || 0,
            totalEarnings: Number(stats?.totalEarnings) || 0,
          };
        })
      );

      return { authors: authorsWithStats };
    } catch (error) {
      console.error("Failed to get authors by student type:", error);
      return { authors: [] };
    }
  });
