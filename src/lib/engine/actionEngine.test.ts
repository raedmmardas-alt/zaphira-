import { describe, it, expect } from 'vitest';
import { deriveCampaignDecisionAction, deriveTargetDecisionAction, findSearchTermNegativeCandidates } from './actionEngine';
import { computeRisk } from './riskEngine';
import { DEFAULT_SETTINGS } from '../../types';
import type { EnrichedCampaign, EnrichedSearchTerm, EnrichedTarget, RiskBreakdown, TargetAction } from '../../types';

function riskFor(overrides: Parameters<typeof computeRisk>[0] extends infer T ? Partial<T> : never = {}): RiskBreakdown {
  return computeRisk({
    clicks: 20, orders: 0, spend: 5, acos: null, delivery: 'DELIVERING', mappingConfident: true,
    productEconomics: null, manualEconomics: null, settings: DEFAULT_SETTINGS,
    ...overrides,
  } as Parameters<typeof computeRisk>[0]);
}

function baseAction(overrides: Partial<TargetAction> = {}): TargetAction {
  return { action: 'KEEP', currentBid: 0.5, recommendedBid: 0.5, safeRangeMin: null, safeRangeMax: null, stopLoss: null, reason: 'base reason', risk: 'LOW', confidence: 'MEDIUM', ...overrides };
}

function target(overrides: Partial<EnrichedTarget> = {}): EnrichedTarget {
  return {
    key: 'c|ag|kw|exact', targetingText: 'kw', matchType: 'exact', campaign: 'c', adGroup: 'ag',
    productId: 'rose', productName: 'Rose', asin: 'A', mappingSource: 'ASIN', currentBid: 0.5,
    impressions: 100, clicks: 20, spend: 5, orders: 0, sales: 0, ctr: 0.2, cvr: null, acos: null,
    delivery: 'DELIVERING', isCurrentPeriod: true, action: baseAction(),
    ...overrides,
  };
}

