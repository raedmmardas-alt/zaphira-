// Core domain types for Zaphira PPC Control.
// Everything downstream (aggregation, recommendation engine, UI) is typed against this file.

export type ISODate = string; // 'YYYY-MM-DD'

export interface DateRange {
  start: ISODate;
  end: ISODate;
}

// ---------------------------------------------------------------------------
// Product configuration
// ---------------------------------------------------------------------------

export interface Product {
  id: string;
  name: string;
  asin: string;
  sku: string;
  sellingPrice: number | null;
  aliases: string[]; // manual keyword/name aliases
  campaignAliases: string[]; // known campaign name fragments
  adGroupAliases: string[]; // known ad-group name fragments
}

export type MappingSource =
  | 'ASIN'
  | 'SKU'
  | 'ADVERTISED_PRODUCT_REPORT'
  | 'SAVED_AD_GROUP_MAPPING'
  | 'EXPLICIT_ALIAS'
  | 'NAME_INFERENCE'
  | 'UNMAPPED';

export interface ProductMappingResult {
  productId: string | null;
  source: MappingSource;
  confident: boolean;
}

// A persisted manual mapping from a campaign/ad-group key to a product.
export interface SavedAdGroupMapping {
  id: string;
  campaignName: string;
  adGroupName: string | null; // null = maps whole campaign
  productId: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Report imports
// ---------------------------------------------------------------------------

export type ReportType =
  | 'campaign'
  | 'targeting'
  | 'searchTerm'
  | 'advertisedProduct'
  | 'sellerboardProduct'
  | 'sellerboardKeyword';

export type PeriodAlignmentStatus =
  | 'REPORT_PERIODS_ALIGNED'
  | 'AUTO_ALIGNED_HIGH_CONFIDENCE'
  | 'CONFIRM_PERIOD'
  | 'POSSIBLE_DATE_MISMATCH'
  | 'OLD_FILE_WARNING'
  | 'REPORT_SET_MISMATCH';

export interface ReportImportMeta {
  id: string;
  type: ReportType;
  filename: string;
  fileSizeBytes: number;
  rowCount: number;
  importedAt: string; // ISO timestamp
  requestedPeriod: DateRange | null; // confirmed/requested range, if known
  observedPeriod: DateRange | null; // earliest->latest activity found in the data
  periodConfirmedManually: boolean;
  status: 'OK' | 'FORMAT_NOT_RECOGNIZED' | 'DEGRADED';
  detectedColumns: string[];
  missingRequiredFields: string[];
  missingOptionalFields: string[];
}

// ---------------------------------------------------------------------------
// Amazon report rows (normalized)
// ---------------------------------------------------------------------------

export interface CampaignRow {
  campaign: string;
  campaignId?: string;
  status?: string; // as reported by Amazon export, NOT proof of live status
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  budget?: number;
  activityStart?: ISODate;
  activityEnd?: ISODate;
}

export interface TargetingRow {
  campaign: string;
  adGroup: string;
  targetingText: string; // keyword or product target text
  matchType: string;
  targetingId?: string;
  bid: number | null;
  status?: string; // row-level ENABLED/PAUSED — never proof of campaign live status
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  asin?: string;
  sku?: string;
  activityStart?: ISODate;
  activityEnd?: ISODate;
}

export interface SearchTermRow {
  campaign: string;
  adGroup: string;
  searchTerm: string;
  targetingText: string; // matched keyword/target
  matchType: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  asin?: string;
  sku?: string;
  activityStart?: ISODate;
  activityEnd?: ISODate;
}

export interface AdvertisedProductRow {
  campaign: string;
  adGroup: string;
  asin: string;
  sku?: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  activityStart?: ISODate;
  activityEnd?: ISODate;
}

// ---------------------------------------------------------------------------
// Sellerboard rows (normalized, pre-aggregation — one row per day per SKU typically)
// ---------------------------------------------------------------------------

export interface SellerboardProductRow {
  date: ISODate | null;
  marketplace: string;
  asin: string;
  sku: string;
  salesOrganic: number;
  salesPpc: number;
  salesSponsoredProducts: number; // subset of PPC sales, must not be double counted
  // Sellerboard exports these cost columns as SIGNED values (negative = a
  // cost/expense). Raw sign is preserved here at parse time — normalization
  // to positive cost magnitudes happens explicitly during aggregation.
  promotions: number;
  amazonFees: number;
  cogs: number;
  refundCost: number;
  adSpend: number;
  units: number;
  orders: number;
  // Sellerboard's own final signed Net Profit column, when the export
  // includes it. null when the column is absent from this report.
  netProfit: number | null;
}

export interface SellerboardKeywordRow {
  keyword: string;
  asin?: string;
  sku?: string;
  orders: number;
  sales: number;
  spend: number;
  acos: number | null;
  activityStart?: ISODate;
  activityEnd?: ISODate;
}

// ---------------------------------------------------------------------------
// Aggregated product economics (derived from Sellerboard)
// ---------------------------------------------------------------------------

export interface ProductEconomics {
  productId: string | null;
  asin: string;
  sku: string;
  marketplace: string;
  totalSales: number;
  ppcSpend: number;
  promotions: number;
  amazonFees: number;
  cogs: number;
  refundCost: number;
  contributionBeforeAds: number;
  breakEvenAcos: number | null; // null if sales = 0
  netProfit: number;
  margin: number | null;
  realAcos: number | null; // ppcSpend / totalSales
  units: number;
  orders: number;
}

// ---------------------------------------------------------------------------
// Manual product economics (per-order inputs the operator enters directly —
// distinct from the Sellerboard-derived ProductEconomics above. This feeds
// the Product Economics section only; it does NOT feed the PPC
// recommendation engine (decideTargetAction / decideCampaignRecommendation /
// classifyProductStrategy), which continues to run on Sellerboard-derived
// data exactly as before.
// ---------------------------------------------------------------------------

export interface ProductManualEconomicsInputs {
  productId: string;
  // Selling price is read from Product.sellingPrice (single source of
  // truth, already editable in Settings) rather than duplicated here.
  cogs: number | null;
  // Amazon fees are never hard-coded — they vary by category/program and
  // change over time. amazonFeesConfirmed must be explicitly checked by the
  // operator before this product's calculations are treated as complete.
  amazonFees: number | null;
  amazonFeesConfirmed: boolean;
  sellerFundedDiscount: number | null; // optional; defaults to 0 when unset
  targetProfitPerOrder: number | null;
  updatedAt: string;
}

export interface ProductEconomicsCalcResult {
  productId: string;
  // false when Selling Price, COGS, or confirmed Amazon Fees are missing —
  // no calculated figures are shown in that case (never guessed).
  complete: boolean;
  missingFields: string[];
  contributionBeforeAdvertising: number | null;
  breakEvenCpa: number | null;
  breakEvenAcos: number | null;
  // These two additionally require Target Profit per Order — null (with
  // "Set target profit") when that field alone is missing, even if the
  // product is otherwise complete.
  maxCpaForTargetProfit: number | null;
  targetAcos: number | null;
}

// ---------------------------------------------------------------------------
// Delivery / recommendation engine
// ---------------------------------------------------------------------------

export type DeliveryStatus = 'NO_DELIVERY' | 'LOW_DELIVERY' | 'DELIVERING' | 'HIGH_DELIVERY';

export type Risk = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export type TargetActionType =
  | 'WAIT'
  | 'WATCH'
  | 'REDUCE_BID'
  | 'NEGATIVE_PAUSE_CANDIDATE'
  | 'SCALE'
  | 'KEEP'
  | 'PRODUCT_MAPPING_REQUIRED';

export interface TargetAction {
  action: TargetActionType;
  currentBid: number | null;
  recommendedBid: number | null;
  safeRangeMin: number | null;
  safeRangeMax: number | null;
  stopLoss: number | null;
  reason: string;
  risk: Risk;
  confidence: Confidence;
}

// Row-level enriched target used across Keywords/Search Terms/Opportunities screens
export interface EnrichedTarget {
  key: string; // unique key: campaign|adGroup|targetingText|matchType
  targetingText: string;
  matchType: string;
  campaign: string;
  adGroup: string;
  productId: string | null;
  productName: string | null;
  asin: string | null;
  mappingSource: MappingSource;
  currentBid: number | null;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  ctr: number | null;
  cvr: number | null;
  acos: number | null;
  delivery: DeliveryStatus;
  isCurrentPeriod: boolean;
  action: TargetAction;
}

// ---------------------------------------------------------------------------
// Campaign screen
// ---------------------------------------------------------------------------

export type CampaignStatusConfidence = 'CURRENT_ACTIVITY_CONFIRMED' | 'CURRENT_STATUS_UNKNOWN' | 'HISTORICAL_ONLY';

export interface EnrichedCampaign {
  campaign: string;
  productId: string | null;
  productName: string | null;
  statusConfidence: CampaignStatusConfidence;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  acos: number | null;
  ctr: number | null;
  cpc: number | null;
  cvr: number | null;
  budget: number | null;
  recommendation: string;
  risk: Risk;
  confidence: Confidence;
  isCurrentPeriod: boolean;
}

// ---------------------------------------------------------------------------
// Search term intelligence
// ---------------------------------------------------------------------------

export type SearchTermClassification =
  | 'CURRENT_SEARCH_TERM'
  | 'HISTORICAL_WINNER'
  | 'HISTORICAL_PROMISING'
  | 'HISTORICAL_INEFFICIENT'
  | 'HISTORICAL_INSIGHT';

export interface EnrichedSearchTerm {
  searchTerm: string;
  targetingText: string;
  matchType: string;
  campaign: string;
  adGroup: string;
  productId: string | null;
  productName: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  acos: number | null;
  classification: SearchTermClassification;
  isCurrentPeriod: boolean;
}

// ---------------------------------------------------------------------------
// Keyword opportunities
// ---------------------------------------------------------------------------

export type OpportunitySource =
  | 'CONVERTING_SEARCH_TERM'
  | 'HISTORICAL_WINNER'
  | 'SELLERBOARD_KEYWORD'
  | 'MANUAL_KEYWORD_HISTORY'
  | 'MANUAL_ENTRY';

export interface KeywordOpportunity {
  id: string;
  keyword: string;
  source: OpportunitySource;
  productId: string | null;
  productName: string | null;
  historicalOrders: number;
  historicalSales: number;
  historicalAcos: number | null;
  currentActiveStatus: 'CURRENT_STATUS_UNKNOWN' | 'NOT_CURRENTLY_TARGETED' | 'ALREADY_TARGETED';
  alreadyTargeted: boolean;
  suggestedMatchType: string;
  suggestedTestBid: number | null;
  confidence: Confidence;
}

// ---------------------------------------------------------------------------
// Low/No delivery workflow
// ---------------------------------------------------------------------------

export type DeliveryWorkflowStatus = 'NONE' | 'HIDDEN' | 'PAUSE_CANDIDATE' | 'KEEP_WATCHING';

export interface DeliveryWorkflowEntry {
  targetKey: string;
  status: DeliveryWorkflowStatus;
  periodsObservedLowNoDelivery: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Shadow mode
// ---------------------------------------------------------------------------

export interface ShadowSnapshot {
  id: string;
  savedAt: string;
  reportPeriod: DateRange | null;
  // Stable identity: productId/ASIN + campaign + ad group + target + match
  // type, so identical keyword text across different products (e.g. "body
  // butter" on Rose vs Coconut) never collides even if campaign/ad-group
  // naming were ever shared across products.
  targetKey: string;
  targetingText: string;
  matchType: string;
  productId: string | null;
  productName: string | null;
  asin: string | null;
  campaign: string;
  adGroup: string;
  currentBid: number | null;
  recommendedAction: TargetActionType;
  recommendedBid: number | null;
  risk: Risk;
  confidence: Confidence;
  delivery: DeliveryStatus;
  beforeMetrics: {
    impressions: number;
    clicks: number;
    spend: number;
    orders: number;
    sales: number;
    acos: number | null;
    cvr: number | null;
  };
  appliedManually: boolean;
  appliedAt: string | null;
}

export type ShadowOutcome = 'POSITIVE' | 'MIXED' | 'NEGATIVE' | 'INSUFFICIENT_DATA' | 'NON_COMPARABLE_PERIOD';

export interface ShadowEvaluation {
  snapshotId: string;
  outcome: ShadowOutcome;
  afterMetrics: ShadowSnapshot['beforeMetrics'] | null;
  notes: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type StrategyPosture = 'MAINTENANCE' | 'GROWTH' | 'AGGRESSIVE_GROWTH';

export interface DeliveryThresholds {
  lowDeliveryMaxImpressions: number; // 1-10 default
  highDeliveryMinImpressions: number;
  highDeliveryMinClicks: number;
}

export interface Settings {
  strategyPosture: StrategyPosture;
  targetAcosDefault: number; // 0.45
  maxDailyPpcBudget: number; // 16
  maxBidIncreasePct: number; // 0.05
  maxBidReductionPct: number; // 0.15
  deliveryThresholds: DeliveryThresholds;
  stopLossClicks: number;
  stopLossSpend: number;
  // Reserved for future multi-marketplace/multi-currency support. Only a
  // single option each is offered today (US / USD) — no conversion or
  // marketplace-specific logic exists yet.
  country: string;
  currency: string;
}

export const DEFAULT_SETTINGS: Settings = {
  strategyPosture: 'MAINTENANCE',
  targetAcosDefault: 0.45,
  maxDailyPpcBudget: 16,
  maxBidIncreasePct: 0.05,
  maxBidReductionPct: 0.15,
  deliveryThresholds: {
    lowDeliveryMaxImpressions: 10,
    highDeliveryMinImpressions: 300,
    highDeliveryMinClicks: 15,
  },
  stopLossClicks: 30,
  stopLossSpend: 25,
  country: 'US',
  currency: 'USD',
};

export const DEFAULT_PRODUCTS: Product[] = [
  { id: 'rose', name: 'Rose', asin: 'B0GZVBBRZP', sku: '', sellingPrice: 19.99, aliases: ['rose'], campaignAliases: [], adGroupAliases: [] },
  { id: 'coconut', name: 'Coconut', asin: 'B0GZVGXXS2', sku: '', sellingPrice: 19.99, aliases: ['coconut'], campaignAliases: [], adGroupAliases: [] },
  { id: 'mango', name: 'Mango', asin: 'B0GZVP9HRB', sku: '', sellingPrice: 19.99, aliases: ['mango'], campaignAliases: [], adGroupAliases: [] },
  { id: 'vanilla', name: 'Vanilla', asin: 'B0H28WG6BB', sku: '', sellingPrice: 19.99, aliases: ['vanilla'], campaignAliases: [], adGroupAliases: [] },
];

// Amazon Fees are deliberately NOT seeded here (null + unconfirmed) — they
// vary by category/program and must never be assumed. Selling Price/COGS
// use the known current values; the operator must enter and confirm fees
// before this product's economics are treated as complete.
export const DEFAULT_PRODUCT_MANUAL_ECONOMICS: Record<string, ProductManualEconomicsInputs> = {
  rose: { productId: 'rose', cogs: 2.91, amazonFees: null, amazonFeesConfirmed: false, sellerFundedDiscount: 0, targetProfitPerOrder: null, updatedAt: '' },
  coconut: { productId: 'coconut', cogs: 2.91, amazonFees: null, amazonFeesConfirmed: false, sellerFundedDiscount: 0, targetProfitPerOrder: null, updatedAt: '' },
  mango: { productId: 'mango', cogs: 2.91, amazonFees: null, amazonFeesConfirmed: false, sellerFundedDiscount: 0, targetProfitPerOrder: null, updatedAt: '' },
  vanilla: { productId: 'vanilla', cogs: 2.91, amazonFees: null, amazonFeesConfirmed: false, sellerFundedDiscount: 0, targetProfitPerOrder: null, updatedAt: '' },
};

export function blankManualEconomics(productId: string): ProductManualEconomicsInputs {
  return { productId, cogs: null, amazonFees: null, amazonFeesConfirmed: false, sellerFundedDiscount: 0, targetProfitPerOrder: null, updatedAt: '' };
}

// ---------------------------------------------------------------------------
// Account net profit by period
// ---------------------------------------------------------------------------

export interface AccountNetProfitEntry {
  periodKey: string; // `${start}_${end}`
  period: DateRange;
  accountNetProfit: number;
  enteredAt: string;
}

// ---------------------------------------------------------------------------
// Data reconciliation
// ---------------------------------------------------------------------------

export type ReconciliationStatus = 'DATA_RECONCILED' | 'SMALL_ATTRIBUTION_DIFFERENCE' | 'DATA_MISMATCH_REVIEW_REQUIRED';

export interface ReconciliationCheck {
  label: string;
  a: number | null;
  b: number | null;
  diffPct: number | null;
  status: ReconciliationStatus;
}

// ---------------------------------------------------------------------------
// Product strategy classification
// ---------------------------------------------------------------------------

export type ProductStrategy = 'GROW_CAREFULLY' | 'FIX_ECONOMICS' | 'REDUCE_WASTE' | 'MONITOR' | 'INSUFFICIENT_DATA';

export interface ProductStrategyResult {
  productId: string | null;
  strategy: ProductStrategy;
  reason: string;
}
