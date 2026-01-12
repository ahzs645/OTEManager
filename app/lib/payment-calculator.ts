// Payment rate configuration type
export interface PaymentRateConfig {
  tier1Rate: number;
  tier2Rate: number;
  tier3Rate: number;
  photoBonus: number;
  graphicBonus: number;
  videoBonus: number;
  audioBonus: number;
  featuredBonus: number;
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

// Map multimedia types to bonus config keys
const BONUS_RATE_MAP: Record<string, keyof PaymentRateConfig> = {
  Photo: "photoBonus",
  Graphic: "graphicBonus",
  Video: "videoBonus",
  Audio: "audioBonus",
};

/**
 * Calculate payment for an article based on tier and multimedia types.
 * Returns a full breakdown that can be stored as a snapshot.
 */
export function calculatePayment(
  articleTier: string,
  multimediaTypes: string[],
  isFeatured: boolean,
  rateConfig: PaymentRateConfig
): PaymentCalculation {
  // Get tier rate
  const tierRateKey = TIER_RATE_MAP[articleTier] || "tier1Rate";
  const tierRate = rateConfig[tierRateKey];

  // Calculate bonuses from multimedia types (each type only counts once)
  const bonuses: BonusItem[] = [];
  const uniqueTypes = [...new Set(multimediaTypes)];

  for (const type of uniqueTypes) {
    const bonusKey = BONUS_RATE_MAP[type];
    if (bonusKey && rateConfig[bonusKey]) {
      bonuses.push({
        type,
        amount: rateConfig[bonusKey],
      });
    }
  }

  // Add featured bonus if applicable
  if (isFeatured && rateConfig.featuredBonus) {
    bonuses.push({
      type: "Featured",
      amount: rateConfig.featuredBonus,
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
 * Format cents to dollar string (e.g., 10000 -> "$100.00")
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Parse dollar string to cents (e.g., "100.00" or "$100.00" -> 10000)
 */
export function parseToCents(value: string): number {
  const cleaned = value.replace(/[$,]/g, "");
  const parsed = parseFloat(cleaned);
  return Math.round(parsed * 100);
}
