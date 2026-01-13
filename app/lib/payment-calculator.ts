// Payment rate configuration type
export interface PaymentRateConfig {
  tier1Rate: number;
  tier2Rate: number;
  tier3Rate: number;
  researchBonus: number;
  multimediaBonus: number;
  timeSensitiveBonus: number;
  professionalPhotoBonus: number;
  professionalGraphicBonus: number;
}

// Bonus breakdown item
export interface BonusItem {
  type: string;
  amount: number;
}

// Full payment calculation result
export interface PaymentCalculation {
  tierName: string;
  tierRate: number;
  bonuses: BonusItem[];
  baseAmount: number;
  bonusAmount: number;
  totalAmount: number;
  calculatedAt: string;
}

// Map tier names to rate config keys
const TIER_RATE_MAP: Record<string, keyof PaymentRateConfig> = {
  "Tier 1 (Basic)": "tier1Rate",
  "Tier 2 (Standard)": "tier2Rate",
  "Tier 3 (Advanced)": "tier3Rate",
};

// Article bonus flags interface
export interface ArticleBonusFlags {
  hasMultimedia: boolean; // Has any photos, graphics, or video
  hasResearchBonus: boolean;
  hasTimeSensitiveBonus: boolean;
  hasProfessionalPhotos: boolean;
  hasProfessionalGraphics: boolean;
}

/**
 * Calculate payment for an article based on tier and bonus flags.
 * Returns a full breakdown that can be stored as a snapshot.
 */
export function calculatePayment(
  articleTier: string,
  bonusFlags: ArticleBonusFlags,
  rateConfig: PaymentRateConfig
): PaymentCalculation {
  // Get tier rate
  const tierRateKey = TIER_RATE_MAP[articleTier] || "tier1Rate";
  const tierRate = rateConfig[tierRateKey];

  // Calculate bonuses based on flags
  const bonuses: BonusItem[] = [];

  // Research Bonus - $10 for extensive research or interviews
  if (bonusFlags.hasResearchBonus && rateConfig.researchBonus) {
    bonuses.push({
      type: "Research",
      amount: rateConfig.researchBonus,
    });
  }

  // Multimedia Bonus - $5 for including original photos, graphics, or video
  if (bonusFlags.hasMultimedia && rateConfig.multimediaBonus) {
    bonuses.push({
      type: "Multimedia",
      amount: rateConfig.multimediaBonus,
    });
  }

  // Time-Sensitive Bonus - $5 for short notice or breaking news
  if (bonusFlags.hasTimeSensitiveBonus && rateConfig.timeSensitiveBonus) {
    bonuses.push({
      type: "Time-Sensitive",
      amount: rateConfig.timeSensitiveBonus,
    });
  }

  // Professional Photo Bonus - $15 for high-quality professional photos
  if (bonusFlags.hasProfessionalPhotos && rateConfig.professionalPhotoBonus) {
    bonuses.push({
      type: "Professional Photos",
      amount: rateConfig.professionalPhotoBonus,
    });
  }

  // Professional Graphic Bonus - $15 for professional graphics/infographics
  if (bonusFlags.hasProfessionalGraphics && rateConfig.professionalGraphicBonus) {
    bonuses.push({
      type: "Professional Graphics",
      amount: rateConfig.professionalGraphicBonus,
    });
  }

  const bonusAmount = bonuses.reduce((sum, b) => sum + b.amount, 0);

  return {
    tierName: articleTier,
    tierRate,
    bonuses,
    baseAmount: tierRate,
    bonusAmount,
    totalAmount: tierRate + bonusAmount,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Format cents to dollar string (e.g., 2000 -> "$20.00")
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Parse dollar string to cents (e.g., "20.00" or "$20.00" -> 2000)
 */
export function parseToCents(value: string): number {
  const cleaned = value.replace(/[$,]/g, "");
  const parsed = parseFloat(cleaned);
  return Math.round(parsed * 100);
}

// Author types that are NOT eligible for payment
const NON_PAID_AUTHOR_TYPES = ["Faculty", "Staff"] as const;

/**
 * Check if an author type is eligible for payment
 */
export function isAuthorEligibleForPayment(authorType: string | null | undefined): boolean {
  if (!authorType) return true; // Default to eligible if unknown
  return !NON_PAID_AUTHOR_TYPES.includes(authorType as any);
}

/**
 * Get a message explaining why an author isn't eligible for payment
 */
export function getPaymentIneligibilityReason(authorType: string | null | undefined): string | null {
  if (!authorType) return null;
  if (NON_PAID_AUTHOR_TYPES.includes(authorType as any)) {
    return `${authorType} members are not eligible for article payment`;
  }
  return null;
}
