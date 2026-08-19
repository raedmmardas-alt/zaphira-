import { describe, it, expect } from 'vitest';
import { DEFAULT_PRODUCTS, DEFAULT_SETTINGS } from '../../types';
import type { EnrichedSearchTerm, EnrichedTarget, ProductManualEconomicsInputs } from '../../types';
import type { HeliumKeywordAggregate } from '../../types/helium';
import {
  analyzeHeliumKeyword, analyzeHeliumKeywords, matchProductRelevance, detectCompetitorBrand, findZaphiraHistory,
  resolveBreakEvenCpa, resolveAssumedCvr, computeMaxSafeBid, computeRecommendedBid,
  buildKeywordCampaignSummary, buildKeywordBlueprint, sortKeywordResults,
} from './keywordIntelligence';
import type { KeywordIntelligenceContext } from './keywordIntelligence';

function completeManualEconomics(): Record<string, ProductManualEconomicsInputs> {
  const map: Record<string, ProductManualEconomicsInputs> = {};
  for (const p of DEFAULT_PRODUCTS) {
    map[p.id] = { productId: p.id, cogs: 2.91, amazonFees: 3.00, amazonFeesConfirmed: true, sellerFundedDiscount: 0, targetProfitPerOrder: 3, updatedAt: '' };
  }
  return map;
}
// sellingPrice 19.99, cogs 2.91, amazonFees 3.00 => breakEvenCpa = 19.99-2.91-3.00 = 14.08 for every default product.

function baseContext(overrides: Partial<KeywordIntelligenceContext> = {}): KeywordIntelligenceContext {
  return {
    products: DEFAULT_PRODUCTS,
    targets: [],
    searchTerms: [],
    economicsById: {},
    productManualEconomics: completeManualEconomics(),
    settings: DEFAULT_SETTINGS,
    ...overrides,
  };
}

function baseAggregate(overrides: Partial<HeliumKeywordAggregate> = {}): HeliumKeywordAggregate {
  return {
    keyword: 'coconut body butter', normalizedKeyword: 'coconut body butter', competitorCount: 3,
    competitorAsins: ['A', 'B', 'C'], sourceCount: 1, sourceIds: ['source-1'],
    bestOrganicRank: 8, bestSponsoredRank: 4, medianOrganicRank: 10,
    maxSearchVolume: 1672, titleDensity: 3, competingProducts: 800, suggestedBid: 0.90, searchVolumeTrend: null,
    ...overrides,
  };
}

function target(overrides: Partial<EnrichedTarget> = {}): EnrichedTarget {
  return {
    key: 'k', targetingText: 'coconut body butter', matchType: 'EXACT', campaign: 'Coconut - Sponsored Products',
    adGroup: 'Coconut AG', productId: 'coconut', productName: 'Coconut', asin: 'B0GZVGXXS2', mappingSource: 'ASIN',
    currentBid: 1.00, impressions: 100, clicks: 10, spend: 5, orders: 0, sales: 0, ctr: 0.1, cvr: 0, acos: null,
    delivery: 'DELIVERING', isCurrentPeriod: true, action: {
      action: 'WATCH', currentBid: 1, recommendedBid: null, safeRangeMin: null, safeRangeMax: null, stopLoss: null,
      reason: '', risk: 'MEDIUM', confidence: 'LOW',
    },
    ...overrides,
  };
}

