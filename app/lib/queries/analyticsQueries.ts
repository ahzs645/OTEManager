import { createServerFn } from "@tanstack/react-start";

// Date range filter type
interface DateRangeFilter {
  startDate?: string;
  endDate?: string;
}

// Parse an end-date filter inclusively. Date-only strings ("2026-07-17")
// parse to midnight, which would exclude everything that happened later that
// day, so roll date-only values forward to the end of the day.

// Cross-filter type for Power BI-style filtering
interface CrossFilter {
  tier?: string;
  bonus?: string;
  authorType?: string;
  studentType?: string;
  paymentStatus?: boolean;
  semester?: { semester: string; year: number };
}

type FilterWithCross = DateRangeFilter & { crossFilter?: CrossFilter };

// Helper function to build cross-filter conditions

// Get all analytics with cross-filter support (Power BI style)
export const getAllAnalyticsWithCrossFilter = createServerFn({ method: "POST" })
  .inputValidator((data: FilterWithCross) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getAllAnalyticsWithCrossFilter", data);
  });

// Get overall payment statistics
export const getPaymentStats = createServerFn({ method: "POST" })
  .inputValidator((data: DateRangeFilter) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getPaymentStats", data);
  });

// Get payment status breakdown (pie chart data)
export const getPaymentStatusBreakdown = createServerFn({ method: "POST" })
  .inputValidator((data: DateRangeFilter) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getPaymentStatusBreakdown", data);
  });

// Get tier distribution and average payment per tier
export const getTierAnalytics = createServerFn({ method: "POST" })
  .inputValidator((data: DateRangeFilter) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getTierAnalytics", data);
  });

// Get bonus frequency with amounts (bar chart data)
export const getBonusFrequency = createServerFn({ method: "POST" })
  .inputValidator((data: DateRangeFilter) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getBonusFrequency", data);
  });

// Get top earning authors
export const getTopEarningAuthors = createServerFn({ method: "POST" })
  .inputValidator((data: DateRangeFilter & { limit?: number }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getTopEarningAuthors", data);
  });

// Get earnings by author type
export const getEarningsByAuthorType = createServerFn({ method: "POST" })
  .inputValidator((data: DateRangeFilter) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getEarningsByAuthorType", data);
  });

// Get monthly spending trends (uses createdAt for grouping, paymentAmount for totals)
export const getMonthlySpendingTrends = createServerFn({ method: "POST" })
  .inputValidator((data: { months?: number }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getMonthlySpendingTrends", data);
  });

// UNBC Semester definitions
// Fall: Sep-Dec, Winter: Jan-Apr, Summer: May-Aug
type Semester = "Fall" | "Winter" | "Summer";

// Get semester breakdown (UNBC: Fall Sep-Dec, Winter Jan-Apr, Summer May-Aug)
// Uses submittedAt date for proper semester attribution
export const getSemesterBreakdown = createServerFn({ method: "POST" })
  .inputValidator((data: { years?: number }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getSemesterBreakdown", data);
  });

// Helper to format month label (e.g., "2024-01" -> "Jan 2024")

// Get earnings by student type (for students only)
export const getEarningsByStudentType = createServerFn({ method: "POST" })
  .inputValidator((data: DateRangeFilter) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getEarningsByStudentType", data);
  });

// ============================================
// DRILL-DOWN QUERIES
// ============================================

// Get articles by tier
export const getArticlesByTier = createServerFn({ method: "POST" })
  .inputValidator((data: { tier: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getArticlesByTier", data);
  });

// Get articles by bonus type
export const getArticlesByBonus = createServerFn({ method: "POST" })
  .inputValidator((data: { bonusType: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getArticlesByBonus", data);
  });

// Get articles by payment status
export const getArticlesByPaymentStatus = createServerFn({ method: "POST" })
  .inputValidator((data: { paid: boolean; limit?: number }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getArticlesByPaymentStatus", data);
  });

// Get author with their articles
export const getAuthorWithArticles = createServerFn({ method: "POST" })
  .inputValidator((data: { authorId: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getAuthorWithArticles", data);
  });

// Get authors by type
export const getAuthorsByType = createServerFn({ method: "POST" })
  .inputValidator((data: { authorType: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getAuthorsByType", data);
  });

// Get articles by semester (uses submittedAt date)
export const getArticlesBySemester = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { semester: string; year: number; limit?: number }) => data,
  )
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getArticlesBySemester", data);
  });

// Get authors by student type
export const getAuthorsByStudentType = createServerFn({ method: "POST" })
  .inputValidator((data: { studentType: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../../server/convex");
    return query("getAuthorsByStudentType", data);
  });
