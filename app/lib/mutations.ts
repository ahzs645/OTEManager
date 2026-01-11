import { createServerFn } from "@tanstack/start";

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
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const { articleId, ...updateData } = data;

      await db
        .update(articles)
        .set({
          ...updateData,
          articleTier: updateData.articleTier as any,
          updatedAt: new Date(),
        })
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

// Add note to article
export const addArticleNote = createServerFn({ method: "POST" })
  .validator(
    (data: { articleId: string; content: string; createdBy?: string }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, articleNotes } = await import("@db/index");

      const [note] = await db
        .insert(articleNotes)
        .values({
          articleId: data.articleId,
          content: data.content,
          createdBy: data.createdBy,
        })
        .returning();

      return { success: true, note };
    } catch (error) {
      console.error("Failed to add note:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Mark payment as complete
export const markPaymentComplete = createServerFn({ method: "POST" })
  .validator((data: { articleId: string; amount: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db
        .update(articles)
        .set({
          paymentStatus: true,
          paymentAmount: data.amount,
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      return { success: true };
    } catch (error) {
      console.error("Failed to mark payment:", error);
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
      const { getStorage } = await import("../../storage");

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

// Update author payment info
export const updateAuthorPaymentInfo = createServerFn({ method: "POST" })
  .validator(
    (data: {
      authorId: string;
      autoDepositAvailable?: boolean;
      etransferEmail?: string;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, authors } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const { authorId, ...updateData } = data;

      await db
        .update(authors)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(authors.id, authorId));

      return { success: true };
    } catch (error) {
      console.error("Failed to update author:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update article content (markdown)
export const updateArticleContent = createServerFn({ method: "POST" })
  .validator((data: { articleId: string; content: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db
        .update(articles)
        .set({
          content: data.content,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      return { success: true };
    } catch (error) {
      console.error("Failed to update article content:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
