import { describe, it, expect } from 'vitest';
import { buildVariantIntelligence } from './variantIntelligence';
import type { ProductEconomics } from '../../types';
import type { ProductPerformanceRow } from './ppcPerformanceSeries';

function row(overrides: Partial<ProductPerformanceRow>): ProductPerformanceRow {
  return {
    productId: 'rose', productName: 'Rose', asin: 'A', impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0,
    cpc: null, acos: null, roas: null,
    ...overrides,
  };
}

const econ = (productId: string, netProfit: number): ProductEconomics => ({
  productId, asin: 'A', sku: 'S', marketplace: 'US', totalSales: 100, ppcSpend: 10, promotions: 0,
  amazonFees: 0, cogs: 0, refundCost: 0, contributionBeforeAds: 50, breakEvenAcos: 0.5, netProfit,
  margin: 0.5, realAcos: 0.1, units: 10, orders: 5,
});

describe('buildVariantIntelligence', () => {
  const rows: ProductPerformanceRow[] = [
    row({ productId: 'rose', productName: 'Rose', impressions: 1000, clicks: 50, orders: 5, spend: 20, sales: 150, acos: 0.13, roas: 7.5 }),
    row({ productId: 'coconut', productName: 'Coconut', impressions: 2000, clicks: 30, orders: 1, spend: 15, sales: 20, acos: 0.75, roas: 1.3 }),
    row({ productId: 'mango', productName: 'Mango', impressions: 200, clicks: 5, orders: 0, spend: 3, sales: 0, acos: null, roas: 0 }),
    row({ productId: 'vanilla', productName: 'Vanilla', impressions: 500, clicks: 10, orders: 0, spend: 5, sales: 0, acos: null, roas: 0 }),
  ];
  const economicsById = { rose: econ('rose', 40), coconut: econ('coconut', -5) };
  const riskScoreByProductId = { rose: 15, coconut: 60, mango: 30, vanilla: 45 };

  it('identifies strongest traffic by clicks', () => {
    expect(buildVariantIntelligence(rows, economicsById, riskScoreByProductId).strongestTraffic).toBe('rose');
  });

  it('identifies best CPA (lowest, minimized) among products with orders', () => {
    // Rose CPA = 20/5=4, Coconut CPA=15/1=15 -> Rose wins
    expect(buildVariantIntelligence(rows, economicsById, riskScoreByProductId).bestCpa).toBe('rose');
  });

  it('identifies best profitability from Sellerboard net profit', () => {
    expect(buildVariantIntelligence(rows, economicsById, riskScoreByProductId).bestProfitability).toBe('rose');
  });

  it('identifies highest risk by risk score', () => {
    expect(buildVariantIntelligence(rows, economicsById, riskScoreByProductId).highestRisk).toBe('coconut');
  });

  it('never picks a product with no orders as best conversion/CPA (never fabricates a rate from zero data)', () => {
    const result = buildVariantIntelligence(rows, economicsById, riskScoreByProductId);
    expect(result.bestCpa).not.toBe('mango');
    expect(result.bestCpa).not.toBe('vanilla');
  });

  it('only recommends a scaling opportunity among confirmed-profitable, lower-risk products', () => {
    const result = buildVariantIntelligence(rows, economicsById, riskScoreByProductId);
    // Coconut is profitable-negative and higher risk, so Rose should win.
    expect(result.strongestScalingOpportunity).toBe('rose');
  });

  it('returns null for a category when no product has data for it', () => {
    const emptyRows: ProductPerformanceRow[] = [row({ productId: 'rose', productName: 'Rose' })];
    const result = buildVariantIntelligence(emptyRows, {}, {});
    expect(result.bestCpa).toBeNull();
    expect(result.bestProfitability).toBeNull();
    expect(result.highestRisk).toBeNull();
    expect(result.strongestScalingOpportunity).toBeNull();
  });
});
