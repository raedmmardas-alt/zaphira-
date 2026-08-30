import { describe, it, expect } from 'vitest';
import { deriveBudgetGuidance, deriveOverallStatus, deriveProductOverviewStatus } from './homeRollups';
import type { NextDollarResult } from './nextDollar';
import type { DecisionAction, RiskBreakdown } from '../../types';

function risk(classification: RiskBreakdown['classification'], overallScore = 20): RiskBreakdown {
  return {
    spendRisk: 0, conversionRisk: 0, profitabilityRisk: 0, deliveryRisk: 0, dataConfidenceRisk: 0,
    overallScore, classification, maxTestingSpend: 10, maxTestingSpendSource: 'SETTINGS_FALLBACK', reasons: [],
  };
}

function action(overrides: Partial<DecisionAction> = {}): DecisionAction {
  return {
    scope: 'TARGET', key: 'k1', productId: 'coconut', productName: 'Coconut', campaign: 'Coconut - Sponsored Products',
    adGroup: 'Coconut AG', targetingText: 'cocoa butter lotion', matchType: 'EXACT', action: 'KEEP',
    currentBid: 1.4, recommendedBid: null, currentBudget: null, recommendedBudget: null,
    reason: 'On track.', risk: risk('LOW'), confidence: 'MEDIUM', estimatedImpact: 0,
    currentPerformance: { impressions: 100, clicks: 5, spend: 3, orders: 1, sales: 20, acos: 0.15 },
    conversionEvidence: 'MODERATE', checkpointLabel: 'ON TRACK', remainingTestAllowance: 5,
    targetCpa: null, breakEvenCpa: null, remainingToTargetCpaReview: null, remainingToBreakEvenStop: null,
    delivery: 'DELIVERING',
    ...overrides,
  };
}

const NO_HOLD: NextDollarResult = { hold: false, holdReason: null, candidates: [] };
const HOLD: NextDollarResult = { hold: true, holdReason: 'No scale-eligible target yet.', candidates: [] };

describe('deriveOverallStatus', () => {
  it('returns ACTION_NEEDED when reconciliation has a genuine mismatch, regardless of action risk', () => {
    expect(deriveOverallStatus('DATA_MISMATCH_REVIEW_REQUIRED', [])).toBe('ACTION_NEEDED');
  });

  it('returns ACTION_NEEDED when any ranked action carries HIGH or CRITICAL risk', () => {
    expect(deriveOverallStatus('DATA_RECONCILED', [action({ risk: risk('HIGH') })])).toBe('ACTION_NEEDED');
    expect(deriveOverallStatus('DATA_RECONCILED', [action({ risk: risk('CRITICAL') })])).toBe('ACTION_NEEDED');
  });

  it('returns WATCH for MODERATE risk or a REDUCE/PAUSE-mapped action, when nothing is ACTION_NEEDED', () => {
    expect(deriveOverallStatus('DATA_RECONCILED', [action({ risk: risk('MODERATE') })])).toBe('WATCH');
    expect(deriveOverallStatus('DATA_RECONCILED', [action({ risk: risk('LOW'), action: 'REDUCE_BID' })])).toBe('WATCH');
    expect(deriveOverallStatus('DATA_RECONCILED', [action({ risk: risk('LOW'), action: 'PAUSE' })])).toBe('WATCH');
  });

  it('returns GOOD when reconciled and every action is low risk with no reduce/pause signal', () => {
    expect(deriveOverallStatus('DATA_RECONCILED', [action({ risk: risk('LOW'), action: 'KEEP' })])).toBe('GOOD');
    expect(deriveOverallStatus('INSUFFICIENT_DATA', [])).toBe('GOOD');
  });
});