describe('deriveTargetDecisionAction', () => {
  it('maps WAIT and PRODUCT_MAPPING_REQUIRED to HOLD_COLLECT_DATA', () => {
    const t1 = target({ action: baseAction({ action: 'WAIT' }) });
    expect(deriveTargetDecisionAction(t1, riskFor(), null, DEFAULT_SETTINGS).action).toBe('HOLD_COLLECT_DATA');
    const t2 = target({ action: baseAction({ action: 'PRODUCT_MAPPING_REQUIRED' }) });
    expect(deriveTargetDecisionAction(t2, riskFor(), null, DEFAULT_SETTINGS).action).toBe('HOLD_COLLECT_DATA');
  });

  it('maps WATCH to its own distinct WATCH action, not KEEP — this is active monitoring, not "all fine"', () => {
    const t = target({ action: baseAction({ action: 'WATCH' }) });
    expect(deriveTargetDecisionAction(t, riskFor(), null, DEFAULT_SETTINGS).action).toBe('WATCH');
  });

  it('maps NEGATIVE_PAUSE_CANDIDATE to PAUSE with no recommended bid', () => {
    const t = target({ action: baseAction({ action: 'NEGATIVE_PAUSE_CANDIDATE', risk: 'HIGH' }) });
    const d = deriveTargetDecisionAction(t, riskFor(), null, DEFAULT_SETTINGS);
    expect(d.action).toBe('PAUSE');
    expect(d.recommendedBid).toBeNull();
  });

  it('promotes a broad-match SCALE to TEST_IN_PHRASE', () => {
    const t = target({ matchType: 'broad', orders: 3, acos: 0.1, action: baseAction({ action: 'SCALE', recommendedBid: 0.55 }) });
    expect(deriveTargetDecisionAction(t, riskFor(), 0.5, DEFAULT_SETTINGS).action).toBe('TEST_IN_PHRASE');
  });

  it('promotes a strong phrase-match SCALE to MOVE_TO_EXACT', () => {
    const t = target({ matchType: 'phrase', orders: 3, acos: 0.1, action: baseAction({ action: 'SCALE', recommendedBid: 0.55 }) });
    // breakEven 0.5, acos 0.1 <= 0.5*0.6=0.3 -> MOVE_TO_EXACT
    expect(deriveTargetDecisionAction(t, riskFor(), 0.5, DEFAULT_SETTINGS).action).toBe('MOVE_TO_EXACT');
  });

  it('keeps a weaker phrase-match SCALE as plain SCALE (not promoted to exact)', () => {
    const t = target({ matchType: 'phrase', orders: 3, acos: 0.45, action: baseAction({ action: 'SCALE', recommendedBid: 0.55 }) });
    // breakEven 0.5, acos 0.45 > 0.3 threshold -> stays SCALE
    expect(deriveTargetDecisionAction(t, riskFor(), 0.5, DEFAULT_SETTINGS).action).toBe('SCALE');
  });

  it('keeps an exact-match SCALE as plain SCALE', () => {
    const t = target({ matchType: 'exact', orders: 3, acos: 0.1, action: baseAction({ action: 'SCALE', recommendedBid: 0.55 }) });
    expect(deriveTargetDecisionAction(t, riskFor(), 0.5, DEFAULT_SETTINGS).action).toBe('SCALE');
  });

  it('upgrades a single strong-ACoS order from KEEP to a conservative INCREASE_BID, bounded by settings', () => {
    const t = target({ orders: 1, acos: 0.1, currentBid: 1.0, action: baseAction({ action: 'KEEP' }) });
    const d = deriveTargetDecisionAction(t, riskFor(), 0.5, DEFAULT_SETTINGS);
    expect(d.action).toBe('INCREASE_BID');
    expect(d.recommendedBid).toBeGreaterThan(1.0);
    expect(d.recommendedBid!).toBeLessThanOrEqual(1.0 * (1 + DEFAULT_SETTINGS.maxBidIncreasePct));
  });

  it('does not upgrade KEEP to INCREASE_BID without break-even data (never guesses)', () => {
    const t = target({ orders: 1, acos: 0.1, currentBid: 1.0, action: baseAction({ action: 'KEEP' }) });
    const d = deriveTargetDecisionAction(t, riskFor(), null, DEFAULT_SETTINGS);
    expect(d.action).toBe('KEEP');
  });

  it('computes a positive estimatedImpact for growth actions and a negative one for risk-reduction actions', () => {
    const scaleTarget = target({ matchType: 'exact', orders: 3, sales: 100, acos: 0.1, action: baseAction({ action: 'SCALE' }) });
    const scaleDecision = deriveTargetDecisionAction(scaleTarget, riskFor(), 0.5, DEFAULT_SETTINGS);
    expect(scaleDecision.estimatedImpact).toBeGreaterThan(0);

    const reduceTarget = target({ spend: 20, action: baseAction({ action: 'REDUCE_BID' }) });
    const reduceDecision = deriveTargetDecisionAction(reduceTarget, riskFor({ spend: 20 }), 0.5, DEFAULT_SETTINGS);
    expect(reduceDecision.estimatedImpact).toBeLessThan(0);
  });

  describe('early-stage evidence fields', () => {
    it('reports conversionEvidence as NONE/WEAK/MODERATE/STRONG based purely on clicks and orders', () => {
      expect(deriveTargetDecisionAction(target({ clicks: 2, orders: 0, action: baseAction({ action: 'WAIT' }) }), riskFor(), null, DEFAULT_SETTINGS).conversionEvidence).toBe('NONE');
      expect(deriveTargetDecisionAction(target({ clicks: 10, orders: 0, action: baseAction({ action: 'WATCH' }) }), riskFor(), null, DEFAULT_SETTINGS).conversionEvidence).toBe('WEAK');
      expect(deriveTargetDecisionAction(target({ clicks: 10, orders: 1 }), riskFor(), null, DEFAULT_SETTINGS).conversionEvidence).toBe('MODERATE');
      expect(deriveTargetDecisionAction(target({ clicks: 10, orders: 2, acos: 0.1, action: baseAction({ action: 'SCALE' }) }), riskFor(), 0.5, DEFAULT_SETTINGS).conversionEvidence).toBe('STRONG');
    });

    it('gives a "collect N more clicks" checkpoint for WAIT, never requiring 2 purchases just to say something useful', () => {
      const d = deriveTargetDecisionAction(target({ clicks: 3, action: baseAction({ action: 'WAIT' }) }), riskFor({ clicks: 3 }), null, DEFAULT_SETTINGS);
      expect(d.action).toBe('HOLD_COLLECT_DATA');
      expect(d.checkpointLabel).toMatch(/COLLECT 2 MORE CLICK/);
    });

    it('flags NO_DELIVERY as a traffic issue, never a performance judgment, and does not suggest pausing', () => {
      const d = deriveTargetDecisionAction(
        target({ clicks: 0, impressions: 0, delivery: 'NO_DELIVERY', action: baseAction({ action: 'WAIT' }) }),
        riskFor({ clicks: 0, delivery: 'NO_DELIVERY' }), null, DEFAULT_SETTINGS,
      );
      expect(d.checkpointLabel).toBe('NO TRAFFIC — CONSIDER BID INCREASE');
      expect(d.action).not.toBe('PAUSE');
    });

    it('flags LOW_DELIVERY with an explicit "do not pause" reassurance', () => {
      const d = deriveTargetDecisionAction(
        target({ clicks: 0, impressions: 5, delivery: 'LOW_DELIVERY', action: baseAction({ action: 'WAIT' }) }),
        riskFor({ clicks: 0, delivery: 'LOW_DELIVERY' }), null, DEFAULT_SETTINGS,
      );
      expect(d.checkpointLabel).toBe('LOW DELIVERY — DO NOT PAUSE');
      expect(d.action).not.toBe('PAUSE');
    });

    it('computes remainingTestAllowance as maxTestingSpend minus current spend, floored at 0', () => {
      const risk = riskFor({ spend: 5 });
      const d = deriveTargetDecisionAction(target({ spend: 5 }), risk, null, DEFAULT_SETTINGS);
      expect(d.remainingTestAllowance).toBeCloseTo(Math.max(0, risk.maxTestingSpend - 5));
      expect(d.remainingTestAllowance).toBeGreaterThanOrEqual(0);
    });

    it('never reports PAUSE purely from zero conversions — pausing still requires the base engine\'s real evidence bar', () => {
      // 0 orders, moderate spend, well under the base engine's pause bar (needs clicks >= 20 AND spend > 20).
      const d = deriveTargetDecisionAction(target({ clicks: 10, spend: 11.97, orders: 0, action: baseAction({ action: 'WATCH' }) }), riskFor({ clicks: 10, spend: 11.97 }), null, DEFAULT_SETTINGS);
      expect(d.action).not.toBe('PAUSE');
    });

    it('surfaces targetCpa and breakEvenCpa from confirmed manual economics, and leaves them null when economics are incomplete', () => {
      const manualEcon = { productId: 'rose', complete: true as const, missingFields: [], contributionBeforeAdvertising: 11.99, breakEvenCpa: 11.99, breakEvenAcos: 0.6, maxCpaForTargetProfit: 6.99, targetAcos: 0.35 };
      const withEcon = deriveTargetDecisionAction(target({}), riskFor(), null, DEFAULT_SETTINGS, manualEcon);
      expect(withEcon.targetCpa).toBe(6.99);
      expect(withEcon.breakEvenCpa).toBe(11.99);

      const withoutEcon = deriveTargetDecisionAction(target({}), riskFor(), null, DEFAULT_SETTINGS, null);
      expect(withoutEcon.targetCpa).toBeNull();
      expect(withoutEcon.breakEvenCpa).toBeNull();
    });
  });
});

