import { createServerFn } from "@tanstack/react-start";
import { validateConfirmation } from "../../../extensions/vancity-payment-helper/receipt-contract.js";

export const recordBankPayment = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateConfirmation(data))
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("recordBankPayment", data);
  });
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
  .inputValidator(
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
    }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updatePaymentRateConfig", data);
  });

// Calculate and save payment for an article
export const calculateArticlePayment = createServerFn({ method: "POST" })
  .inputValidator((data: { articleId: string; recalculate?: boolean }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("calculateArticlePayment", data);
  });

// Set manual payment amount (overrides calculated)
export const setManualPayment = createServerFn({ method: "POST" })
  .inputValidator((data: { articleId: string; amount: number }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("setManualPayment", data);
  });

// Mark payment as complete
export const markPaymentComplete = createServerFn({ method: "POST" })
  .inputValidator((data: { articleId: string; amount: number }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("markPaymentComplete", data);
  });

// Update article bonus flags and recalculate payment
export const updateArticleBonusFlags = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      articleId: string;
      hasResearchBonus?: boolean;
      hasTimeSensitiveBonus?: boolean;
      hasProfessionalPhotos?: boolean;
      hasProfessionalGraphics?: boolean;
      hasMultimediaBonus?: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateArticleBonusFlags", data);
  });
