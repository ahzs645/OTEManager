import { createServerFn } from "@tanstack/start";
import {
  calculatePayment,
  type PaymentRateConfig,
  type ArticleBonusFlags,
} from "../payment-calculator";

// Default payment config values
const DEFAULT_PAYMENT_CONFIG = {
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
        config = { ...DEFAULT_PAYMENT_CONFIG };
      }

      // Determine if article has multimedia bonus
      // If hasMultimediaBonus is explicitly set, use that; otherwise auto-detect from attachments
      let hasMultimedia: boolean;
      if (article.hasMultimediaBonus !== null) {
        hasMultimedia = article.hasMultimediaBonus;
      } else {
        const multimediaTypes = article.multimediaTypes.map((m) => m.multimediaType);
        hasMultimedia = multimediaTypes.some((t) =>
          ["Photo", "Graphic", "Video"].includes(t)
        );
      }

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

// Update article bonus flags and recalculate payment
export const updateArticleBonusFlags = createServerFn({ method: "POST" })
  .validator(
    (data: {
      articleId: string;
      hasResearchBonus?: boolean;
      hasTimeSensitiveBonus?: boolean;
      hasProfessionalPhotos?: boolean;
      hasProfessionalGraphics?: boolean;
      hasMultimediaBonus?: boolean;
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
      if (data.hasMultimediaBonus !== undefined)
        updateFields.hasMultimediaBonus = data.hasMultimediaBonus;

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
        config = { ...DEFAULT_PAYMENT_CONFIG };
      }

      // Determine if article has multimedia bonus
      // If hasMultimediaBonus is explicitly set, use that; otherwise auto-detect
      let hasMultimedia: boolean;
      if (article.hasMultimediaBonus !== null) {
        hasMultimedia = article.hasMultimediaBonus;
      } else {
        const multimediaTypes = article.multimediaTypes.map((m) => m.multimediaType);
        hasMultimedia = multimediaTypes.some((t) =>
          ["Photo", "Graphic", "Video"].includes(t)
        );
      }

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