describe('deriveCampaignDecisionAction', () => {
  function campaign(overrides: Partial<EnrichedCampaign> = {}): EnrichedCampaign {
    return {
      campaign: 'Rose - Sponsored Products', productId: 'rose', productName: 'Rose', statusConfidence: 'CURRENT_ACTIVITY_CONFIRMED',
      impressions: 1000, clicks: 40, spend: 18, orders: 2, sales: 60, acos: 0.3, ctr: null, cpc: null, cvr: null,
      budget: 20, recommendation: '', risk: 'LOW', confidence: 'MEDIUM', isCurrentPeriod: true,
      ...overrides,
    };
  }

  it('recommends INCREASE_BUDGET when spend is near budget cap and efficient', () => {
    const c = campaign({ spend: 19, budget: 20, acos: 0.2 });
    const d = deriveCampaignDecisionAction(c, riskFor(), 0.5);
    expect(d.action).toBe('INCREASE_BUDGET');
    expect(d.recommendedBudget).toBeGreaterThan(20);
  });

  it('recommends REDUCE_BUDGET when spend is near budget cap and inefficient', () => {
    const c = campaign({ spend: 19, budget: 20, acos: 0.9 });
    const d = deriveCampaignDecisionAction(c, riskFor(), 0.5);
    expect(d.action).toBe('REDUCE_BUDGET');
    expect(d.recommendedBudget).toBeLessThan(20);
  });

  it('recommends HOLD_COLLECT_DATA when there is spend but no ad sales yet', () => {
    const c = campaign({ spend: 5, budget: 20, acos: null, sales: 0 });
    expect(deriveCampaignDecisionAction(c, riskFor(), 0.5).action).toBe('HOLD_COLLECT_DATA');
  });

  it('keeps efficient, non-capped campaigns at KEEP without touching budget', () => {
    const c = campaign({ spend: 5, budget: 20, acos: 0.1 });
    const d = deriveCampaignDecisionAction(c, riskFor(), 0.5);
    expect(d.action).toBe('KEEP');
    expect(d.recommendedBudget).toBeNull();
  });

  it('never recommends a budget action without a known budget or break-even', () => {
    const c = campaign({ spend: 5, budget: null, acos: 0.9 });
    const d = deriveCampaignDecisionAction(c, riskFor(), 0.5);
    expect(['INCREASE_BUDGET', 'REDUCE_BUDGET']).not.toContain(d.action);
  });

  it('threads delivery status through to the checkpoint label and flags NO_DELIVERY as a traffic issue', () => {
    const c = campaign({ spend: 0, clicks: 0, impressions: 0, orders: 0, sales: 0, acos: null });
    const d = deriveCampaignDecisionAction(c, riskFor({ clicks: 0, spend: 0, delivery: 'NO_DELIVERY' }), 0.5, 'NO_DELIVERY');
    expect(d.checkpointLabel).toBe('NO TRAFFIC — CONSIDER BID INCREASE');
    expect(d.delivery).toBe('NO_DELIVERY');
  });

  it('surfaces targetCpa/breakEvenCpa from manual economics when passed through', () => {
    const manualEcon = { productId: 'rose', complete: true as const, missingFields: [], contributionBeforeAdvertising: 11.99, breakEvenCpa: 11.99, breakEvenAcos: 0.6, maxCpaForTargetProfit: 6.99, targetAcos: 0.35 };
    const c = campaign({ spend: 5, budget: 20, acos: 0.1 });
    const d = deriveCampaignDecisionAction(c, riskFor(), 0.5, 'DELIVERING', manualEcon);
    expect(d.targetCpa).toBe(6.99);
    expect(d.breakEvenCpa).toBe(11.99);
  });
});