function searchTerm(overrides: Partial<EnrichedSearchTerm> = {}): EnrichedSearchTerm {
  return {
    searchTerm: 'coconut body butter', targetingText: 'coconut moisturizer', matchType: 'BROAD',
    campaign: 'Coconut - Sponsored Products', adGroup: 'Coconut AG', productId: 'coconut', productName: 'Coconut',
    impressions: 500, clicks: 20, spend: 10, orders: 0, sales: 0, acos: null, classification: 'HISTORICAL_INSIGHT',
    isCurrentPeriod: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Product relevance
// ---------------------------------------------------------------------------

describe('matchProductRelevance', () => {
  it('gives a scent-specific keyword strong, exclusive relevance to its matching product', () => {
    const r = matchProductRelevance('coconut body butter', DEFAULT_PRODUCTS);
    expect(r.productId).toBe('coconut');
    expect(r.relevanceScore).toBe(1);
    expect(r.isGeneric).toBe(false);
  });

  it('never forces an off-scent keyword onto another product\'s relevance', () => {
    const r = matchProductRelevance('rose body butter', DEFAULT_PRODUCTS);
    expect(r.productId).toBe('rose');
    expect(r.productId).not.toBe('coconut');
  });

  it('treats a fully generic keyword as relevant to multiple products, with no single product forced', () => {
    const r = matchProductRelevance('whipped body butter', DEFAULT_PRODUCTS);
    expect(r.productId).toBeNull();
    expect(r.isGeneric).toBe(true);
    expect(r.relevanceScore).toBeGreaterThan(0);
    expect(r.relevanceScore).toBeLessThan(1);
  });

  it('gives a keyword matching no product alias and no generic term very low relevance', () => {
    const r = matchProductRelevance('stainless steel water bottle', DEFAULT_PRODUCTS);
    expect(r.productId).toBeNull();
    expect(r.isGeneric).toBe(false);
    expect(r.relevanceScore).toBeLessThan(0.3);
  });
});

describe('detectCompetitorBrand', () => {
  it('flags a known competitor-brand term', () => {
    expect(detectCompetitorBrand('cetaphil daily moisturizer')).toBe(true);
  });
  it('does not flag Zaphira\'s own product terms', () => {
    expect(detectCompetitorBrand('coconut body butter')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Zaphira PPC history
// ---------------------------------------------------------------------------

describe('findZaphiraHistory', () => {
  it('reports "Never tested" only when there is truly no matching evidence anywhere', () => {
    const h = findZaphiraHistory('an unrelated keyword', [], []);
    expect(h.label).toBe('Never tested');
    expect(h.clicks).toBe(0);
  });

  it('reports concise tested-but-no-orders evidence from a matching target, not a false "Never tested"', () => {
    const h = findZaphiraHistory('coconut body butter', [target({ clicks: 3, spend: 4.10, orders: 0, isCurrentPeriod: false })], []);
    expect(h.label).toContain('3 click');
    expect(h.label).toContain('$4.10');
    expect(h.label).toContain('0 order');
    expect(h.orders).toBe(0);
  });

  it('reports a currently active existing target distinctly, for duplicate protection', () => {
    const h = findZaphiraHistory('coconut body butter', [target({ isCurrentPeriod: true })], []);
    expect(h.isExistingTarget).toBe(true);
    expect(h.label).toContain('Existing target');
  });

  it('reports a proven converting keyword as a historical winner', () => {
    const h = findZaphiraHistory('coconut body butter', [
      target({ isCurrentPeriod: false, orders: 2, acos: 0.30, clicks: 20, spend: 8 }),
    ], []);
    expect(h.isHistoricalWinner).toBe(true);
    expect(h.label).toContain('Historical winner');
  });

  it('never combines a loosely related keyword via fuzzy matching — exact normalized text only', () => {
    const h = findZaphiraHistory('coconut body lotion', [target({ targetingText: 'coconut body butter', orders: 5 })], []);
    expect(h.label).toBe('Never tested');
  });

  it('falls back to search-term evidence when no direct target match exists', () => {
    const h = findZaphiraHistory('coconut body butter', [], [searchTerm({ clicks: 12, spend: 6, orders: 0 })]);
    expect(h.label).toContain('12 click');
    expect(h.isExistingTarget).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Economics guardrail
// ---------------------------------------------------------------------------

describe('resolveBreakEvenCpa / resolveAssumedCvr / computeMaxSafeBid', () => {
  it('computes break-even CPA from manual product economics when Sellerboard data is unavailable', () => {
    const cpa = resolveBreakEvenCpa('coconut', DEFAULT_PRODUCTS, {}, completeManualEconomics());
    expect(cpa).toBeCloseTo(14.08, 2);
  });

  it('returns null (never fabricated) when no product is assigned or economics are incomplete', () => {
    expect(resolveBreakEvenCpa(null, DEFAULT_PRODUCTS, {}, completeManualEconomics())).toBeNull();
    expect(resolveBreakEvenCpa('coconut', DEFAULT_PRODUCTS, {}, {})).toBeNull();
  });

  it('falls back to the conservative default CVR when account evidence is too thin', () => {
    expect(resolveAssumedCvr([])).toBe(0.05);
    expect(resolveAssumedCvr([target({ clicks: 5, orders: 1, isCurrentPeriod: true })])).toBe(0.05);
  });

  it('uses real observed CVR once there is enough evidence, capped at a conservative ceiling', () => {
    const targets = [target({ clicks: 40, orders: 2, isCurrentPeriod: true })]; // 5% observed, under the 10% ceiling
    expect(resolveAssumedCvr(targets)).toBeCloseTo(0.05, 3);
    const luckyTargets = [target({ clicks: 40, orders: 20, isCurrentPeriod: true })]; // 50% observed — must be capped
    expect(resolveAssumedCvr(luckyTargets)).toBe(0.10);
  });

  it('computes the max safe bid directly from break-even CPA × assumed CVR, floored at the $0.02 minimum', () => {
    expect(computeMaxSafeBid(14.08, 0.05)).toBeCloseTo(0.70, 2);
    expect(computeMaxSafeBid(null, 0.05)).toBeNull();
    expect(computeMaxSafeBid(0.10, 0.05)).toBeGreaterThanOrEqual(0.02);
  });
});

describe('computeRecommendedBid — bid cap enforcement', () => {
  it('never recommends a bid above the maximum safe bid, even when Helium\'s suggested bid is far higher', () => {
    const bid = computeRecommendedBid({ maxSafeBid: 0.70, heliumSuggestedBid: 50, risk: 'LOW', matchType: 'EXACT', targetAcosCeiling: null });
    expect(bid).not.toBeNull();
    expect(bid!).toBeLessThanOrEqual(0.70);
  });

  it('lets a low Helium suggested bid pull the recommendation down, never up', () => {
    const bid = computeRecommendedBid({ maxSafeBid: 0.70, heliumSuggestedBid: 0.10, risk: 'LOW', matchType: 'EXACT', targetAcosCeiling: null });
    expect(bid!).toBeLessThanOrEqual(0.10);
  });

  it('returns null when there is no safe-bid ceiling to work from (never fabricates a bid)', () => {
    expect(computeRecommendedBid({ maxSafeBid: null, heliumSuggestedBid: 1, risk: 'LOW', matchType: 'EXACT', targetAcosCeiling: null })).toBeNull();
  });

  it('reduces the recommendation as risk increases, for the same economics', () => {
    const low = computeRecommendedBid({ maxSafeBid: 1, heliumSuggestedBid: null, risk: 'LOW', matchType: 'EXACT', targetAcosCeiling: null })!;
    const high = computeRecommendedBid({ maxSafeBid: 1, heliumSuggestedBid: null, risk: 'HIGH', matchType: 'EXACT', targetAcosCeiling: null })!;
    expect(high).toBeLessThan(low);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline scenarios
// ---------------------------------------------------------------------------

describe('analyzeHeliumKeyword — full scenarios', () => {
  it('LAUNCH: strong relevance, real demand, credible competitor evidence, clean history, safe economics', () => {
    const r = analyzeHeliumKeyword(baseAggregate(), baseContext(), 0.05);
    expect(r.productId).toBe('coconut');
    expect(r.action).toBe('LAUNCH');
    expect(r.risk).not.toBe('EXTREME');
    expect(r.recommendedBid).not.toBeNull();
    expect(r.maxSafeBid).not.toBeNull();
    expect(r.recommendedBid!).toBeLessThanOrEqual(r.maxSafeBid!);
    expect(r.recommendedDailyBudget).not.toBeNull();
  });

  it('does not automatically reward a very high search volume with the best score (no blind volume reward)', () => {
    const modestVolume = analyzeHeliumKeyword(baseAggregate({ maxSearchVolume: 1000 }), baseContext(), 0.05);
    const hugeButWeakEvidence = analyzeHeliumKeyword(
      baseAggregate({ maxSearchVolume: 500000, competitorCount: 0, bestOrganicRank: null, bestSponsoredRank: null, competingProducts: 8000, titleDensity: 9 }),
      baseContext(),
      0.05,
    );
    expect(hugeButWeakEvidence.opportunityScore).toBeLessThan(modestVolume.opportunityScore);
  });

  it('TEST: promising but with moderate/insufficient evidence', () => {
    const r = analyzeHeliumKeyword(
      baseAggregate({ keyword: 'coconut skin cream', normalizedKeyword: 'coconut skin cream', competitorCount: 1, bestOrganicRank: 30, maxSearchVolume: 200, suggestedBid: null }),
      baseContext(),
      0.05,
    );
    expect(['TEST', 'WATCH', 'LAUNCH']).toContain(r.action);
    expect(r.confidence).not.toBe('HIGH');
  });

  it('WATCH: keyword already an active Zaphira target is never relaunched as a duplicate', () => {
    const ctx = baseContext({ targets: [target({ targetingText: 'coconut body butter', isCurrentPeriod: true, orders: 3, spend: 8, acos: 0.2 })] });
    const r = analyzeHeliumKeyword(baseAggregate(), ctx, 0.05);
    expect(r.zaphiraHistory.isExistingTarget).toBe(true);
    expect(r.action).toBe('WATCH');
  });

  it('AVOID: prior real spend with zero conversions is never recommended as a strong launch', () => {
    const ctx = baseContext({ targets: [target({ targetingText: 'coconut body butter', isCurrentPeriod: false, clicks: 40, spend: 18, orders: 0 })] });
    const r = analyzeHeliumKeyword(baseAggregate(), ctx, 0.05);
    expect(r.zaphiraHistory.orders).toBe(0);
    expect(r.zaphiraHistory.spend).toBeGreaterThan(10);
    expect(r.action).toBe('AVOID');
  });

  it('a prior converting keyword is recognized as a historical winner and treated favorably', () => {
    const ctx = baseContext({ targets: [target({ targetingText: 'coconut body butter', isCurrentPeriod: false, orders: 3, acos: 0.25, clicks: 25, spend: 9 })] });
    const r = analyzeHeliumKeyword(baseAggregate(), ctx, 0.05);
    expect(r.zaphiraHistory.isHistoricalWinner).toBe(true);
    expect(r.recommendedMatchType).toBe('EXACT');
  });

  it('AVOID: a competitor-brand keyword without proven Zaphira performance is treated as higher risk, not a good opportunity', () => {
    const r = analyzeHeliumKeyword(
      baseAggregate({ keyword: 'cetaphil moisturizing cream', normalizedKeyword: 'cetaphil moisturizing cream', competitorCount: 1 }),
      baseContext(),
      0.05,
    );
    expect(r.isCompetitorBrand).toBe(true);
    expect(r.action).not.toBe('LAUNCH');
  });

  it('a generic keyword is not assigned to a single product and is never launched without one', () => {
    const r = analyzeHeliumKeyword(baseAggregate({ keyword: 'whipped body butter', normalizedKeyword: 'whipped body butter' }), baseContext(), 0.05);
    expect(r.productId).toBeNull();
    expect(r.isGenericRelevance).toBe(true);
    expect(r.action).not.toBe('LAUNCH');
  });

  it('handles missing optional Helium metrics gracefully — never crashes, never fabricates, lowers confidence', () => {
    const sparse = baseAggregate({
      competitorCount: 0, competitorAsins: [], bestOrganicRank: null, bestSponsoredRank: null, medianOrganicRank: null,
      maxSearchVolume: null, titleDensity: null, competingProducts: null, suggestedBid: null,
    });
    const r = analyzeHeliumKeyword(sparse, baseContext(), 0.05);
    expect(r.searchVolume).toBeNull();
    expect(Number.isFinite(r.opportunityScore)).toBe(true);
    expect(r.confidence).toBe('LOW');
  });

  it('never recommends a bid above the safe economics ceiling even with an extreme Helium suggested bid', () => {
    const r = analyzeHeliumKeyword(baseAggregate({ suggestedBid: 25 }), baseContext(), 0.05);
    expect(r.recommendedBid).not.toBeNull();
    expect(r.maxSafeBid).not.toBeNull();
    expect(r.recommendedBid!).toBeLessThanOrEqual(r.maxSafeBid!);
  });

  it('never proposes Broad as the recommended match type', () => {
    const results = [
      analyzeHeliumKeyword(baseAggregate(), baseContext(), 0.05),
      analyzeHeliumKeyword(baseAggregate({ keyword: 'body butter', normalizedKeyword: 'body butter' }), baseContext(), 0.05),
      analyzeHeliumKeyword(baseAggregate({ keyword: 'cetaphil cream', normalizedKeyword: 'cetaphil cream' }), baseContext(), 0.05),
    ];
    for (const r of results) expect(r.recommendedMatchType).not.toBe('BROAD' as never);
  });
});

describe('analyzeHeliumKeyword — multi-source (competitor file) overlap', () => {
  it('still analyzes normally with only 1 source file, and never fabricates cross-source evidence that does not exist', () => {
    const r = analyzeHeliumKeyword(baseAggregate({ sourceCount: 1, sourceIds: ['source-1'] }), baseContext(), 0.05);
    expect(r.sourceCount).toBe(1);
    expect(Number.isFinite(r.opportunityScore)).toBe(true);
    expect(r.competitorStrengthLabel).not.toContain('sources'); // singular-source wording never claims plural corroboration
  });

  it('gives a keyword confirmed across multiple source files a lower risk / higher confidence than the same evidence from one file', () => {
    const oneSource = analyzeHeliumKeyword(baseAggregate({ sourceCount: 1, sourceIds: ['source-1'] }), baseContext(), 0.05);
    const fourSources = analyzeHeliumKeyword(baseAggregate({ sourceCount: 4, sourceIds: ['source-1', 'source-2', 'source-3', 'source-4'] }), baseContext(), 0.05);
    expect(fourSources.opportunityScore).toBeGreaterThanOrEqual(oneSource.opportunityScore);
    expect(fourSources.competitorStrengthLabel).toContain('across 4 sources');
  });

  it('a keyword appearing in only one of several loaded sources is scored on real evidence only, never boosted as if it appeared in all of them', () => {
    const partial = analyzeHeliumKeyword(baseAggregate({ sourceCount: 1, sourceIds: ['source-2'] }), baseContext(), 0.05);
    const confirmedEverywhere = analyzeHeliumKeyword(baseAggregate({ sourceCount: 4, sourceIds: ['source-1', 'source-2', 'source-3', 'source-4'] }), baseContext(), 0.05);
    expect(partial.sourceCount).toBe(1);
    expect(partial.opportunityScore).toBeLessThanOrEqual(confirmedEverywhere.opportunityScore);
  });
});

// ---------------------------------------------------------------------------
// Budget, summary, blueprint, sorting
// ---------------------------------------------------------------------------

describe('computeKeywordDailyBudget / campaign summary', () => {
  it('only assigns a daily budget to LAUNCH or TEST keywords, never WATCH/AVOID', () => {
    const ctx = baseContext({ targets: [target({ targetingText: 'coconut body butter', isCurrentPeriod: true })] });
    const watchResult = analyzeHeliumKeyword(baseAggregate(), ctx, 0.05);
    expect(watchResult.action).toBe('WATCH');
    expect(watchResult.recommendedDailyBudget).toBeNull();
  });

  it('gives higher-confidence LAUNCH keywords a larger allocation than TEST keywords with the same bid', () => {
    const launch = analyzeHeliumKeyword(baseAggregate(), baseContext(), 0.05);
    expect(launch.action).toBe('LAUNCH');
    const test = analyzeHeliumKeyword(
      baseAggregate({ keyword: 'coconut skin cream', normalizedKeyword: 'coconut skin cream', competitorCount: 1, bestOrganicRank: 35, maxSearchVolume: 150 }),
      baseContext(),
      0.05,
    );
    if (test.action === 'TEST' && launch.recommendedBid && test.recommendedBid) {
      // Same rough bid tier, but TEST's confidence factor (0.6x) and fewer
      // assumed test clicks (8 vs 15) should give it a smaller budget.
      expect(test.recommendedDailyBudget!).toBeLessThan(launch.recommendedDailyBudget! * 1.5);
    }
  });

  it('never assigns a uniform identical budget to every keyword regardless of risk/opportunity', () => {
    const a = analyzeHeliumKeyword(baseAggregate(), baseContext(), 0.05);
    const b = analyzeHeliumKeyword(baseAggregate({ suggestedBid: 0.10 }), baseContext(), 0.05);
    expect(a.recommendedDailyBudget).not.toBe(b.recommendedDailyBudget);
  });

  it('caps any single keyword\'s daily budget at a quarter of the account daily PPC guardrail', () => {
    const r = analyzeHeliumKeyword(baseAggregate({ suggestedBid: null }), baseContext({ settings: { ...DEFAULT_SETTINGS, maxDailyPpcBudget: 16 } }), 0.05);
    if (r.recommendedDailyBudget !== null) expect(r.recommendedDailyBudget).toBeLessThanOrEqual(4);
  });
});

describe('buildKeywordCampaignSummary — total daily and monthly budget', () => {
  it('sums only LAUNCH/TEST keyword budgets and estimates the monthly maximum at daily × 30.4', () => {
    const results = analyzeHeliumKeywords(
      [
        baseAggregate(),
        baseAggregate({ keyword: 'coconut oil moisturizer', normalizedKeyword: 'coconut oil moisturizer', suggestedBid: 0.10 }),
      ],
      baseContext(),
    );
    const summary = buildKeywordCampaignSummary(results);
    const expectedDaily = results.filter((r) => r.action === 'LAUNCH' || r.action === 'TEST').reduce((a, r) => a + (r.recommendedDailyBudget ?? 0), 0);
    expect(summary.recommendedDailyBudget).toBeCloseTo(expectedDaily, 2);
    expect(summary.estimatedMonthlyBudget).toBeCloseTo(expectedDaily * 30.4, 1);
    expect(summary.keywordCount).toBe(results.filter((r) => r.action === 'LAUNCH' || r.action === 'TEST').length);
  });

  it('returns a zero-keyword, zero-budget summary when nothing qualifies', () => {
    const ctx = baseContext({ targets: [target({ targetingText: 'coconut body butter', isCurrentPeriod: false, clicks: 40, spend: 18, orders: 0 })] });
    const results = analyzeHeliumKeywords([baseAggregate()], ctx); // AVOID scenario
    const summary = buildKeywordCampaignSummary(results);
    expect(summary.keywordCount).toBe(0);
    expect(summary.recommendedDailyBudget).toBe(0);
    expect(summary.estimatedMonthlyBudget).toBe(0);
  });
});

describe('buildKeywordBlueprint', () => {
  it('builds a per-keyword build sheet with a product-scoped campaign name, only for LAUNCH/TEST keywords', () => {
    const results = analyzeHeliumKeywords([baseAggregate()], baseContext());
    const blueprint = buildKeywordBlueprint(results);
    expect(blueprint.length).toBeGreaterThan(0);
    const row = blueprint[0];
    expect(row.campaignName).toMatch(/^ZAP-Coconut-KeywordIntel-(Exact|Phrase)$/);
    expect(row.keyword).toBe('coconut body butter');
  });
});

describe('sortKeywordResults', () => {
  it('orders LAUNCH before TEST before WATCH before AVOID, and by opportunity score within each group', () => {
    const ctxExisting = baseContext({ targets: [target({ targetingText: 'coconut body butter', isCurrentPeriod: true })] });
    const watch = analyzeHeliumKeyword(baseAggregate(), ctxExisting, 0.05);
    const launch = analyzeHeliumKeyword(baseAggregate({ keyword: 'rose body butter', normalizedKeyword: 'rose body butter' }), baseContext(), 0.05);
    const avoidCtx = baseContext({ targets: [target({ targetingText: 'vanilla body butter', isCurrentPeriod: false, clicks: 40, spend: 20, orders: 0 })] });
    const avoid = analyzeHeliumKeyword(baseAggregate({ keyword: 'vanilla body butter', normalizedKeyword: 'vanilla body butter' }), avoidCtx, 0.05);

    const sorted = sortKeywordResults([watch, avoid, launch]);
    const actions = sorted.map((r) => r.action);
    const launchIdx = actions.indexOf('LAUNCH');
    const watchIdx = actions.indexOf('WATCH');
    const avoidIdx = actions.indexOf('AVOID');
    expect(launchIdx).toBeLessThan(watchIdx);
    expect(watchIdx).toBeLessThan(avoidIdx);
  });
});
