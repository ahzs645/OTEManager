import { createServerFn } from "@tanstack/start";

// Create a new article manually
export const createArticle = createServerFn({ method: "POST" })
  .validator(
    (data: {
      title: string;
      authorId?: string;
      // If no authorId, create a new author with these fields
      authorGivenName?: string;
      authorSurname?: string;
      authorEmail?: string;
      articleTier?: string;
      prefersAnonymity?: boolean;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, articles, authors, statusHistory } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      let authorId = data.authorId;

      // If no authorId provided, create or find author
      if (!authorId) {
        if (!data.authorEmail || !data.authorGivenName || !data.authorSurname) {
          return { success: false, error: "Author information is required" };
        }

        // Check if author with this email already exists
        const existingAuthor = await db.query.authors.findFirst({
          where: eq(authors.email, data.authorEmail),
        });

        if (existingAuthor) {
          authorId = existingAuthor.id;
        } else {
          // Create new author
          const [newAuthor] = await db
            .insert(authors)
            .values({
              givenName: data.authorGivenName,
              surname: data.authorSurname,
              email: data.authorEmail,
              role: "Guest Contributor",
            })
            .returning();
          authorId = newAuthor.id;
        }
      }

      // Create the article
      const [newArticle] = await db
        .insert(articles)
        .values({
          title: data.title,
          authorId: authorId,
          articleTier: (data.articleTier as any) || "Tier 1 (Basic)",
          prefersAnonymity: data.prefersAnonymity || false,
          internalStatus: "Draft",
          automationStatus: "Completed",
          submittedAt: new Date(),
        })
        .returning();

      // Add initial status history
      await db.insert(statusHistory).values({
        articleId: newArticle.id,
        fromStatus: null,
        toStatus: "Draft",
        changedBy: "Manual Entry",
        notes: "Article created manually",
      });

      return { success: true, articleId: newArticle.id };
    } catch (error) {
      console.error("Failed to create article:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update article status
export const updateArticleStatus = createServerFn({ method: "POST" })
  .validator(
    (data: {
      articleId: string;
      status: string;
      changedBy?: string;
      notes?: string;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, articles, statusHistory } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      // Get current article
      const currentArticle = await db.query.articles.findFirst({
        where: eq(articles.id, data.articleId),
      });

      if (!currentArticle) {
        return { success: false, error: "Article not found" };
      }

      // Update article status
      await db
        .update(articles)
        .set({
          internalStatus: data.status as any,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      // Add to status history
      await db.insert(statusHistory).values({
        articleId: data.articleId,
        fromStatus: currentArticle.internalStatus,
        toStatus: data.status as any,
        changedBy: data.changedBy,
        notes: data.notes,
      });

      return { success: true };
    } catch (error) {
      console.error("Failed to update article status:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update article details
export const updateArticle = createServerFn({ method: "POST" })
  .validator(
    (data: {
      articleId: string;
      title?: string;
      articleTier?: string;
      prefersAnonymity?: boolean;
      paymentStatus?: boolean;
      paymentAmount?: number;
      volume?: number | null;
      issue?: number | null;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const { articleId, ...rest } = data;

      // Build update object, only including defined fields
      // null is allowed (to clear values), undefined is not
      const updateData: Record<string, any> = { updatedAt: new Date() };

      if (rest.title !== undefined) updateData.title = rest.title;
      if (rest.articleTier !== undefined) updateData.articleTier = rest.articleTier;
      if (rest.prefersAnonymity !== undefined) updateData.prefersAnonymity = rest.prefersAnonymity;
      if (rest.paymentStatus !== undefined) updateData.paymentStatus = rest.paymentStatus;
      if (rest.paymentAmount !== undefined) updateData.paymentAmount = rest.paymentAmount;
      if (rest.volume !== undefined) updateData.volume = rest.volume;
      if (rest.issue !== undefined) updateData.issue = rest.issue;

      await db
        .update(articles)
        .set(updateData)
        .where(eq(articles.id, articleId));

      return { success: true };
    } catch (error) {
      console.error("Failed to update article:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update article content (markdown)
export const updateArticleContent = createServerFn({ method: "POST" })
  .validator((data: { articleId: string; content: string }) => {
    console.log("[updateArticleContent] Validator received:", JSON.stringify(data).slice(0, 200));
    return data;
  })
  .handler(async ({ data }) => {
    console.log("[updateArticleContent] Handler received data:", JSON.stringify(data).slice(0, 200));
    console.log("[updateArticleContent] articleId:", data.articleId);
    console.log("[updateArticleContent] content length:", data.content?.length);
    try {
      const { db, articles } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const result = await db
        .update(articles)
        .set({
          content: data.content,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      console.log("[updateArticleContent] Update result:", result);
      return { success: true };
    } catch (error) {
      console.error("Failed to update article content:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update article feedback letter (markdown)
export const updateArticleFeedbackLetter = createServerFn({ method: "POST" })
  .validator((data: { articleId: string; feedbackLetter: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db
        .update(articles)
        .set({
          feedbackLetter: data.feedbackLetter,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      return { success: true };
    } catch (error) {
      console.error("Failed to update feedback letter:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update article tier
export const updateArticleTier = createServerFn({ method: "POST" })
  .validator((data: { articleId: string; tier: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db
        .update(articles)
        .set({
          articleTier: data.tier as any,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      return { success: true };
    } catch (error) {
      console.error("Failed to update tier:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Toggle article featured status (legacy - kept for compatibility)
export const toggleArticleFeatured = createServerFn({ method: "POST" })
  .validator((data: { articleId: string; isFeatured: boolean }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      // Update featured status
      await db
        .update(articles)
        .set({
          isFeatured: data.isFeatured,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      return { success: true };
    } catch (error) {
      console.error("Failed to toggle featured status:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Delete article
export const deleteArticle = createServerFn({ method: "POST" })
  .validator((articleId: string) => articleId)
  .handler(async ({ data: articleId }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq } = await import("drizzle-orm");
      const { getStorage } = await import("../../../storage");

      // Get article with attachments
      const article = await db.query.articles.findFirst({
        where: eq(articles.id, articleId),
        with: { attachments: true },
      });

      if (!article) {
        return { success: false, error: "Article not found" };
      }

      // Delete files from storage
      const storage = getStorage();
      for (const attachment of article.attachments) {
        await storage.delete(attachment.filePath);
      }

      // Delete article (cascades to attachments, notes, etc.)
      await db.delete(articles).where(eq(articles.id, articleId));

      return { success: true };
    } catch (error) {
      console.error("Failed to delete article:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update attachment caption
export const updateAttachmentCaption = createServerFn({ method: "POST" })
  .validator((data: { attachmentId: string; caption: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, attachments } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db
        .update(attachments)
        .set({
          caption: data.caption || null,
        })
        .where(eq(attachments.id, data.attachmentId));

      return { success: true };
    } catch (error) {
      console.error("Failed to update attachment caption:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Delete attachment (document or photo)
export const deleteAttachment = createServerFn({ method: "POST" })
  .validator((data: { attachmentId: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, attachments } = await import("@db/index");
      const { eq } = await import("drizzle-orm");
      const { getStorage } = await import("../../../storage");

      // Get the attachment first to get the file path
      const attachment = await db.query.attachments.findFirst({
        where: eq(attachments.id, data.attachmentId),
      });

      if (!attachment) {
        return { success: false, error: "Attachment not found" };
      }

      // Delete file from storage
      const storage = getStorage();
      await storage.delete(attachment.filePath);

      // Delete from database
      await db.delete(attachments).where(eq(attachments.id, data.attachmentId));

      return { success: true };
    } catch (error) {
      console.error("Failed to delete attachment:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update article's issue assignment
export const updateArticleIssue = createServerFn({ method: "POST" })
  .validator((data: { articleId: string; issueId: string | null }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db
        .update(articles)
        .set({
          issueId: data.issueId,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      return { success: true };
    } catch (error) {
      console.error("Failed to update article issue:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
