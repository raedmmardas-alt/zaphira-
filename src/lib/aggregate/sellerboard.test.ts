import { describe, it, expect } from 'vitest';
import { aggregateSellerboardProducts } from './sellerboard';
import type { SellerboardProductRow } from '../../types';

function row(overrides: Partial<SellerboardProductRow>): SellerboardProductRow {
  return {
    date: '2026-08-09',
    marketplace: 'US',
    asin: 'B0GZVBBRZP',
    sku: 'ROSE-001',
    salesOrganic: 0,
    salesPpc: 0,
    salesSponsoredProducts: 0,
    promotions: 0,
    amazonFees: 0,
    cogs: 0,
    refundCost: 0,
    adSpend: 0,
    units: 0,
    orders: 0,
    ...overrides,
  };
}

describe('aggregateSellerboardProducts', () => {
  it('aggregates daily rows into one product record per Marketplace+ASIN+SKU (failure mode #1)', () => {
    const rows = [
      row({ date: '2026-08-09', salesOrganic: 10, salesPpc: 20, orders: 1 }),
      row({ date: '2026-08-10', salesOrganic: 15, salesPpc: 25, orders: 2 }),
      row({ date: '2026-08-11', salesOrganic: 5, salesPpc: 10, orders: 1 }),
    ];
    const result = aggregateSellerboardProducts(rows);
    expect(result).toHaveLength(1);
    expect(result[0].orders).toBe(4);
  });

  it('sums SalesOrganic + SalesPPC for total sales, never adding SalesSponsoredProducts again (failure mode #2/#3)', () => {
    const rows = [
      row({ salesOrganic: 30, salesPpc: 70, salesSponsoredProducts: 70 }), // SP sales is a subset of PPC sales
    ];
    const result = aggregateSellerboardProducts(rows);
    expect(result[0].totalSales).toBe(100); // NOT 170
  });

  it('never leaves total sales at zero when organic+ppc sales are present (failure mode #2)', () => {
    const rows = [row({ salesOrganic: 40, salesPpc: 60 })];
    const result = aggregateSellerboardProducts(rows);
    expect(result[0].totalSales).toBe(100);
  });

  it('takes the absolute value of ad spend and does not double count across rows', () => {
    const rows = [
      row({ date: '2026-08-09', adSpend: -6, salesOrganic: 10, salesPpc: 10 }),
      row({ date: '2026-08-10', adSpend: -6, salesOrganic: 10, salesPpc: 10 }),
    ];
    const result = aggregateSellerboardProducts(rows);
    expect(result[0].ppcSpend).toBe(12);
  });

  it('computes break-even ACoS from contribution before ads WITHOUT subtracting PPC spend', () => {
    const rows = [
      row({ salesOrganic: 50, salesPpc: 50, amazonFees: 20, cogs: 30, promotions: 0, refundCost: 0, adSpend: 15 }),
    ];
    const result = aggregateSellerboardProducts(rows);
    // contributionBeforeAds = 100 - 0 - 20 - 30 - 0 = 50; breakEven = 50/100 = 0.5 (PPC spend of 15 must not appear here)
    expect(result[0].contributionBeforeAds).toBe(50);
    expect(result[0].breakEvenAcos).toBeCloseTo(0.5);
  });

  it('includes PPC spend in net profit, unlike break-even ACoS', () => {
    const rows = [row({ salesOrganic: 50, salesPpc: 50, amazonFees: 20, cogs: 30, adSpend: 15 })];
    const result = aggregateSellerboardProducts(rows);
    expect(result[0].netProfit).toBe(50 - 15); // contributionBeforeAds - ppcSpend
  });

  it('returns null break-even ACoS when sales are zero', () => {
    const rows = [row({ salesOrganic: 0, salesPpc: 0, adSpend: 10 })];
    const result = aggregateSellerboardProducts(rows);
    expect(result[0].breakEvenAcos).toBeNull();
    expect(result[0].realAcos).toBeNull();
  });

  it('keeps distinct products separate by Marketplace+ASIN+SKU', () => {
    const rows = [
      row({ asin: 'A1', sku: 'S1', salesOrganic: 10, salesPpc: 10 }),
      row({ asin: 'A2', sku: 'S2', salesOrganic: 20, salesPpc: 20 }),
    ];
    const result = aggregateSellerboardProducts(rows);
    expect(result).toHaveLength(2);
  });
});
