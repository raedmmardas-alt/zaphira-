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
  // Tri-state operator response, additive to appliedManually above.
  // appliedManually remains the ONLY gate for directional-accuracy
  // evaluation (failure mode #11) — status is purely a richer record of
  // operator intent and is never itself read by evaluateShadowSnapshot.
  status: ShadowRecommendationStatus;
  statusUpdatedAt: string | null;
}

export type ShadowRecommendationStatus = 'PENDING' | 'ACCEPTED' | 'APPLIED_MANUALLY' | 'REJECTED';

export type ShadowOutcome = 'POSITIVE' | 'MIXED' | 'NEGATIVE' | 'INSUFFICIENT_DATA' | 'NON_COMPARABLE_PERIOD';

export interface ShadowEvaluation {
  snapshotId: string;
  outcome: ShadowOutcome;
  afterMetrics: ShadowSnapshot['beforeMetrics'] | null;
  notes: string;
}

// ---------------------------------------------------------------------------
// Risk & stop-loss (Intelligence Engine)
// ---------------------------------------------------------------------------

export type RiskClassification = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface RiskBreakdown {
  // Each dimension is 0-100, higher = riskier.
  spendRisk: number;
  conversionRisk: number;
  profitabilityRisk: number;
  deliveryRisk: number;
  // Sample-size/data-sufficiency risk. Explicitly SEPARATE from the other
  // dimensions — low sample size increases this alone, it never inflates
  // conversion/profitability risk by itself (insufficient data must not be
  // read as poor performance).
  dataConfidenceRisk: number;
  overallScore: number; // 0-100 weighted composite
  classification: RiskClassification;
  // Maximum $ this target/campaign should be tested with before a stop-loss
  // action is warranted.
  maxTestingSpend: number;
  maxTestingSpendSource: 'PRODUCT_ECONOMICS' | 'SETTINGS_FALLBACK';
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Prediction (Intelligence Engine) — conservative, range-based, never guaranteed
// ---------------------------------------------------------------------------

export type ForecastHorizon = 'NEXT_3_DAYS' | 'NEXT_7_DAYS' | 'NEXT_30_DAYS';

export interface ForecastRange {
  low: number;
  expected: number;
  high: number;
}

export interface ForecastResult {
  horizon: ForecastHorizon;
  horizonDays: number;
  observedDays: number;
  confidence: Confidence;
  spend: ForecastRange;
  clicks: ForecastRange;
  orders: ForecastRange;
  sales: ForecastRange;
  cpa: number | null; // expected-case only; null when expected orders round to 0
  acos: number | null; // expected-case only; null when expected sales are 0
  estimatedProfit: ForecastRange | null; // null when product economics are incomplete
  isEstimate: true;
  disclaimer: string;
  // True when there are 0 observed clicks — not enough delivery evidence to
  // project spend/clicks/orders at all. When true, every ForecastRange
  // above is zeroed and must be presented as "insufficient delivery", never
  // as a meaningful $0 prediction.
  insufficientDelivery: boolean;
  // One short, human-readable line stating the main assumption this
  // forecast rests on (e.g. the conversion-rate prior used, or the order
  // value assumed) — always present, so the range is never read as more
  // certain than it is.
  assumption: string;
}

// ---------------------------------------------------------------------------
// Action Engine (Intelligence Engine) — expanded, explainable action vocabulary
// ---------------------------------------------------------------------------

export type DecisionActionType =
  | 'SCALE'
  | 'INCREASE_BID'
  | 'KEEP'
  | 'WATCH'
  | 'HOLD_COLLECT_DATA'
  | 'REDUCE_BID'
  | 'PAUSE'
  | 'TEST_IN_PHRASE'
  | 'MOVE_TO_EXACT'
  | 'ADD_NEGATIVE'
  | 'INCREASE_BUDGET'
  | 'REDUCE_BUDGET';

// How much real conversion evidence exists yet. Deliberately separate from
// risk/confidence — this is purely "how much do we actually know", never an
// inference about performance. NONE/WEAK never imply poor performance, and
// SCALE/INCREASE_BUDGET decisions require at least MODERATE.
export type ConversionEvidence = 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG';

export interface DecisionAction {
  scope: 'TARGET' | 'CAMPAIGN';
  key: string;
  productId: string | null;
  productName: string | null;
  campaign: string;
  adGroup: string | null;
  targetingText: string | null;
  matchType: string | null;
  action: DecisionActionType;
  currentBid: number | null;
  recommendedBid: number | null;
  currentBudget: number | null;
  recommendedBudget: number | null;
  reason: string;
  risk: RiskBreakdown;
  confidence: Confidence;
  // Signed dollar estimate: positive = incremental opportunity, negative =
  // amount currently at risk / recoverable by acting. Always an estimate.
  estimatedImpact: number;
  currentPerformance: {
    impressions: number;
    clicks: number;
    spend: number;
    orders: number;
    sales: number;
    acos: number | null;
  };
  // Early-stage evidence fields — always populated (never fabricated), so
  // the Decision Center can give useful guidance before there are enough
  // orders for the base engine to reach a firm SCALE/REDUCE/PAUSE call.
  conversionEvidence: ConversionEvidence;
  // Short, human-readable next milestone, e.g. "HOLD — COLLECT 2 MORE
  // CLICKS" or "WATCH — $3.03 REMAINING BEFORE REVIEW". Always present.
  checkpointLabel: string;
  // Dollars remaining before risk.maxTestingSpend is reached. Floored at 0.
  remainingTestAllowance: number;
  // Manual per-product economics dollar figures, when confirmed. Null,
  // never guessed, when Amazon Fees haven't been entered/confirmed.
  targetCpa: number | null; // Maximum CPA for target profit — the soft review threshold
  breakEvenCpa: number | null; // Break-even CPA — the hard stop-loss threshold
  // Two DISTINCT remaining-budget figures, both simple (threshold - spend),
  // floored at 0. Never conflate these: targetCpa is a soft review trigger
  // that preserves the product's target profit; breakEvenCpa is the hard
  // economic floor. Null when the respective CPA figure isn't available
  // (economics incomplete) or when there are already orders (spend-vs-CPA
  // framing only applies pre-conversion). Populated for zero-order targets
  // only.
  remainingToTargetCpaReview: number | null;
  remainingToBreakEvenStop: number | null;
  delivery: DeliveryStatus;
}

// ---------------------------------------------------------------------------
// Variant Intelligence (Intelligence Engine)
// ---------------------------------------------------------------------------

export interface VariantMetricRow {
  productId: string;
  productName: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  orders: number;
  cvr: number | null;
  spend: number;
  sales: number;
  cpa: number | null;
  acos: number | null;
  roas: number | null;
  netProfit: number | null;
  riskScore: number | null;
}

export interface VariantIntelligenceResult {
  rows: VariantMetricRow[];
  strongestTraffic: string | null;
  bestCtr: string | null;
  bestConversion: string | null;
  bestCpa: string | null;
  bestProfitability: string | null;
  strongestScalingOpportunity: string | null;
  highestRisk: string | null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// The single canonical list of marketplaces the app actually supports —
// both the legacy Dashboard's Country/Currency selectors (DashboardTopBars)
// and the compact GlobalContextBar's Marketplace dropdown read from this
// same list, so there is exactly one place that defines "which marketplaces
// exist" rather than two independently-hardcoded option lists that could
// drift apart. Only US/USD exists today; adding a marketplace means adding
// one entry here, not building a second marketplace system.
export interface MarketplaceOption {
  country: string;
  label: string; // full dropdown label, e.g. "United States — Amazon.com"
  shortLabel: string; // e.g. "United States", for prose like "No Canada data uploaded"
  currency: string;
}

export const SUPPORTED_MARKETPLACES: MarketplaceOption[] = [
  { country: 'US', label: 'United States — Amazon.com', shortLabel: 'United States', currency: 'USD' },
  { country: 'CA', label: 'Canada — Amazon.ca', shortLabel: 'Canada', currency: 'CAD' },
  { country: 'MX', label: 'Mexico — Amazon.com.mx', shortLabel: 'Mexico', currency: 'MXN' },
];

// Display Currency is a separate, independent setting from the marketplace's
// report currency (Settings.currency) — a presentation-only conversion
// layer for monetary values. It never changes what currency the underlying
// Amazon/Sellerboard data was reported in.
export const BASE_REPORT_CURRENCY = 'USD';
export const SUPPORTED_DISPLAY_CURRENCIES = ['USD', 'AED', 'EUR', 'CAD', 'MXN'];

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
  // Reserved for future multi-marketplace support. Only a single option is
  // offered today (US) — no marketplace-specific data isolation exists yet.
  country: string;
  // The currency the underlying report data is actually denominated in —
  // follows the selected marketplace (SUPPORTED_MARKETPLACES), never user-
  // editable independently. All PPC calculations always run in this
  // currency; it is never converted.
  currency: string;
  // The currency monetary values are DISPLAYED in — independent of
  // `currency` above. Defaults to the report currency (no conversion).
  // Presentation-layer only: never fed back into any calculation.
  displayCurrency: string;
  // Locally-entered exchange rates, never fetched from a live API. Key is
  // an ISO currency code from SUPPORTED_DISPLAY_CURRENCIES; value is how
  // many units of that currency equal 1 unit of BASE_REPORT_CURRENCY
  // (USD). Absent entries mean "no rate set yet" — display must show a
  // clear "set exchange rate" prompt rather than fabricate a number.
  exchangeRates: Record<string, number>;
  // Which source the ACTIVE campaign-level data comes from — 'MANUAL' (the
  // existing Amazon Campaign CSV/XLSX upload, via reportMeta.campaign/
  // reportRows.campaign) or 'API' (an Amazon Ads API sync, stored
  // separately in AppState.apiCampaignSync so it never overwrites or
  // deletes manually-uploaded data). Defaults to 'MANUAL' so every
  // existing installation's behavior is completely unchanged until a
  // seller explicitly opts into API sync. Only ever affects which
  // campaign-level rows useWorkspace() feeds into the existing,
  // unmodified recommendation engine — never a second data model.
  campaignDataSource: 'API' | 'MANUAL';
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
  displayCurrency: 'USD',
  exchangeRates: {},
  campaignDataSource: 'MANUAL',
};

export const DEFAULT_PRODUCTS: Product[] = [
  { id: 'rose', name: 'Rose', asin: 'B0GZVBBRZP', sku: 'ZAP-ROSE-2026', sellingPrice: 19.99, aliases: ['rose'], campaignAliases: [], adGroupAliases: [] },
  { id: 'coconut', name: 'Coconut', asin: 'B0GZVGXXS2', sku: 'ZAP-COCO-2026', sellingPrice: 19.99, aliases: ['coconut'], campaignAliases: [], adGroupAliases: [] },
  { id: 'mango', name: 'Mango', asin: 'B0GZVP9HRB', sku: 'ZAP-MANGO-2026', sellingPrice: 19.99, aliases: ['mango'], campaignAliases: [], adGroupAliases: [] },
  { id: 'vanilla', name: 'Vanilla', asin: 'B0H28WG6BB', sku: 'ZAP-Vanilla-2026', sellingPrice: 19.99, aliases: ['vanilla'], campaignAliases: [], adGroupAliases: [] },
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
