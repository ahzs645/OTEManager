import { createServerFn } from "@tanstack/react-start";
import type { PaymentRateConfig } from "./payment-calculator";

// Get payment rate configuration
export const getPaymentRateConfig = createServerFn({ method: "GET" }).handler(
  async () => {
    const { query } = await import("../../server/convex");
    return query("getPaymentRateConfig");
  },
);

// Get payment rate history
export const getPaymentRateHistory = createServerFn({ method: "GET" }).handler(
  async () => {
    const { query } = await import("../../server/convex");
    return query("getPaymentRateHistory");
  },
);

// Dashboard statistics
export const getDashboardStats = createServerFn({ method: "GET" }).handler(
  async () => {
    const { query } = await import("../../server/convex");
    return query("getDashboardStats");
  },
);

// Recent articles for dashboard
export const getRecentArticles = createServerFn({ method: "GET" }).handler(
  async () => {
    const { query } = await import("../../server/convex");
    return query("getRecentArticles");
  },
);

// All articles with filters
export const getArticles = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
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
    }) => data,
  )
  .handler(async ({ data }) => {
    const { query } = await import("../../server/convex");
    return query("getArticles", data);
  });

// Get single article by ID
export const getArticleById = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../server/convex");
    return query("getArticleById", data);
  });

// Get single author with stats
export const getAuthorById = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../server/convex");
    return query("getAuthorById", data);
  });

// Get all authors
export const getAuthors = createServerFn({ method: "GET" })
  .inputValidator((data?: { search?: string }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../server/convex");
    return query("getAuthors", data);
  });

// Get all volumes with their issues and article counts
export const getVolumes = createServerFn({ method: "GET" }).handler(
  async () => {
    const { query } = await import("../../server/convex");
    return query("getVolumes");
  },
);

// Get issue by ID with volume info
export const getIssueById = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../server/convex");
    return query("getIssueById", data);
  });

// Get an issue's articles with their attachments and authors
export const getIssueArticles = createServerFn({ method: "POST" })
  .inputValidator((data: { issueId: string }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../server/convex");
    return query("getIssueArticles", data);
  });

// Get volume by ID
export const getVolumeById = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../server/convex");
    return query("getVolumeById", data);
  });

// Get all issues (for dropdowns)
export const getIssuesForVolume = createServerFn({ method: "POST" })
  .inputValidator((data: { volumeId: string }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../server/convex");
    return query("getIssuesForVolume", data);
  });
