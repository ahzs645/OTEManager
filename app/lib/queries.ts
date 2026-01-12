import { createServerFn } from "@tanstack/start";
import type { PaymentRateConfig } from "./payment-calculator";

// Get payment rate configuration
export const getPaymentRateConfig = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const { db, paymentRateConfig } = await import("@db/index");

      const config = await db.query.paymentRateConfig.findFirst();

      if (!config) {
        // Return default values if no config exists
        return {
          config: {
            id: null,
            tier1Rate: 5000,
            tier2Rate: 10000,
            tier3Rate: 15000,
            photoBonus: 1500,
            graphicBonus: 2000,
            videoBonus: 2500,
            audioBonus: 1000,
            featuredBonus: 5000,
            updatedAt: null,
            updatedBy: null,
          } as PaymentRateConfig & { id: string | null; updatedAt: Date | null; updatedBy: string | null },
          exists: false,
        };
      }

      return { config, exists: true };
    } catch (error) {
      console.error("Failed to get payment rate config:", error);
      return { config: null, exists: false };
    }
  }
);

// Get payment rate history
export const getPaymentRateHistory = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const { db, paymentRateHistory } = await import("@db/index");

      const history = await db.query.paymentRateHistory.findMany({
        orderBy: (history, { desc }) => [desc(history.changedAt)],
        limit: 20,
      });

      return { history };
    } catch (error) {
      console.error("Failed to get payment rate history:", error);
      return { history: [] };
    }
  }
);

// Dashboard statistics
export const getDashboardStats = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const { db, articles, authors } = await import("@db/index");
      const { count, eq, gte, and } = await import("drizzle-orm");

      // Get current month start
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Run queries in parallel
      const [
        totalArticlesResult,
        pendingReviewResult,
        inProgressResult,
        publishedResult,
        totalAuthorsResult,
        thisMonthResult,
      ] = await Promise.all([
        db.select({ count: count() }).from(articles),
        db
          .select({ count: count() })
          .from(articles)
          .where(eq(articles.internalStatus, "Pending Review")),
        db
          .select({ count: count() })
          .from(articles)
          .where(eq(articles.internalStatus, "In Review")),
        db
          .select({ count: count() })
          .from(articles)
          .where(eq(articles.internalStatus, "Published")),
        db.select({ count: count() }).from(authors),
        db
          .select({ count: count() })
          .from(articles)
          .where(gte(articles.createdAt, monthStart)),
      ]);

      return {
        totalArticles: totalArticlesResult[0]?.count ?? 0,
        pendingReview: pendingReviewResult[0]?.count ?? 0,
        inProgress: inProgressResult[0]?.count ?? 0,
        published: publishedResult[0]?.count ?? 0,
        totalAuthors: totalAuthorsResult[0]?.count ?? 0,
        thisMonth: thisMonthResult[0]?.count ?? 0,
      };
    } catch (error) {
      console.error("Failed to get dashboard stats:", error);
      return {
        totalArticles: 0,
        pendingReview: 0,
        inProgress: 0,
        published: 0,
        totalAuthors: 0,
        thisMonth: 0,
      };
    }
  }
);

// Recent articles for dashboard
export const getRecentArticles = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const { db } = await import("@db/index");

      const recentArticles = await db.query.articles.findMany({
        with: {
          author: true,
        },
        orderBy: (articles, { desc }) => [desc(articles.createdAt)],
        limit: 5,
      });

      return { articles: recentArticles };
    } catch (error) {
      console.error("Failed to get recent articles:", error);
      return { articles: [] };
    }
  }
);

