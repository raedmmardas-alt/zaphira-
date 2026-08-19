// Helium 10 / Cerebro keyword intelligence types. Kept in a dedicated file
// (rather than the shared types/index.ts) since this is a large, fully
// self-contained feature that never feeds the core Amazon/Sellerboard
// pipeline, reconciliation, period engine, or persistence model used by
// everything else in types/index.ts.

export interface HeliumImportMeta {
  id: string;
  filename: string;
  fileSizeBytes: number;
  rowCount: number;
  importedAt: string; // ISO timestamp
  status: 'OK' | 'FORMAT_NOT_RECOGNIZED' | 'DEGRADED';
  detectedColumns: string[];
  missingRequiredFields: string[];
  missingOptionalFields: string[];
}

// One raw row = one keyword row as Helium 10 / Cerebro exported it. A
// multi-ASIN Cerebro run produces one row per keyword per competitor ASIN,
// so the same keyword text can legitimately appear many times.
export interface HeliumRawKeywordRow {
  keyword: string; // original, human-readable text — never altered
  searchVolume: number | null;
  organicRank: number | null;
  sponsoredRank: number | null;
  competingProducts: number | null;
  titleDensity: number | null;
  cerebroIqScore: number | null;
  cpr: number | null;
  suggestedBid: number | null;
  keywordSales: number | null;
  searchVolumeTrend: number | null;
  competitorAsin: string | null;
}

// Deduplicated across every competitor row sharing the same normalized
// keyword text — combined evidence, never duplicate rows.
export interface HeliumKeywordAggregate {
  keyword: string; // first-seen original readable text, for display
  normalizedKeyword: string;
  competitorCount: number; // distinct competitor ASINs observed (or 1 if the export has no ASIN column at all but the keyword appears)
  competitorAsins: string[];
  bestOrganicRank: number | null;
  bestSponsoredRank: number | null;
  medianOrganicRank: number | null;
  maxSearchVolume: number | null;
  titleDensity: number | null;
  competingProducts: number | null;
  suggestedBid: number | null; // median across observed rows
  searchVolumeTrend: number | null;
}

export type KeywordAction = 'LAUNCH' | 'TEST' | 'WATCH' | 'AVOID';
export type KeywordRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
export type KeywordConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type KeywordMatchType = 'EXACT' | 'PHRASE';

export interface KeywordZaphiraHistory {
  label: string;
  clicks: number;
  spend: number;
  orders: number;
  isExistingTarget: boolean;
  isHistoricalWinner: boolean;
}

export interface KeywordIntelligenceResult {
  keyword: string;
  normalizedKeyword: string;
  productId: string | null;
  productName: string | null;
  isGenericRelevance: boolean;
  isCompetitorBrand: boolean;
  searchVolume: number | null;
  competitorCount: number;
  competitorStrengthLabel: string;
  zaphiraHistory: KeywordZaphiraHistory;
  opportunityScore: number; // 0-100
  risk: KeywordRisk;
  confidence: KeywordConfidence;
  recommendedMatchType: KeywordMatchType;
  recommendedBid: number | null;
  maxSafeBid: number | null;
  recommendedDailyBudget: number | null;
  action: KeywordAction;
  explanation: string;
}

export interface KeywordCampaignSummary {
  keywordCount: number; // LAUNCH + TEST only
  recommendedDailyBudget: number;
  estimatedMonthlyBudget: number;
}

export interface KeywordBlueprintRow {
  productName: string;
  campaignName: string;
  keyword: string;
  matchType: KeywordMatchType;
  recommendedBid: number | null;
  maxSafeBid: number | null;
  recommendedDailyAllocation: number | null;
  action: KeywordAction;
  reason: string;
}
