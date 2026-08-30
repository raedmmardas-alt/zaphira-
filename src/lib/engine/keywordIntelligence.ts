// Helium 10 / Cerebro keyword intelligence engine. Turns deduplicated
// Helium keyword evidence into a practical, safety-guarded PPC campaign
// plan: relevance, Zaphira PPC history, opportunity score, risk, match
// type, bid recommendations, action classification, per-keyword budget, a
// campaign summary, and a build sheet ("blueprint"). Recommendation-only —
// nothing here ever touches Amazon, and every dollar figure is capped by
// the app's existing product-economics guardrail (calculateProductEconomics
// / ProductEconomics.breakEvenAcos), reusing the exact same
// Sellerboard-preferred-then-manual precedence already established in
// state/useDecisionActions.ts, never a new economics formula.
import type {
  EnrichedSearchTerm, EnrichedTarget, Product, ProductEconomics, ProductManualEconomicsInputs, Settings,
} from '../../types';
import { blankManualEconomics } from '../../types';
import type {
  HeliumKeywordAggregate, KeywordAction, KeywordBlueprintRow, KeywordCampaignSummary, KeywordConfidence,
  KeywordIntelligenceResult, KeywordMatchType, KeywordRisk, KeywordZaphiraHistory,
} from '../../types/helium';
import { normalizeKeywordText } from '../aggregate/heliumKeywords';
import { calculateProductEconomics } from './productEconomicsManual';
import { formatCurrency } from './metrics';

// Matches the $0.02 floor already used for existing-target bid changes in
// actionEngine.ts — kept as an independent constant here rather than an
// import, since it's a universal Amazon minimum-bid fact, not shared logic.
const MIN_BID_FLOOR = 0.02;

// A brand-new keyword has no click/order history of its own, so its bid
// ceiling has to assume *some* conversion rate. These bounds are a
// deliberately conservative, clearly-documented modeling assumption — never
// presented as a guarantee — used only when the account's own real evidence
// is too thin to trust.
const CONSERVATIVE_DEFAULT_CVR = 0.05;
const CONSERVATIVE_CVR_CEILING = 0.10;
const MIN_CLICKS_FOR_CVR_EVIDENCE = 30;

// Safety ceiling on how many keywords the Recommended Campaign shortlist can
// ever contain, independent of budget. The account daily PPC budget (see
// selectRecommendedCampaignKeywords) is the binding constraint in practice —
// this just stops an unrealistically long "campaign" even in the rare case
// budget alone wouldn't. An early-stage account's real campaign should be a
// focused shortlist, not every keyword that happens to be buildable.
export const MAX_CAMPAIGN_KEYWORDS = 30;

const GENERIC_RELEVANCE_TERMS = [
  'body butter', 'whipped body butter', 'body butter for women', 'body butter for dry skin',
  'body butter for men', 'natural body butter', 'organic body butter', 'body cream', 'body lotion',
  'moisturizer', 'moisturiser', 'shea butter', 'skin cream', 'hand cream', 'lotion for dry skin',
];

