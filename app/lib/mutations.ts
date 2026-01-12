import { createServerFn } from "@tanstack/start";
import {
  calculatePayment,
  type PaymentRateConfig,
  type ArticleBonusFlags,
} from "./payment-calculator";

// Update payment rate configuration
export const updatePaymentRateConfig = createServerFn({ method: "POST" })
  .validator(
    (data: {
      tier1Rate: number;
      tier2Rate: number;
      tier3Rate: number;
      researchBonus: number;
      multimediaBonus: number;
      timeSensitiveBonus: number;
      professionalPhotoBonus: number;
      professionalGraphicBonus: number;
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
        researchBonus: data.researchBonus,
        multimediaBonus: data.multimediaBonus,
        timeSensitiveBonus: data.timeSensitiveBonus,
        professionalPhotoBonus: data.professionalPhotoBonus,
        professionalGraphicBonus: data.professionalGraphicBonus,
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

      // Get current rate config (use defaults if not found)
      let config = await db.query.paymentRateConfig.findFirst();
      if (!config) {
        // Use default values
        config = {
          id: "",
          tier1Rate: 2000,
          tier2Rate: 3500,
          tier3Rate: 5000,
          researchBonus: 1000,
          multimediaBonus: 500,
          timeSensitiveBonus: 500,
          professionalPhotoBonus: 1500,
          professionalGraphicBonus: 1500,
          updatedAt: new Date(),
          updatedBy: null,
        };
      }

      // Determine if article has any multimedia (photos, graphics, or video)
      const multimediaTypes = article.multimediaTypes.map((m) => m.multimediaType);
      const hasMultimedia = multimediaTypes.some((t) =>
        ["Photo", "Graphic", "Video"].includes(t)
      );

      // Build bonus flags from article properties
      const bonusFlags: ArticleBonusFlags = {
        hasMultimedia,
        hasResearchBonus: article.hasResearchBonus || false,
        hasTimeSensitiveBonus: article.hasTimeSensitiveBonus || false,
        hasProfessionalPhotos: article.hasProfessionalPhotos || false,
        hasProfessionalGraphics: article.hasProfessionalGraphics || false,
      };

      // Calculate payment
      const calculation = calculatePayment(
        article.articleTier || "Tier 1 (Basic)",
        bonusFlags,
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

// Update article bonus flags and recalculate payment
export const updateArticleBonusFlags = createServerFn({ method: "POST" })
  .validator(
    (data: {
      articleId: string;
      hasResearchBonus?: boolean;
      hasTimeSensitiveBonus?: boolean;
      hasProfessionalPhotos?: boolean;
      hasProfessionalGraphics?: boolean;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, articles, paymentRateConfig } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      // Build update object
      const updateFields: Record<string, any> = { updatedAt: new Date() };
      if (data.hasResearchBonus !== undefined)
        updateFields.hasResearchBonus = data.hasResearchBonus;
      if (data.hasTimeSensitiveBonus !== undefined)
        updateFields.hasTimeSensitiveBonus = data.hasTimeSensitiveBonus;
      if (data.hasProfessionalPhotos !== undefined)
        updateFields.hasProfessionalPhotos = data.hasProfessionalPhotos;
      if (data.hasProfessionalGraphics !== undefined)
        updateFields.hasProfessionalGraphics = data.hasProfessionalGraphics;

      // Update bonus flags
      await db
        .update(articles)
        .set(updateFields)
        .where(eq(articles.id, data.articleId));

      // Get article with multimedia types for recalculation
      const article = await db.query.articles.findFirst({
        where: eq(articles.id, data.articleId),
        with: { multimediaTypes: true },
      });

      if (!article || article.paymentIsManual) {
        return { success: true };
      }

      // Get config (use defaults if not found)
      let config = await db.query.paymentRateConfig.findFirst();
      if (!config) {
        config = {
          id: "",
          tier1Rate: 2000,
          tier2Rate: 3500,
          tier3Rate: 5000,
          researchBonus: 1000,
          multimediaBonus: 500,
          timeSensitiveBonus: 500,
          professionalPhotoBonus: 1500,
          professionalGraphicBonus: 1500,
          updatedAt: new Date(),
          updatedBy: null,
        };
      }

      // Determine if article has any multimedia
      const multimediaTypes = article.multimediaTypes.map((m) => m.multimediaType);
      const hasMultimedia = multimediaTypes.some((t) =>
        ["Photo", "Graphic", "Video"].includes(t)
      );

      // Build bonus flags
      const bonusFlags: ArticleBonusFlags = {
        hasMultimedia,
        hasResearchBonus: article.hasResearchBonus || false,
        hasTimeSensitiveBonus: article.hasTimeSensitiveBonus || false,
        hasProfessionalPhotos: article.hasProfessionalPhotos || false,
        hasProfessionalGraphics: article.hasProfessionalGraphics || false,
      };

      // Recalculate payment
      const calculation = calculatePayment(
        article.articleTier || "Tier 1 (Basic)",
        bonusFlags,
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
      console.error("Failed to update bonus flags:", error);
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

// Update an article note
export const updateArticleNote = createServerFn({ method: "POST" })
  .validator((data: { noteId: string; content: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articleNotes } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const [note] = await db
        .update(articleNotes)
        .set({
          content: data.content,
        })
        .where(eq(articleNotes.id, data.noteId))
        .returning();

      return { success: true, note };
    } catch (error) {
      console.error("Failed to update note:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Delete an article note
export const deleteArticleNote = createServerFn({ method: "POST" })
  .validator((data: { noteId: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articleNotes } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db.delete(articleNotes).where(eq(articleNotes.id, data.noteId));

      return { success: true };
    } catch (error) {
      console.error("Failed to delete note:", error);
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

// ==================== Volume/Issue Mutations ====================

// Create a new volume
export const createVolume = createServerFn({ method: "POST" })
  .validator(
    (data: {
      volumeNumber: number;
      year?: number;
      startDate?: string;
      endDate?: string;
      description?: string;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, volumes } = await import("@db/index");

      const [newVolume] = await db
        .insert(volumes)
        .values({
          volumeNumber: data.volumeNumber,
          year: data.year || null,
          startDate: data.startDate ? new Date(data.startDate) : null,
          endDate: data.endDate ? new Date(data.endDate) : null,
          description: data.description || null,
        })
        .returning();

      return { success: true, volume: newVolume };
    } catch (error) {
      console.error("Failed to create volume:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update a volume
export const updateVolume = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      volumeNumber?: number;
      year?: number | null;
      startDate?: string | null;
      endDate?: string | null;
      description?: string | null;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, volumes } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const { id, ...updateData } = data;

      await db
        .update(volumes)
        .set({
          ...updateData,
          startDate: updateData.startDate ? new Date(updateData.startDate) : null,
          endDate: updateData.endDate ? new Date(updateData.endDate) : null,
          updatedAt: new Date(),
        })
        .where(eq(volumes.id, id));

      return { success: true };
    } catch (error) {
      console.error("Failed to update volume:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Delete a volume (cascades to issues)
export const deleteVolume = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, volumes } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db.delete(volumes).where(eq(volumes.id, data.id));

      return { success: true };
    } catch (error) {
      console.error("Failed to delete volume:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Create a new issue
export const createIssue = createServerFn({ method: "POST" })
  .validator(
    (data: {
      volumeId: string;
      issueNumber: number;
      title?: string;
      releaseDate?: string;
      description?: string;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, issues } = await import("@db/index");

      const [newIssue] = await db
        .insert(issues)
        .values({
          volumeId: data.volumeId,
          issueNumber: data.issueNumber,
          title: data.title || null,
          releaseDate: data.releaseDate ? new Date(data.releaseDate) : null,
          description: data.description || null,
        })
        .returning();

      return { success: true, issue: newIssue };
    } catch (error) {
      console.error("Failed to create issue:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update an issue
export const updateIssue = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      issueNumber?: number;
      title?: string | null;
      releaseDate?: string | null;
      description?: string | null;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, issues } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const { id, ...updateData } = data;

      await db
        .update(issues)
        .set({
          ...updateData,
          releaseDate: updateData.releaseDate ? new Date(updateData.releaseDate) : null,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, id));

      return { success: true };
    } catch (error) {
      console.error("Failed to update issue:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Delete an issue
export const deleteIssue = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, issues } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db.delete(issues).where(eq(issues.id, data.id));

      return { success: true };
    } catch (error) {
      console.error("Failed to delete issue:", error);
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

// Migrate legacy volume/issue data to new tables
export const migrateLegacyVolumeIssues = createServerFn({ method: "POST" }).handler(
  async () => {
    try {
      const { db, articles, volumes, issues } = await import("@db/index");
      const { sql, isNotNull, and } = await import("drizzle-orm");

      // Get all unique volume/issue combinations from articles
      const legacyData = await db
        .selectDistinct({
          volume: articles.volume,
          issue: articles.issue,
        })
        .from(articles)
        .where(and(isNotNull(articles.volume), isNotNull(articles.issue)));

      if (legacyData.length === 0) {
        return { success: true, message: "No legacy data to migrate", created: { volumes: 0, issues: 0 } };
      }

      // Group by volume
      const volumeMap = new Map<number, Set<number>>();
      for (const row of legacyData) {
        if (row.volume !== null && row.issue !== null) {
          if (!volumeMap.has(row.volume)) {
            volumeMap.set(row.volume, new Set());
          }
          volumeMap.get(row.volume)!.add(row.issue);
        }
      }

      let volumesCreated = 0;
      let issuesCreated = 0;

      // Create volumes and issues
      for (const [volumeNumber, issueNumbers] of volumeMap) {
        // Check if volume already exists
        const { eq } = await import("drizzle-orm");
        let existingVolume = await db.query.volumes.findFirst({
          where: eq(volumes.volumeNumber, volumeNumber),
        });

        if (!existingVolume) {
          // Create the volume
          const [newVolume] = await db
            .insert(volumes)
            .values({
              volumeNumber,
            })
            .returning();
          existingVolume = newVolume;
          volumesCreated++;
        }

        // Create issues for this volume
        for (const issueNumber of issueNumbers) {
          // Check if issue already exists
          const existingIssue = await db.query.issues.findFirst({
            where: and(
              eq(issues.volumeId, existingVolume.id),
              eq(issues.issueNumber, issueNumber)
            ),
          });

          if (!existingIssue) {
            // Create the issue
            const [newIssue] = await db
              .insert(issues)
              .values({
                volumeId: existingVolume.id,
                issueNumber,
              })
              .returning();
            issuesCreated++;

            // Update articles with this volume/issue to use the new issueId
            await db
              .update(articles)
              .set({
                issueId: newIssue.id,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(articles.volume, volumeNumber),
                  eq(articles.issue, issueNumber)
                )
              );
          }
        }
      }

      return {
        success: true,
        message: `Migration complete`,
        created: { volumes: volumesCreated, issues: issuesCreated },
      };
    } catch (error) {
      console.error("Failed to migrate legacy volume/issue data:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
);
