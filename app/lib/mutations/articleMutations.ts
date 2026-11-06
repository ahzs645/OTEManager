import { createServerFn } from "@tanstack/react-start";

// Create a new article manually
export const createArticle = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      title: string;
      issueId?: string;
      creationId?: string;
      authorId?: string;
      // If no authorId, create a new author with these fields
      authorGivenName?: string;
      authorSurname?: string;
      authorEmail?: string;
      articleTier?: string;
      prefersAnonymity?: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("createArticle", data);
  });

// Update article status
export const updateArticleStatus = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      articleId: string;
      status: string;
      changedBy?: string;
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateArticleStatus", data);
  });

// Update article details
export const updateArticle = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      articleId: string;
      title?: string;
      articleTier?: string;
      prefersAnonymity?: boolean;
      paymentStatus?: boolean;
      paymentAmount?: number;
      volume?: number | null;
      issue?: number | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateArticle", data);
  });

// Update article content (markdown)
export const updateArticleContent = createServerFn({ method: "POST" })
  .inputValidator((data: { articleId: string; content: string }) => {
    console.log(
      "[updateArticleContent] Validator received:",
      JSON.stringify(data).slice(0, 200),
    );
    return data;
  })
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateArticleContent", data);
  });

// Update article feedback letter (markdown)
export const updateArticleFeedbackLetter = createServerFn({ method: "POST" })
  .inputValidator((data: { articleId: string; feedbackLetter: string }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateArticleFeedbackLetter", data);
  });

// Update article tier
export const updateArticleTier = createServerFn({ method: "POST" })
  .inputValidator((data: { articleId: string; tier: string }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateArticleTier", data);
  });

// Toggle article featured status (legacy - kept for compatibility)
export const toggleArticleFeatured = createServerFn({ method: "POST" })
  .inputValidator((data: { articleId: string; isFeatured: boolean }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("toggleArticleFeatured", data);
  });

// Delete article
export const deleteArticle = createServerFn({ method: "POST" })
  .inputValidator((articleId: string) => articleId)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("deleteArticle", data);
  });

// Update attachment caption
export const updateAttachmentCaption = createServerFn({ method: "POST" })
  .inputValidator((data: { attachmentId: string; caption: string }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateAttachmentCaption", data);
  });

// Choose which photos are included in issue and WordPress exports
export const setAttachmentsIncludeInExport = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { attachmentIds: string[]; includeInExport: boolean }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("setAttachmentsIncludeInExport", data);
  });

// Delete attachment (document or photo)
export const deleteAttachment = createServerFn({ method: "POST" })
  .inputValidator((data: { attachmentId: string }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("deleteAttachment", data);
  });

// Update article's issue assignment
export const updateArticleIssue = createServerFn({ method: "POST" })
  .inputValidator((data: { articleId: string; issueId: string | null }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateArticleIssue", data);
  });
