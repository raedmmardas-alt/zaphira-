import { describe, it, expect } from 'vitest';
import { decideTargetAction, type TargetActionInput } from './targetActions';
import { DEFAULT_SETTINGS } from '../../types';
import type { ProductEconomics } from '../../types';

function baseInput(overrides: Partial<TargetActionInput>): TargetActionInput {
  return {
    clicks: 0,
    orders: 0,
    spend: 0,
    sales: 0,
    acos: null,
    currentBid: 0.5,
    mappingConfident: true,
    productId: 'rose',
    productEconomics: null,
    settings: DEFAULT_SETTINGS,
    ...overrides,
  };
}

const economics = (breakEvenAcos: number): ProductEconomics => ({
  productId: 'rose', asin: 'A', sku: 'S', marketplace: 'US', totalSales: 100, ppcSpend: 10, promotions: 0,
  amazonFees: 0, cogs: 0, refundCost: 0, contributionBeforeAds: breakEvenAcos * 100, breakEvenAcos, netProfit: 50,
  margin: 0.5, realAcos: 0.1, units: 10, orders: 5,
});

describe('decideTargetAction', () => {
  it('blocks with PRODUCT_MAPPING_REQUIRED when the product mapping is missing or unconfident', () => {
    const r = decideTargetAction(baseInput({ productId: null, mappingConfident: false }));
    expect(r.action).toBe('PRODUCT_MAPPING_REQUIRED');
    expect(r.risk).toBe('BLOCKED');
  });

  it('returns WAIT under 5 clicks regardless of other signals', () => {
    const r = decideTargetAction(baseInput({ clicks: 3, orders: 0, spend: 50 }));
    expect(r.action).toBe('WAIT');
  });

  it('returns WAIT for 5+ clicks, 0 purchases, spend under $8', () => {
    const r = decideTargetAction(baseInput({ clicks: 6, orders: 0, spend: 5 }));
    expect(r.action).toBe('WAIT');
  });

  it('returns WATCH for 0 purchases with spend between $8 and $15', () => {
    const r = decideTargetAction(baseInput({ clicks: 6, orders: 0, spend: 10 }));
    expect(r.action).toBe('WATCH');
  });

  it('returns REDUCE_BID for 0 purchases with spend between $15 and $20', () => {
    const r = decideTargetAction(baseInput({ clicks: 25, orders: 0, spend: 18 }));
    expect(r.action).toBe('REDUCE_BID');
    expect(r.recommendedBid).toBeLessThan(r.currentBid!);
  });

  it('returns NEGATIVE_PAUSE_CANDIDATE for 0 purchases, spend over $20, with sufficient click evidence', () => {
    const r = decideTargetAction(baseInput({ clicks: 25, orders: 0, spend: 25 }));
    expect(r.action).toBe('NEGATIVE_PAUSE_CANDIDATE');
    expect(r.risk).toBe('HIGH');
  });

  it('scales when 2+ purchases and ACoS is well under break-even, with confirmed economics', () => {
    const r = decideTargetAction(baseInput({ clicks: 20, orders: 3, spend: 12, sales: 90, acos: 12 / 90, productEconomics: economics(0.6) }));
    expect(r.action).toBe('SCALE');
    expect(r.recommendedBid).toBeGreaterThan(r.currentBid!);
  });

  it('never scales when real ACoS exceeds this product\'s effective (break-even-bounded) target, even with 2+ purchases', () => {
    // A low break-even (10%) tightens the effective target well below the 13.3% real ACoS, so scaling is withheld.
    const r = decideTargetAction(baseInput({ clicks: 20, orders: 3, spend: 12, sales: 90, acos: 12 / 90, productEconomics: economics(0.1) }));
    expect(r.action).not.toBe('SCALE');
    expect(r.reason).toMatch(/target|break-even/i);
  });

  it('blocks scaling when no product economics are available, even if the generic rule would scale', () => {
    const r = decideTargetAction(baseInput({ clicks: 20, orders: 3, spend: 12, sales: 90, acos: 12 / 90, productEconomics: null }));
    expect(r.action).not.toBe('SCALE');
  });

  it('reduces bid for severely elevated ACoS with sufficient click evidence', () => {
    const r = decideTargetAction(baseInput({ clicks: 20, orders: 1, spend: 40, sales: 45, acos: 40 / 45, productEconomics: economics(0.45) }));
    expect(r.action).toBe('REDUCE_BID');
  });

  it('respects the configured max bid increase/reduction guardrails', () => {
    const settings = { ...DEFAULT_SETTINGS, maxBidIncreasePct: 0.02 };
    const r = decideTargetAction(baseInput({ clicks: 20, orders: 3, spend: 12, sales: 90, acos: 12 / 90, productEconomics: economics(0.6), settings }));
    expect(r.recommendedBid).toBeCloseTo(0.5 * 1.02, 2);
  });
});
