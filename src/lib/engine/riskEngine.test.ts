import { describe, it, expect } from 'vitest';
import { computeRisk } from './riskEngine';
import type { RiskInput } from './riskEngine';
import { DEFAULT_SETTINGS } from '../../types';
import type { ProductEconomics, ProductEconomicsCalcResult } from '../../types';

function baseInput(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    clicks: 0, orders: 0, spend: 0, acos: null, delivery: 'NO_DELIVERY',
    mappingConfident: true, productEconomics: null, manualEconomics: null, settings: DEFAULT_SETTINGS,
    ...overrides,
  };
}

const economics = (breakEvenAcos: number): ProductEconomics => ({
  productId: 'rose', asin: 'A', sku: 'S', marketplace: 'US', totalSales: 100, ppcSpend: 10, promotions: 0,
  amazonFees: 0, cogs: 0, refundCost: 0, contributionBeforeAds: breakEvenAcos * 100, breakEvenAcos, netProfit: 50,
  margin: 0.5, realAcos: 0.1, units: 10, orders: 5,
});

const manualEconomics = (breakEvenAcos: number, breakEvenCpa: number): ProductEconomicsCalcResult => ({
  productId: 'rose', complete: true, missingFields: [], contributionBeforeAdvertising: breakEvenCpa, breakEvenCpa,
  breakEvenAcos, maxCpaForTargetProfit: null, targetAcos: null,
});

describe('computeRisk', () => {
  it('is maximally risky (CRITICAL, 0 testing spend) when the product mapping is unconfident', () => {
    const r = computeRisk(baseInput({ mappingConfident: false }));
    expect(r.classification).toBe('CRITICAL');
    expect(r.overallScore).toBe(100);
    expect(r.maxTestingSpend).toBe(0);
  });

  it('does NOT inflate conversion/profitability risk from insufficient data alone — only dataConfidenceRisk rises', () => {
    const r = computeRisk(baseInput({ clicks: 2, orders: 0, spend: 1, delivery: 'DELIVERING' }));
    expect(r.conversionRisk).toBeLessThan(30);
    expect(r.dataConfidenceRisk).toBeGreaterThanOrEqual(50);
  });

  it('raises conversion risk for meaningful clicks with zero orders', () => {
    const r = computeRisk(baseInput({ clicks: 25, orders: 0, spend: 20, delivery: 'HIGH_DELIVERY' }));
    expect(r.conversionRisk).toBeGreaterThan(50);
  });

  it('raises profitability risk when real ACoS exceeds break-even', () => {
    const r = computeRisk(baseInput({ clicks: 20, orders: 2, spend: 20, acos: 0.8, productEconomics: economics(0.4) }));
    expect(r.profitabilityRisk).toBeGreaterThan(50);
  });

  it('keeps profitability risk low when real ACoS is well under break-even', () => {
    const r = computeRisk(baseInput({ clicks: 20, orders: 3, spend: 10, acos: 0.1, productEconomics: economics(0.5) }));
    expect(r.profitabilityRisk).toBeLessThan(20);
  });

  it('treats NO_DELIVERY as a modest uncertainty risk, not a severe penalty (insufficient data != poor performance)', () => {
    const r = computeRisk(baseInput({ delivery: 'NO_DELIVERY', clicks: 0, orders: 0, spend: 0 }));
    expect(r.deliveryRisk).toBeLessThanOrEqual(35);
    expect(r.overallScore).toBeLessThan(60);
  });

  it('classifies overall score into LOW/MODERATE/HIGH/CRITICAL bands correctly', () => {
    expect(computeRisk(baseInput({ clicks: 40, orders: 4, spend: 5, acos: 0.1, delivery: 'HIGH_DELIVERY', productEconomics: economics(0.5) })).classification).toBe('LOW');
    expect(computeRisk(baseInput({ clicks: 25, orders: 0, spend: 22, delivery: 'HIGH_DELIVERY' })).classification).not.toBe('LOW');
  });

  it('derives maxTestingSpend from manual product economics break-even CPA when available', () => {
    const r = computeRisk(baseInput({ manualEconomics: manualEconomics(0.5, 5) }));
    expect(r.maxTestingSpendSource).toBe('PRODUCT_ECONOMICS');
    expect(r.maxTestingSpend).toBeCloseTo(Math.min(DEFAULT_SETTINGS.stopLossSpend, 10));
  });

  it('falls back to the generic configured stop-loss spend when no product economics are available at all', () => {
    const r = computeRisk(baseInput({}));
    expect(r.maxTestingSpendSource).toBe('SETTINGS_FALLBACK');
    expect(r.maxTestingSpend).toBe(DEFAULT_SETTINGS.stopLossSpend);
  });

  it('never lets maxTestingSpend exceed the configured stop-loss spend ceiling', () => {
    const r = computeRisk(baseInput({ manualEconomics: manualEconomics(0.5, 999) }));
    expect(r.maxTestingSpend).toBeLessThanOrEqual(DEFAULT_SETTINGS.stopLossSpend);
  });
});