// A small, explicit watchlist of well-known skincare/body-care competitor
// brands. Not exhaustive — a documented heuristic, not a claim of complete
// brand detection.
const KNOWN_COMPETITOR_BRAND_TERMS = [
  'cetaphil', 'eucerin', 'aveeno', 'nivea', 'vaseline', 'jergens', "burt's bees", 'burts bees',
  'shea moisture', 'cerave', 'palmers', "palmer's", 'gold bond', 'aquaphor', 'lubriderm',
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Product relevance
// ---------------------------------------------------------------------------

export interface ProductRelevanceMatch {
  productId: string | null;
  productName: string | null;
  relevanceScore: number; // 0-1
  isGeneric: boolean;
  isAmbiguous: boolean;
}

// Conservative, alias-driven relevance: an exclusive match against exactly
// one product's configured aliases (Settings → Product Mapping) is strong
// relevance; a generic body-care term relevant to multiple variants gets a
// mid score with no single product assigned; anything else (including
// possible competitor-brand terms) gets a low score. Never forces an
// off-scent keyword onto the wrong product.
export function matchProductRelevance(normalizedKeyword: string, products: Product[]): ProductRelevanceMatch {
  const matched = products.filter((p) =>
    p.aliases.some((alias) => {
      const a = alias.trim().toLowerCase();
      return a.length > 0 && new RegExp(`\\b${escapeRegex(a)}\\b`).test(normalizedKeyword);
    }),
  );

  if (matched.length === 1) {
    return { productId: matched[0].id, productName: matched[0].name, relevanceScore: 1, isGeneric: false, isAmbiguous: false };
  }
  if (matched.length > 1) {
    return { productId: matched[0].id, productName: matched[0].name, relevanceScore: 0.5, isGeneric: false, isAmbiguous: true };
  }

  const isGenericTerm = GENERIC_RELEVANCE_TERMS.some((term) => normalizedKeyword.includes(term));
  if (isGenericTerm) {
    return { productId: null, productName: null, relevanceScore: 0.5, isGeneric: true, isAmbiguous: false };
  }

  return { productId: null, productName: null, relevanceScore: 0.1, isGeneric: false, isAmbiguous: false };
}

export function detectCompetitorBrand(normalizedKeyword: string): boolean {
  return KNOWN_COMPETITOR_BRAND_TERMS.some((brand) => normalizedKeyword.includes(brand));
}

// ---------------------------------------------------------------------------
// Zaphira PPC history
// ---------------------------------------------------------------------------

function buildHistoryLabel(h: { clicks: number; spend: number; orders: number; isExistingTarget: boolean; isHistoricalWinner: boolean }): string {
  if (h.isExistingTarget) return `Existing target — ${h.clicks} click${h.clicks === 1 ? '' : 's'} / ${formatCurrency(h.spend)} / ${h.orders} order${h.orders === 1 ? '' : 's'}`;
  if (h.isHistoricalWinner) return `Historical winner — ${h.orders} order${h.orders === 1 ? '' : 's'} / ${formatCurrency(h.spend)}`;
  if (h.orders > 0) return `${h.orders} order${h.orders === 1 ? '' : 's'} / ${formatCurrency(h.spend)} spend`;
  return `Tested — ${h.clicks} click${h.clicks === 1 ? '' : 's'} / ${formatCurrency(h.spend)} / ${h.orders} orders`;
}

// Exact normalized-text matching only — deliberately never fuzzy, so
// loosely related keywords are never incorrectly combined. Target-level
// evidence (what Zaphira actually bid on) takes priority over search-term-
// level evidence (what shoppers typed) when both could apply, so the same
// underlying traffic is never summed twice.
export function findZaphiraHistory(normalizedKeyword: string, targets: EnrichedTarget[], searchTerms: EnrichedSearchTerm[]): KeywordZaphiraHistory {
  const targetMatches = targets.filter((t) => normalizeKeywordText(t.targetingText) === normalizedKeyword);
  if (targetMatches.length > 0) {
    const clicks = targetMatches.reduce((a, t) => a + t.clicks, 0);
    const spend = targetMatches.reduce((a, t) => a + t.spend, 0);
    const orders = targetMatches.reduce((a, t) => a + t.orders, 0);
    const isExistingTarget = targetMatches.some((t) => t.isCurrentPeriod);
    const isHistoricalWinner = orders >= 2 && targetMatches.some((t) => t.acos !== null && t.acos <= 0.45);
    return { label: buildHistoryLabel({ clicks, spend, orders, isExistingTarget, isHistoricalWinner }), clicks, spend, orders, isExistingTarget, isHistoricalWinner };
  }

  const searchTermMatches = searchTerms.filter((s) => normalizeKeywordText(s.searchTerm) === normalizedKeyword);
  if (searchTermMatches.length > 0) {
    const clicks = searchTermMatches.reduce((a, s) => a + s.clicks, 0);
    const spend = searchTermMatches.reduce((a, s) => a + s.spend, 0);
    const orders = searchTermMatches.reduce((a, s) => a + s.orders, 0);
    const isHistoricalWinner = searchTermMatches.some((s) => s.classification === 'HISTORICAL_WINNER');
    return { label: buildHistoryLabel({ clicks, spend, orders, isExistingTarget: false, isHistoricalWinner }), clicks, spend, orders, isExistingTarget: false, isHistoricalWinner };
  }

  return { label: 'Never tested', clicks: 0, spend: 0, orders: 0, isExistingTarget: false, isHistoricalWinner: false };
}

// ---------------------------------------------------------------------------
// Economics guardrail — reuses the app's existing break-even sources
// ---------------------------------------------------------------------------

// Same precedence already established in state/useDecisionActions.ts's
// resolveBreakEven: Sellerboard-derived economics first, manually-entered
// product economics as the fallback. Converts the ACoS-based Sellerboard
// figure to a per-order CPA ceiling using the product's selling price
// (breakEvenCpa = breakEvenAcos × sellingPrice), which is the same
// relationship calculateProductEconomics already uses internally.
export function resolveBreakEvenCpa(
  productId: string | null,
  products: Product[],
  economicsById: Record<string, ProductEconomics>,
  productManualEconomics: Record<string, ProductManualEconomicsInputs>,
): number | null {
  if (!productId) return null;
  const product = products.find((p) => p.id === productId) ?? null;

  const sellerboardAcos = economicsById[productId]?.breakEvenAcos ?? null;
  if (sellerboardAcos !== null && product?.sellingPrice) {
    return sellerboardAcos * product.sellingPrice;
  }

  if (product) {
    const manual = calculateProductEconomics(product, productManualEconomics[productId] ?? blankManualEconomics(productId));
    if (manual.complete && manual.breakEvenCpa !== null) return manual.breakEvenCpa;
  }

  return null;
}

// Assumed conversion rate for brand-new keywords: uses the account's own
// real observed CVR across all current-period targets when there's enough
// evidence to trust it (never inflates the bid ceiling beyond a sane cap),
// otherwise falls back to the conservative default.
export function resolveAssumedCvr(targets: EnrichedTarget[]): number {
  const currentTargets = targets.filter((t) => t.isCurrentPeriod);
  const clicks = currentTargets.reduce((a, t) => a + t.clicks, 0);
  const orders = currentTargets.reduce((a, t) => a + t.orders, 0);
  if (clicks < MIN_CLICKS_FOR_CVR_EVIDENCE) return CONSERVATIVE_DEFAULT_CVR;
  return Math.min(orders / clicks, CONSERVATIVE_CVR_CEILING);
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export function computeKeywordRisk(params: {
  relevanceScore: number;
  isCompetitorBrand: boolean;
  competingProducts: number | null;
  searchVolume: number | null;
  maxSafeBid: number | null;
  heliumSuggestedBid: number | null;
  history: KeywordZaphiraHistory;
  competitorCount: number;
  // Distinct uploaded source files (1-4) this keyword was seen in —
  // independent competitor pulls agreeing on a keyword is corroborating
  // evidence, so it's allowed to reduce risk slightly, the same way strong
  // single-file competitor counts already do.
  sourceCount: number;
}): KeywordRisk {
  let score = 0;
  if (params.relevanceScore < 0.3) score += 3;
  else if (params.relevanceScore < 0.6) score += 1;
  if (params.isCompetitorBrand) score += 2;
  if (params.competingProducts !== null && params.competingProducts > 3000) score += 2;
  else if (params.competingProducts !== null && params.competingProducts > 1000) score += 1;
  if (params.searchVolume !== null && params.searchVolume < 50) score += 1;
  if (params.searchVolume === null) score += 1;
  if (params.maxSafeBid !== null && params.heliumSuggestedBid !== null && params.heliumSuggestedBid > params.maxSafeBid) score += 2;
  if (params.maxSafeBid === null) score += 1;
  if (params.history.spend > 5 && params.history.orders === 0) score += 3;
  if (params.competitorCount === 0) score += 1;
  if (params.competitorCount >= 3) score -= 1;
  if (params.sourceCount >= 2) score -= 1;
  if (params.history.isHistoricalWinner) score -= 2;

  if (score <= 0) return 'LOW';
  if (score <= 2) return 'MEDIUM';
  if (score <= 5) return 'HIGH';
  return 'EXTREME';
}

// ---------------------------------------------------------------------------
// Match type
// ---------------------------------------------------------------------------

// Conservative by design — Broad is never recommended. EXACT only for
// proven or exclusively-relevant, low/medium-risk keywords; PHRASE
// (controlled discovery) for everything else that's still worth testing.
export function recommendMatchType(params: { relevanceScore: number; risk: KeywordRisk; history: KeywordZaphiraHistory }): KeywordMatchType {
  const strongEvidence = params.history.orders > 0 || params.history.isHistoricalWinner;
  const highRelevance = params.relevanceScore >= 0.9;
  const safeRisk = params.risk === 'LOW' || params.risk === 'MEDIUM';
  if ((strongEvidence || highRelevance) && safeRisk) return 'EXACT';
  return 'PHRASE';
}

// ---------------------------------------------------------------------------
// Bid engine
// ---------------------------------------------------------------------------

export function computeMaxSafeBid(breakEvenCpa: number | null, assumedCvr: number): number | null {
  if (breakEvenCpa === null || breakEvenCpa <= 0) return null;
  const bid = breakEvenCpa * assumedCvr;
  return bid > 0 ? Math.max(MIN_BID_FLOOR, round2(bid)) : null;
}

// Recommended bid is always <= Maximum Safe Bid. Helium's suggested bid is
// market intelligence that can only pull the number down, never push it
// above what the app's own product economics say is safe.
export function computeRecommendedBid(params: {
  maxSafeBid: number | null;
  heliumSuggestedBid: number | null;
  risk: KeywordRisk;
  matchType: KeywordMatchType;
  targetAcosCeiling: number | null;
}): number | null {
  if (params.maxSafeBid === null) return null;

  const RISK_FACTOR: Record<KeywordRisk, number> = { LOW: 0.85, MEDIUM: 0.7, HIGH: 0.5, EXTREME: 0.3 };
  const MATCH_TYPE_FACTOR: Record<KeywordMatchType, number> = { EXACT: 1, PHRASE: 0.85 };

  let candidate = params.maxSafeBid * RISK_FACTOR[params.risk] * MATCH_TYPE_FACTOR[params.matchType];
  if (params.targetAcosCeiling !== null) candidate = Math.min(candidate, params.targetAcosCeiling);
  if (params.heliumSuggestedBid !== null && params.heliumSuggestedBid > 0) candidate = Math.min(candidate, params.heliumSuggestedBid);
  candidate = Math.min(candidate, params.maxSafeBid); // hard safety re-assertion

  return Math.max(MIN_BID_FLOOR, round2(candidate));
}

// ---------------------------------------------------------------------------
// Opportunity score
// ---------------------------------------------------------------------------

function volumeScore(searchVolume: number | null): number {
  if (searchVolume === null) return 0.3;
  return clamp(Math.log10(searchVolume + 1) / 4, 0, 1);
}

// sourceCount contributes a smaller, separate slice: the same competitor
// count from one file is decent evidence, but the same keyword confirmed
// across multiple independently-run competitor pulls is stronger — without
// letting cross-source corroboration alone dominate the score.
function competitorEvidenceScore(competitorCount: number, bestOrganicRank: number | null, bestSponsoredRank: number | null, sourceCount: number): number {
  const countScore = clamp(competitorCount / 5, 0, 1);
  const bestRank = bestOrganicRank ?? bestSponsoredRank;
  const rankScore = bestRank === null ? 0.3 : clamp(1 - (bestRank - 1) / 40, 0, 1);
  const sourceCorroborationScore = clamp((sourceCount - 1) / 3, 0, 1);
  return countScore * 0.4 + rankScore * 0.4 + sourceCorroborationScore * 0.2;
}

function competitionPenalty(titleDensity: number | null, competingProducts: number | null): number {
  const titleDensityNorm = titleDensity === null ? 0.4 : clamp(titleDensity / 10, 0, 1);
  const competingProductsNorm = competingProducts === null ? 0.4 : clamp(competingProducts / 3000, 0, 1);
  return (titleDensityNorm + competingProductsNorm) / 2;
}

function historyScore(h: KeywordZaphiraHistory): number {
  if (h.isHistoricalWinner) return 1;
  if (h.orders > 0) return 0.8;
  if (h.isExistingTarget) return 0.5;
  if (h.spend > 5 && h.orders === 0) return 0;
  if (h.clicks > 0) return 0.4;
  return 0.5; // never tested — neutral, unproven but not held against it
}

function economicsHeadroomScore(recommendedBid: number | null, maxSafeBid: number | null): number {
  if (maxSafeBid === null || recommendedBid === null) return 0.3;
  return clamp(1 - recommendedBid / maxSafeBid, 0, 1);
}

export function computeOpportunityScore(params: {
  searchVolume: number | null;
  competitorCount: number;
  sourceCount: number;
  bestOrganicRank: number | null;
  bestSponsoredRank: number | null;
  relevanceScore: number;
  titleDensity: number | null;
  competingProducts: number | null;
  history: KeywordZaphiraHistory;
  recommendedBid: number | null;
  maxSafeBid: number | null;
}): number {
  const raw =
    volumeScore(params.searchVolume) * 0.20 +
    competitorEvidenceScore(params.competitorCount, params.bestOrganicRank, params.bestSponsoredRank, params.sourceCount) * 0.15 +
    params.relevanceScore * 0.25 +
    (1 - competitionPenalty(params.titleDensity, params.competingProducts)) * 0.15 +
    historyScore(params.history) * 0.15 +
    economicsHeadroomScore(params.recommendedBid, params.maxSafeBid) * 0.10;

  return Math.round(clamp(raw, 0, 1) * 100);
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export function computeConfidence(params: {
  hasSearchVolume: boolean;
  competitorCount: number;
  sourceCount: number;
  hasRankData: boolean;
  hasHistoryEvidence: boolean;
  hasEconomics: boolean;
}): KeywordConfidence {
  let points = 0;
  if (params.hasSearchVolume) points++;
  if (params.competitorCount >= 2) points++;
  // Corroboration across independent competitor/source files is extra
  // confidence on top of within-file competitor count — never present with
  // only one file loaded, since sourceCount is then always exactly 1.
  if (params.sourceCount >= 2) points++;
  if (params.hasRankData) points++;
  if (params.hasHistoryEvidence) points++;
  if (params.hasEconomics) points++;
  if (points >= 5) return 'HIGH';
  if (points >= 3) return 'MEDIUM';
  return 'LOW';
}

// ---------------------------------------------------------------------------
// Action classification
// ---------------------------------------------------------------------------

// Duplicate-protection and severe-loss checks always run first, regardless
// of how high the opportunity score is — a good score never overrides an
// active duplicate or a proven historical loss.
export function classifyKeywordAction(params: {
  opportunityScore: number;
  risk: KeywordRisk;
  confidence: KeywordConfidence;
  maxSafeBidAvailable: boolean;
  history: KeywordZaphiraHistory;
}): KeywordAction {
  if (params.history.isExistingTarget) return 'WATCH';
  if (params.history.spend > 10 && params.history.orders === 0) return 'AVOID';
  if (params.risk === 'EXTREME') return 'AVOID';

  if (!params.maxSafeBidAvailable) return params.opportunityScore >= 60 ? 'TEST' : 'WATCH';

  if (params.risk === 'HIGH') return params.opportunityScore >= 70 ? 'TEST' : 'AVOID';

  if (params.opportunityScore >= 70 && (params.risk === 'LOW' || params.risk === 'MEDIUM') && params.confidence !== 'LOW') return 'LAUNCH';
  if (params.opportunityScore >= 45) return 'TEST';
  if (params.opportunityScore >= 25) return 'WATCH';
  return 'AVOID';
}

// ---------------------------------------------------------------------------
// Per-keyword daily budget
// ---------------------------------------------------------------------------

// Only populated for LAUNCH/TEST. Scales with the recommended bid (which
// already reflects risk/opportunity) and the number of clicks needed to
// gather real evidence, is never uniform across keywords, and is always
// capped at a quarter of the account's own daily PPC budget guardrail so no
// single new keyword can dominate the account's spend.
export function computeKeywordDailyBudget(params: {
  action: KeywordAction;
  recommendedBid: number | null;
  maxDailyPpcBudget: number;
}): number | null {
  if (params.action !== 'LAUNCH' && params.action !== 'TEST') return null;
  if (params.recommendedBid === null) return null;

  const testClicks = params.action === 'LAUNCH' ? 15 : 8;
  const confidenceFactor = params.action === 'LAUNCH' ? 1 : 0.6;
  const raw = params.recommendedBid * testClicks * confidenceFactor;
  const accountCeiling = params.maxDailyPpcBudget * 0.25;

  return Math.max(round2(Math.min(raw, accountCeiling)), round2(MIN_BID_FLOOR * 3));
}

// ---------------------------------------------------------------------------
// Explanation
// ---------------------------------------------------------------------------

function relevanceLabel(params: { productName: string | null; isGeneric: boolean; isAmbiguous: boolean; isCompetitorBrand: boolean; relevanceScore: number }): string {
  if (params.isCompetitorBrand) return 'Possible competitor brand term';
  if (params.isAmbiguous) return `Matches multiple products (led by ${params.productName})`;
  if (params.productName) return `Strong ${params.productName} relevance`;
  if (params.isGeneric) return 'Generic term — relevant to multiple products';
  return 'Low relevance — no matching product term found';
}

function capitalizeFirst(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// User-friendly reason a safe bid isn't available yet — shown in place of
// an unexplained "—" wherever practical. Product assignment is checked
// first: a keyword can't get a safe bid from another product's economics
// just because a definite product hasn't been determined yet.
export function computeBidUnavailableReason(params: { isProductDefinite: boolean; productName: string | null; maxSafeBid: number | null }): string | null {
  if (!params.isProductDefinite) return 'Product assignment needed';
  if (params.maxSafeBid === null) return `Confirm ${params.productName} economics to calculate a safe bid`;
  return null;
}

export function buildKeywordExplanation(params: {
  productName: string | null;
  isGeneric: boolean;
  isAmbiguous: boolean;
  isCompetitorBrand: boolean;
  relevanceScore: number;
  searchVolume: number | null;
  competitorCount: number;
  history: KeywordZaphiraHistory;
  recommendedBid: number | null;
  maxSafeBid: number | null;
  matchType: KeywordMatchType;
  bidUnavailableReason: string | null;
}): string {
  const parts: string[] = [relevanceLabel(params)];
  if (params.searchVolume !== null) parts.push(`${params.searchVolume.toLocaleString()} monthly searches`);
  if (params.competitorCount > 0) parts.push(`${params.competitorCount} competitor${params.competitorCount === 1 ? '' : 's'} ranking`);
  parts.push(params.history.label.toLowerCase());
  if (params.recommendedBid !== null && params.maxSafeBid !== null) {
    parts.push(`suggested ${formatCurrency(params.recommendedBid)} ${params.matchType.toLowerCase()} bid stays below the ${formatCurrency(params.maxSafeBid)} safe ceiling`);
  } else if (params.bidUnavailableReason) {
    parts.push(params.bidUnavailableReason.toLowerCase());
  }
  return capitalizeFirst(parts.join('. ')) + '.';
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export interface KeywordIntelligenceContext {
  products: Product[];
  targets: EnrichedTarget[];
  searchTerms: EnrichedSearchTerm[];
  economicsById: Record<string, ProductEconomics>;
  productManualEconomics: Record<string, ProductManualEconomicsInputs>;
  settings: Settings;
}

export function analyzeHeliumKeyword(agg: HeliumKeywordAggregate, ctx: KeywordIntelligenceContext, assumedCvr: number): KeywordIntelligenceResult {
  const relevance = matchProductRelevance(agg.normalizedKeyword, ctx.products);
  // A product is "definite" only when relevance matched exactly one
  // product's aliases. An ambiguous match (multiple products) still carries
  // a "led by X" productId for display/explanation purposes, but must never
  // be used to pull that product's economics — that would be exactly the
  // "arbitrarily assigned" bid the spec forbids for a still-ambiguous
  // keyword. A generic term already has productId === null from
  // matchProductRelevance, so this guard is a no-op for that case.
  const isProductDefinite = relevance.productId !== null && !relevance.isAmbiguous;
  const economicsProductId = isProductDefinite ? relevance.productId : null;
  const isCompetitorBrand = detectCompetitorBrand(agg.normalizedKeyword);
  const history = findZaphiraHistory(agg.normalizedKeyword, ctx.targets, ctx.searchTerms);

  const breakEvenCpa = resolveBreakEvenCpa(economicsProductId, ctx.products, ctx.economicsById, ctx.productManualEconomics);
  const maxSafeBid = computeMaxSafeBid(breakEvenCpa, assumedCvr);

  const risk = computeKeywordRisk({
    relevanceScore: relevance.relevanceScore,
    isCompetitorBrand,
    competingProducts: agg.competingProducts,
    searchVolume: agg.maxSearchVolume,
    maxSafeBid,
    heliumSuggestedBid: agg.suggestedBid,
    history,
    competitorCount: agg.competitorCount,
    sourceCount: agg.sourceCount,
  });

  const matchType = recommendMatchType({ relevanceScore: relevance.relevanceScore, risk, history });

  const product = economicsProductId ? ctx.products.find((p) => p.id === economicsProductId) ?? null : null;
  const targetAcosCeiling = product?.sellingPrice ? product.sellingPrice * ctx.settings.targetAcosDefault * assumedCvr : null;
  const recommendedBid = computeRecommendedBid({ maxSafeBid, heliumSuggestedBid: agg.suggestedBid, risk, matchType, targetAcosCeiling });

  const opportunityScore = computeOpportunityScore({
    searchVolume: agg.maxSearchVolume,
    competitorCount: agg.competitorCount,
    sourceCount: agg.sourceCount,
    bestOrganicRank: agg.bestOrganicRank,
    bestSponsoredRank: agg.bestSponsoredRank,
    relevanceScore: relevance.relevanceScore,
    titleDensity: agg.titleDensity,
    competingProducts: agg.competingProducts,
    history,
    recommendedBid,
    maxSafeBid,
  });

  const confidence = computeConfidence({
    hasSearchVolume: agg.maxSearchVolume !== null,
    competitorCount: agg.competitorCount,
    sourceCount: agg.sourceCount,
    hasRankData: agg.bestOrganicRank !== null || agg.bestSponsoredRank !== null,
    hasHistoryEvidence: history.clicks > 0 || history.orders > 0 || history.isExistingTarget,
    hasEconomics: maxSafeBid !== null,
  });

  const action = classifyKeywordAction({ opportunityScore, risk, confidence, maxSafeBidAvailable: maxSafeBid !== null, history });
  const recommendedDailyBudget = computeKeywordDailyBudget({ action, recommendedBid, maxDailyPpcBudget: ctx.settings.maxDailyPpcBudget });

  const competitorStrengthLabel = agg.competitorCount === 0
    ? 'No competitor data'
    : `${agg.competitorCount} competitor${agg.competitorCount === 1 ? '' : 's'} ranking${agg.sourceCount > 1 ? ` across ${agg.sourceCount} sources` : ''}${agg.bestOrganicRank !== null ? `, best rank #${agg.bestOrganicRank}` : ''}`;

  const bidUnavailableReason = computeBidUnavailableReason({ isProductDefinite, productName: relevance.productName, maxSafeBid });

  const explanation = buildKeywordExplanation({
    productName: relevance.productName,
    isGeneric: relevance.isGeneric,
    isAmbiguous: relevance.isAmbiguous,
    isCompetitorBrand,
    relevanceScore: relevance.relevanceScore,
    searchVolume: agg.maxSearchVolume,
    competitorCount: agg.competitorCount,
    history,
    recommendedBid,
    maxSafeBid,
    matchType,
    bidUnavailableReason,
  });

  return {
    keyword: agg.keyword,
    normalizedKeyword: agg.normalizedKeyword,
    productId: relevance.productId,
    productName: relevance.productName,
    isProductDefinite,
    isGenericRelevance: relevance.isGeneric,
    isCompetitorBrand,
    searchVolume: agg.maxSearchVolume,
    competitorCount: agg.competitorCount,
    sourceCount: agg.sourceCount,
    competitorStrengthLabel,
    zaphiraHistory: history,
    opportunityScore,
    risk,
    confidence,
    recommendedMatchType: matchType,
    recommendedBid,
    maxSafeBid,
    recommendedDailyBudget,
    action,
    bidUnavailableReason,
    explanation,
  };
}

export function analyzeHeliumKeywords(aggregates: HeliumKeywordAggregate[], ctx: KeywordIntelligenceContext): KeywordIntelligenceResult[] {
  const assumedCvr = resolveAssumedCvr(ctx.targets);
  return aggregates.map((agg) => analyzeHeliumKeyword(agg, ctx, assumedCvr));
}

const ACTION_ORDER: Record<KeywordAction, number> = { LAUNCH: 0, TEST: 1, WATCH: 2, AVOID: 3 };

export function sortKeywordResults(results: KeywordIntelligenceResult[]): KeywordIntelligenceResult[] {
  return [...results].sort((a, b) => ACTION_ORDER[a.action] - ACTION_ORDER[b.action] || b.opportunityScore - a.opportunityScore);
}

// A keyword only counts toward "ready to build" (the Recommended Campaign
// summary and the Campaign Blueprint) when EVERY one of these is true:
// LAUNCH/TEST action, a definite (non-ambiguous, non-generic) product, and
// real, non-null bid economics. This is the fix for the "161 keywords /
// $0.00 daily budget" contradiction: previously TEST could be reached
// purely from opportunity score even with no product/economics resolved,
// which inflated the visible keyword count while contributing nothing to
// the budget total. Those keywords still show up in Keyword Opportunities
// (with a clear reason why they aren't buildable yet) — they just never
// count here.
export function isBuildableKeyword(r: KeywordIntelligenceResult): boolean {
  return (
    (r.action === 'LAUNCH' || r.action === 'TEST') &&
    r.isProductDefinite &&
    r.recommendedBid !== null &&
    r.maxSafeBid !== null &&
    r.recommendedDailyBudget !== null
  );
}

const RISK_RANK: Record<KeywordRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, EXTREME: 3 };

// Existing positive Zaphira PPC evidence, ranked strongest first. A keyword
// with proven orders is preferred over one that's merely been clicked, which
// in turn is preferred over one that's never been tested at all.
function historyEvidenceRank(h: KeywordZaphiraHistory): number {
  if (h.isHistoricalWinner) return 3;
  if (h.orders > 0) return 2;
  if (h.clicks > 0) return 1;
  return 0;
}

// Economics headroom: how much room sits between the recommended bid and
// the safe ceiling. A keyword recommended well under its own safe maximum
// is a safer pick than one bidding right up against it.
function economicsHeadroom(r: KeywordIntelligenceResult): number {
  if (r.maxSafeBid === null || r.recommendedBid === null) return 0;
  return r.maxSafeBid - r.recommendedBid;
}

// Ranks buildable candidates for the Recommended Campaign shortlist — never
// used to alter any computed intelligence value, only to decide selection
// order once a keyword already qualifies as buildable. Priority order
// matches the V1 spec: action (LAUNCH before TEST), opportunity score,
// risk, multi-competitor evidence strength, existing positive Zaphira PPC
// evidence, then economics safety margin. Deterministic tiebreak by
// normalized keyword text so selection never depends on array order.
function compareForCampaignSelection(a: KeywordIntelligenceResult, b: KeywordIntelligenceResult): number {
  const actionDiff = ACTION_ORDER[a.action] - ACTION_ORDER[b.action];
  if (actionDiff !== 0) return actionDiff;
  if (a.opportunityScore !== b.opportunityScore) return b.opportunityScore - a.opportunityScore;
  const riskDiff = RISK_RANK[a.risk] - RISK_RANK[b.risk];
  if (riskDiff !== 0) return riskDiff;
  if (a.competitorCount !== b.competitorCount) return b.competitorCount - a.competitorCount;
  if (a.sourceCount !== b.sourceCount) return b.sourceCount - a.sourceCount;
  const historyDiff = historyEvidenceRank(b.zaphiraHistory) - historyEvidenceRank(a.zaphiraHistory);
  if (historyDiff !== 0) return historyDiff;
  const headroomDiff = economicsHeadroom(b) - economicsHeadroom(a);
  if (headroomDiff !== 0) return headroomDiff;
  return a.normalizedKeyword.localeCompare(b.normalizedKeyword);
}

// The Recommended Campaign is a ranked SHORTLIST constrained by the actual
// account daily PPC budget (settings.maxDailyPpcBudget) — never every
// buildable keyword summed together. This is the fix for a real-data
// regression: with a large multi-competitor Helium dataset, 1,000+ keywords
// could independently qualify as buildable, and summing all of their
// individually-valid allocations produced a "recommended" daily budget many
// times the account's actual configured budget (e.g. $4,256.54/day against
// a $16/day account). Each keyword's own recommendedDailyBudget is reused
// unchanged (still capped at a quarter of the account budget by
// computeKeywordDailyBudget) — this function only decides how many of those
// already-safe allocations the account can actually afford at once, ranked
// best-first, greedily taking any candidate that still fits the remaining
// budget (never stopping at the first one that doesn't, since a smaller
// allocation further down the ranking may still fit) up to the
// MAX_CAMPAIGN_KEYWORDS safety ceiling.
export function selectRecommendedCampaignKeywords(
  results: KeywordIntelligenceResult[],
  maxDailyPpcBudget: number,
  maxKeywords: number = MAX_CAMPAIGN_KEYWORDS,
): KeywordIntelligenceResult[] {
  const ranked = results.filter(isBuildableKeyword).sort(compareForCampaignSelection);
  const selected: KeywordIntelligenceResult[] = [];
  let total = 0;
  for (const r of ranked) {
    if (selected.length >= maxKeywords) break;
    const allocation = r.recommendedDailyBudget ?? 0;
    const nextTotal = round2(total + allocation);
    if (nextTotal <= maxDailyPpcBudget) {
      selected.push(r);
      total = nextTotal;
    }
  }
  return selected;
}

export function buildKeywordCampaignSummary(results: KeywordIntelligenceResult[], maxDailyPpcBudget: number): KeywordCampaignSummary {
  const buildableCount = results.filter(isBuildableKeyword).length;
  const selected = selectRecommendedCampaignKeywords(results, maxDailyPpcBudget);
  // Sum of only the selected shortlist's already-guardrailed allocations —
  // never simply totaling every buildable keyword's maximum, and never
  // exceeding the account's own configured daily PPC budget.
  const recommendedDailyBudget = round2(selected.reduce((a, r) => a + (r.recommendedDailyBudget ?? 0), 0));
  return {
    keywordCount: selected.length,
    recommendedDailyBudget,
    estimatedMonthlyBudget: round2(recommendedDailyBudget * 30.4),
    additionalBuildableKeywordsAvailable: Math.max(0, buildableCount - selected.length),
  };
}

export function buildKeywordBlueprint(results: KeywordIntelligenceResult[], maxDailyPpcBudget: number): KeywordBlueprintRow[] {
  return selectRecommendedCampaignKeywords(results, maxDailyPpcBudget).map((r) => ({
    productName: r.productName!,
    campaignName: `ZAP-${r.productName}-KeywordIntel-${r.recommendedMatchType === 'EXACT' ? 'Exact' : 'Phrase'}`,
    keyword: r.keyword,
    matchType: r.recommendedMatchType,
    recommendedBid: r.recommendedBid,
    maxSafeBid: r.maxSafeBid,
    recommendedDailyAllocation: r.recommendedDailyBudget,
    action: r.action,
    reason: r.explanation,
  }));
}