describe('deriveBudgetGuidance', () => {
  it('recommends Reduce and sums the per-campaign cut when any campaign shows REDUCE_BUDGET', () => {
    const reduceAction = action({
      scope: 'CAMPAIGN', action: 'REDUCE_BUDGET', currentBudget: 20, recommendedBudget: 17,
      reason: 'ACoS above break-even.', currentPerformance: { impressions: 500, clicks: 20, spend: 20, orders: 1, sales: 30, acos: 0.67 },
    });
    const result = deriveBudgetGuidance([reduceAction], NO_HOLD, 16);
    expect(result.recommendation).toBe('Reduce');
    expect(result.today).toBeCloseTo(13); // 16 - (20-17)
    expect(result.current).toBe(16);
    expect(result.reason).toBe('ACoS above break-even.');
  });

  it('recommends Increase and sums the per-campaign add when any campaign shows INCREASE_BUDGET (and no reduce exists)', () => {
    const increaseAction = action({
      scope: 'CAMPAIGN', action: 'INCREASE_BUDGET', currentBudget: 20, recommendedBudget: 24,
      reason: 'Efficient and budget-capped.', currentPerformance: { impressions: 500, clicks: 20, spend: 19, orders: 3, sales: 90, acos: 0.21 },
    });
    const result = deriveBudgetGuidance([increaseAction], NO_HOLD, 16);
    expect(result.recommendation).toBe('Increase');
    expect(result.today).toBeCloseTo(20); // 16 + (24-20)
    expect(result.reason).toBe('Efficient and budget-capped.');
  });

  it('prioritizes Reduce over Increase when both signals exist, as the conservative read', () => {
    const reduceAction = action({ scope: 'CAMPAIGN', action: 'REDUCE_BUDGET', currentBudget: 20, recommendedBudget: 17, currentPerformance: { impressions: 1, clicks: 1, spend: 1, orders: 0, sales: 0, acos: null } });
    const increaseAction = action({ scope: 'CAMPAIGN', action: 'INCREASE_BUDGET', currentBudget: 10, recommendedBudget: 12, currentPerformance: { impressions: 1, clicks: 1, spend: 1, orders: 0, sales: 0, acos: null } });
    expect(deriveBudgetGuidance([reduceAction, increaseAction], NO_HOLD, 16).recommendation).toBe('Reduce');
  });

  it('returns the exact insufficient-evidence wording when there is no current-period campaign spend at all', () => {
    const noSpend = action({ scope: 'CAMPAIGN', action: 'HOLD_COLLECT_DATA', currentPerformance: { impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0, acos: null } });
    const result = deriveBudgetGuidance([noSpend], HOLD, 16);
    expect(result.recommendation).toBe('Hold');
    expect(result.today).toBe(16);
    expect(result.reason).toBe('Hold current budget — more conversion data needed.');
  });

  it('holds using the nextDollar hold reason when there is spend evidence but no budget-change signal', () => {
    const stable = action({ scope: 'CAMPAIGN', action: 'KEEP', currentPerformance: { impressions: 500, clicks: 20, spend: 10, orders: 2, sales: 40, acos: 0.25 } });
    const result = deriveBudgetGuidance([stable], HOLD, 16);
    expect(result.recommendation).toBe('Hold');
    expect(result.reason).toBe('No scale-eligible target yet.');
  });
});

describe('deriveProductOverviewStatus', () => {
  it('maps each real product-strategy classification to its seller-facing label', () => {
    expect(deriveProductOverviewStatus('GROW_CAREFULLY', 10)).toBe('Winning');
    expect(deriveProductOverviewStatus('MONITOR', 10)).toBe('Watch');
    expect(deriveProductOverviewStatus('FIX_ECONOMICS', 10)).toBe('Needs Attention');
    expect(deriveProductOverviewStatus('REDUCE_WASTE', 10)).toBe('Needs Attention');
  });

  it('distinguishes Testing (real current spend) from Not Enough Data (no spend) when strategy is INSUFFICIENT_DATA', () => {
    expect(deriveProductOverviewStatus('INSUFFICIENT_DATA', 5)).toBe('Testing');
    expect(deriveProductOverviewStatus('INSUFFICIENT_DATA', 0)).toBe('Not Enough Data');
    expect(deriveProductOverviewStatus(undefined, 0)).toBe('Not Enough Data');
  });
});