// All articles with filters
export const getArticles = createServerFn({ method: "POST" })
  .validator(
    (data: {
      status?: string;
      tier?: string;
      search?: string;
      authorId?: string;
      page?: number;
      limit?: number;
    }) => data
  )
  .handler(async ({ data }) => {
    console.log("getArticles called with data:", JSON.stringify(data));
    try {
      const { db, articles } = await import("@db/index");
      const { eq, ilike, and, or, count, sql } = await import("drizzle-orm");

      const page = data?.page ?? 1;
      const limit = data?.limit ?? 20;
      const offset = (page - 1) * limit;

      // Build where conditions
      const conditions = [];

      if (data?.status) {
        conditions.push(eq(articles.internalStatus, data.status as any));
      }

      if (data?.tier) {
        conditions.push(eq(articles.articleTier, data.tier as any));
      }

      if (data?.authorId) {
        conditions.push(eq(articles.authorId, data.authorId));
      }

      if (data?.search) {
        conditions.push(ilike(articles.title, `%${data.search}%`));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // Get articles with author info
      const articleList = await db.query.articles.findMany({
        where: whereClause,
        with: {
          author: true,
          attachments: true,
          multimediaTypes: true,
        },
        orderBy: (articles, { desc }) => [desc(articles.createdAt)],
        limit,
        offset,
      });

      // Get total count
      const [totalResult] = await db
        .select({ count: count() })
        .from(articles)
        .where(whereClause);

      return {
        articles: articleList,
        total: totalResult?.count ?? 0,
        page,
        limit,
        totalPages: Math.ceil((totalResult?.count ?? 0) / limit),
      };
    } catch (error) {
      console.error("Failed to get articles:", error);
      return {
        articles: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      };
    }
  });

// Get single article by ID
export const getArticleById = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    console.log("getArticleById called with data:", data);
    try {
      if (!data?.id) {
        console.error("Article ID is undefined or empty");
        return { article: null };
      }
      const { db, articles } = await import("@db/index");
      const { eq } = await import("drizzle-orm");
      const id = data.id;

      const article = await db.query.articles.findFirst({
        where: eq(articles.id, id),
        with: {
          author: true,
          attachments: true,
          multimediaTypes: true,
          notes: {
            orderBy: (notes, { desc }) => [desc(notes.createdAt)],
          },
          statusHistory: {
            orderBy: (history, { desc }) => [desc(history.changedAt)],
          },
        },
      });

      return { article };
    } catch (error) {
      console.error("Failed to get article:", error);
      return { article: null };
    }
  });

// Get single author with stats
export const getAuthorById = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    console.log("getAuthorById called with data:", JSON.stringify(data));
    try {
      if (!data?.id) {
        console.error("Author ID is undefined or empty");
        return { author: null, stats: null };
      }
      const { db, authors, articles } = await import("@db/index");
      const { eq, sum, count, and } = await import("drizzle-orm");
      const id = data.id;

      const author = await db.query.authors.findFirst({
        where: eq(authors.id, id),
        with: {
          articles: {
            with: {
              attachments: true,
            },
            orderBy: (articles, { desc }) => [desc(articles.createdAt)],
          },
        },
      });

      if (!author) {
        return { author: null, stats: null };
      }

      // Calculate stats
      const [statsResult] = await db
        .select({
          totalArticles: count(),
          totalPaid: sum(articles.paymentAmount),
        })
        .from(articles)
        .where(
          and(eq(articles.authorId, id), eq(articles.paymentStatus, true))
        );

      const [allArticlesCount] = await db
        .select({ count: count() })
        .from(articles)
        .where(eq(articles.authorId, id));

      return {
        author,
        stats: {
          totalArticles: allArticlesCount?.count ?? 0,
          paidArticles: Number(statsResult?.totalArticles) || 0,
          totalEarnings: Number(statsResult?.totalPaid) || 0,
        },
      };
    } catch (error) {
      console.error("Failed to get author:", error);
      return { author: null, stats: null };
    }
  });

// Get all authors
export const getAuthors = createServerFn({ method: "GET" })
  .validator((data?: { search?: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, authors, articles } = await import("@db/index");
      const { ilike, count, eq, sql } = await import("drizzle-orm");

      let whereClause;
      if (data?.search) {
        const { or } = await import("drizzle-orm");
        whereClause = or(
          ilike(authors.givenName, `%${data.search}%`),
          ilike(authors.surname, `%${data.search}%`),
          ilike(authors.email, `%${data.search}%`)
        );
      }

      const authorList = await db.query.authors.findMany({
        where: whereClause,
        orderBy: (authors, { asc }) => [asc(authors.surname)],
      });

      // Get article counts for each author
      const authorsWithCounts = await Promise.all(
        authorList.map(async (author) => {
          const [countResult] = await db
            .select({ count: count() })
            .from(articles)
            .where(eq(articles.authorId, author.id));

          return {
            ...author,
            articleCount: countResult?.count ?? 0,
          };
        })
      );

      return { authors: authorsWithCounts };
    } catch (error) {
      console.error("Failed to get authors:", error);
      return { authors: [] };
    }
  });
