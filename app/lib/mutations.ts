import { createServerFn } from "@tanstack/start";
import {
  calculatePayment,
  type PaymentRateConfig,
} from "./payment-calculator";

// Update payment rate configuration
export const updatePaymentRateConfig = createServerFn({ method: "POST" })
  .validator(
    (data: {
      tier1Rate: number;
      tier2Rate: number;
      tier3Rate: number;
      photoBonus: number;
      graphicBonus: number;
      videoBonus: number;
      audioBonus: number;
      featuredBonus: number;
      updatedBy?: string;
      notes?: string;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, paymentRateConfig, paymentRateHistory } = await import(
        "@db/index"
      );

      // Check if config exists
      const existingConfig = await db.query.paymentRateConfig.findFirst();

      const configData = {
        tier1Rate: data.tier1Rate,
        tier2Rate: data.tier2Rate,
        tier3Rate: data.tier3Rate,
        photoBonus: data.photoBonus,
        graphicBonus: data.graphicBonus,
        videoBonus: data.videoBonus,
        audioBonus: data.audioBonus,
        featuredBonus: data.featuredBonus,
        updatedAt: new Date(),
        updatedBy: data.updatedBy || null,
      };

      if (existingConfig) {
        // Update existing config
        const { eq } = await import("drizzle-orm");
        await db
          .update(paymentRateConfig)
          .set(configData)
          .where(eq(paymentRateConfig.id, existingConfig.id));
      } else {
        // Insert new config
        await db.insert(paymentRateConfig).values(configData);
      }

      // Log to history
      await db.insert(paymentRateHistory).values({
        ratesSnapshot: JSON.stringify(configData),
        changedBy: data.updatedBy || null,
        notes: data.notes || null,
      });

      return { success: true };
    } catch (error) {
      console.error("Failed to update payment rate config:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Calculate and save payment for an article
export const calculateArticlePayment = createServerFn({ method: "POST" })
  .validator((data: { articleId: string; recalculate?: boolean }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles, paymentRateConfig } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      // Get article with multimedia types
      const article = await db.query.articles.findFirst({
        where: eq(articles.id, data.articleId),
        with: { multimediaTypes: true },
      });

      if (!article) {
        return { success: false, error: "Article not found" };
      }

      // Don't recalculate if already has a manual amount (unless forced)
      if (article.paymentIsManual && !data.recalculate) {
        return {
          success: false,
          error: "Article has manual payment set. Use recalculate option to override.",
        };
      }

      // Get current rate config
      const config = await db.query.paymentRateConfig.findFirst();
      if (!config) {
        return { success: false, error: "Payment rate configuration not found" };
      }

      // Calculate payment
      const calculation = calculatePayment(
        article.articleTier || "Tier 1 (Basic)",
        article.multimediaTypes.map((m) => m.multimediaType),
        article.isFeatured || false,
        config as PaymentRateConfig
      );

      // Update article with calculated payment
      await db
        .update(articles)
        .set({
          paymentAmount: calculation.totalAmount,
          paymentRateSnapshot: JSON.stringify(calculation),
          paymentCalculatedAt: new Date(),
          paymentIsManual: false,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      return { success: true, calculation };
    } catch (error) {
      console.error("Failed to calculate article payment:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Set manual payment amount (overrides calculated)
export const setManualPayment = createServerFn({ method: "POST" })
  .validator((data: { articleId: string; amount: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db
        .update(articles)
        .set({
          paymentAmount: data.amount,
          paymentIsManual: true,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      return { success: true };
    } catch (error) {
      console.error("Failed to set manual payment:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Toggle article featured status and recalculate payment
export const toggleArticleFeatured = createServerFn({ method: "POST" })
  .validator((data: { articleId: string; isFeatured: boolean }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles, paymentRateConfig } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      // Update featured status
      await db
        .update(articles)
        .set({
          isFeatured: data.isFeatured,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      // Get article with multimedia types for recalculation
      const article = await db.query.articles.findFirst({
        where: eq(articles.id, data.articleId),
        with: { multimediaTypes: true },
      });

      if (!article || article.paymentIsManual) {
        return { success: true };
      }

      // Recalculate payment with new featured status
      const config = await db.query.paymentRateConfig.findFirst();
      if (!config) {
        return { success: true };
      }

      const calculation = calculatePayment(
        article.articleTier || "Tier 1 (Basic)",
        article.multimediaTypes.map((m) => m.multimediaType),
        data.isFeatured,
        config as PaymentRateConfig
      );

      await db
        .update(articles)
        .set({
          paymentAmount: calculation.totalAmount,
          paymentRateSnapshot: JSON.stringify(calculation),
          paymentCalculatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      return { success: true, calculation };
    } catch (error) {
      console.error("Failed to toggle featured status:", error);
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