describe('findSearchTermNegativeCandidates', () => {
  function searchTerm(overrides: Partial<EnrichedSearchTerm> = {}): EnrichedSearchTerm {
    return {
      searchTerm: 'random unrelated term', targetingText: 'kw', matchType: 'broad', campaign: 'c', adGroup: 'ag',
      productId: 'rose', productName: 'Rose', impressions: 500, clicks: 10, spend: 15, orders: 0, sales: 0,
      acos: null, classification: 'CURRENT_SEARCH_TERM', isCurrentPeriod: true,
      ...overrides,
    };
  }

  it('flags a current-period, non-converting, meaningfully-spent search term as a negative candidate', () => {
    const candidates = findSearchTermNegativeCandidates([searchTerm()], DEFAULT_SETTINGS);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].searchTerm).toBe('random unrelated term');
  });

  it('never surfaces a HISTORICAL search term as an active negative candidate', () => {
    const candidates = findSearchTermNegativeCandidates([searchTerm({ isCurrentPeriod: false, classification: 'HISTORICAL_INEFFICIENT' })], DEFAULT_SETTINGS);
    expect(candidates).toHaveLength(0);
  });

  it('does not flag a search term with too little click evidence', () => {
    const candidates = findSearchTermNegativeCandidates([searchTerm({ clicks: 2, spend: 1 })], DEFAULT_SETTINGS);
    expect(candidates).toHaveLength(0);
  });

  it('does not flag a converting search term', () => {
    const candidates = findSearchTermNegativeCandidates([searchTerm({ orders: 1, sales: 20 })], DEFAULT_SETTINGS);
    expect(candidates).toHaveLength(0);
  });
});
