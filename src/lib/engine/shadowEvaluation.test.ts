import { describe, it, expect } from 'vitest';
import { evaluateShadowSnapshot } from './shadowEvaluation';
import type { EnrichedTarget, ShadowSnapshot } from '../../types';

function snapshot(overrides: Partial<ShadowSnapshot>): ShadowSnapshot {
  return {
    id: 's1',
    savedAt: '2026-08-01T00:00:00Z',
    reportPeriod: { start: '2026-07-01', end: '2026-07-31' },
    targetKey: 'campaign|adgroup|keyword|exact',
    targetingText: 'keyword',
    matchType: 'exact',
    productId: 'rose',
    productName: 'Rose',
    asin: 'A',
    campaign: 'campaign',
    adGroup: 'adgroup',
    currentBid: 0.5,
    recommendedAction: 'REDUCE_BID',
    recommendedBid: 0.45,
    risk: 'MEDIUM',
    confidence: 'MEDIUM',
    delivery: 'HIGH_DELIVERY',
    beforeMetrics: { impressions: 1000, clicks: 30, spend: 20, orders: 0, sales: 0, acos: null, cvr: 0 },
    appliedManually: false,
    appliedAt: null,
    status: 'PENDING',
    statusUpdatedAt: null,
    ...overrides,
  };
}

function target(overrides: Partial<EnrichedTarget>): EnrichedTarget {
  return {
    key: 'campaign|adgroup|keyword|exact',
    targetingText: 'keyword',
    matchType: 'exact',
    campaign: 'campaign',
    adGroup: 'adgroup',
    productId: 'rose',
    productName: 'Rose',
    asin: 'A',
    mappingSource: 'ASIN',
    currentBid: 0.4,
    impressions: 1200,
    clicks: 35,
    spend: 14,
    orders: 3,
    sales: 90,
    ctr: 0.03,
    cvr: 0.08,
    acos: 14 / 90,
    delivery: 'HIGH_DELIVERY',
    isCurrentPeriod: true,
    action: { action: 'KEEP', currentBid: 0.4, recommendedBid: 0.4, safeRangeMin: null, safeRangeMax: null, stopLoss: null, reason: '', risk: 'LOW', confidence: 'HIGH' },
    ...overrides,
  };
}

describe('evaluateShadowSnapshot', () => {
  it('never evaluates a directional outcome for a snapshot that was not applied manually (failure mode #11)', () => {
    const snap = snapshot({ appliedManually: false });
    const map = new Map([[snap.targetKey, target({})]]);
    const result = evaluateShadowSnapshot(snap, map, { start: '2026-08-01', end: '2026-08-31' });
    expect(result.outcome).toBe('INSUFFICIENT_DATA');
    expect(result.notes).toMatch(/observational only/i);
  });

  it('an ACCEPTED (but not applied) status still never counts toward directional accuracy', () => {
    const snap = snapshot({ appliedManually: false, status: 'ACCEPTED' });
    const map = new Map([[snap.targetKey, target({})]]);
    const result = evaluateShadowSnapshot(snap, map, { start: '2026-08-01', end: '2026-08-31' });
    expect(result.outcome).toBe('INSUFFICIENT_DATA');
  });

  it('a REJECTED status never counts toward directional accuracy', () => {
    const snap = snapshot({ appliedManually: false, status: 'REJECTED' });
    const map = new Map([[snap.targetKey, target({})]]);
    const result = evaluateShadowSnapshot(snap, map, { start: '2026-08-01', end: '2026-08-31' });
    expect(result.outcome).toBe('INSUFFICIENT_DATA');
  });

  it('evaluates POSITIVE for an applied snapshot with improved ACoS and steady/higher orders in a later period', () => {
    const snap = snapshot({
      appliedManually: true,
      reportPeriod: { start: '2026-07-01', end: '2026-07-31' },
      beforeMetrics: { impressions: 1000, clicks: 30, spend: 20, orders: 1, sales: 40, acos: 0.5, cvr: 1 / 30 },
    });
    const map = new Map([[snap.targetKey, target({ acos: 0.15, orders: 2, spend: 14, sales: 90, clicks: 35 })]]);
    const result = evaluateShadowSnapshot(snap, map, { start: '2026-08-01', end: '2026-08-31' });
    expect(result.outcome).toBe('POSITIVE');
  });

  it('returns NON_COMPARABLE_PERIOD when current data overlaps the snapshot period', () => {
    const snap = snapshot({ appliedManually: true, reportPeriod: { start: '2026-08-01', end: '2026-08-31' } });
    const map = new Map([[snap.targetKey, target({})]]);
    const result = evaluateShadowSnapshot(snap, map, { start: '2026-08-15', end: '2026-09-15' });
    expect(result.outcome).toBe('NON_COMPARABLE_PERIOD');
  });

  it('returns INSUFFICIENT_DATA when the target no longer appears in current data', () => {
    const snap = snapshot({ appliedManually: true, reportPeriod: { start: '2026-07-01', end: '2026-07-31' } });
    const result = evaluateShadowSnapshot(snap, new Map(), { start: '2026-08-01', end: '2026-08-31' });
    expect(result.outcome).toBe('INSUFFICIENT_DATA');
  });

  it('always labels applied evaluations as observational only, never causal proof', () => {
    const snap = snapshot({ appliedManually: true, reportPeriod: { start: '2026-07-01', end: '2026-07-31' } });
    const map = new Map([[snap.targetKey, target({})]]);
    const result = evaluateShadowSnapshot(snap, map, { start: '2026-08-01', end: '2026-08-31' });
    expect(result.notes).toMatch(/observational validation only/i);
  });
});
