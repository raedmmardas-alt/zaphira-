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
    netProfit: null,
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

  it('computes break-even ACoS from contribution before ads WITHOUT subtracting PPC spend (realistic SIGNED Sellerboard inputs)', () => {
    // Sellerboard exports fees/COGS/ad spend as negative — this is the real
    // shape of the data, not the positive-only inputs a naive fixture might use.
    const rows = [
      row({ salesOrganic: 50, salesPpc: 50, amazonFees: -20, cogs: -30, promotions: 0, refundCost: 0, adSpend: -15 }),
    ];
    const result = aggregateSellerboardProducts(rows);
    // contributionBeforeAds = 100 - 0 - ABS(-20) - ABS(-30) - 0 = 50; breakEven = 50/100 = 0.5 (PPC spend of 15 must not appear here)
    expect(result[0].contributionBeforeAds).toBe(50);
    expect(result[0].breakEvenAcos).toBeCloseTo(0.5);
  });

  it('includes PPC spend in net profit, unlike break-even ACoS (realistic SIGNED Sellerboard inputs)', () => {
    const rows = [row({ salesOrganic: 50, salesPpc: 50, amazonFees: -20, cogs: -30, adSpend: -15 })];
    const result = aggregateSellerboardProducts(rows);
    expect(result[0].netProfit).toBe(50 - 15); // contributionBeforeAds(50) - ppcSpend(ABS(-15)=15)
  });

  it('does NOT flip a negative cost into income when subtracting a signed raw sum (the reported bug)', () => {
    // Mango case: AmazonFees = -0.76, Ads spend = 0, no sales this period.
    // A buggy implementation computes 0 - (-0.76) = +0.76. Correct is -0.76.
    const rows = [row({ salesOrganic: 0, salesPpc: 0, amazonFees: -0.76, adSpend: 0 })];
    const result = aggregateSellerboardProducts(rows);
    expect(result[0].netProfit).toBe(-0.76);
    expect(result[0].netProfit).not.toBe(0.76);
  });

  it('nets signed values across multiple daily rows before taking the magnitude (a mid-period fee credit reduces cost, it does not add to it)', () => {
    const rows = [
      row({ date: '2026-08-09', amazonFees: -5 }),
      row({ date: '2026-08-10', amazonFees: 2 }), // a credit/reversal
    ];
    const result = aggregateSellerboardProducts(rows);
    // Net fee cost is 5 - 2 = 3, not 5 + 2 = 7.
    expect(result[0].amazonFees).toBe(3);
  });

  it("prefers Sellerboard's own signed Net Profit column when present, instead of reconstructing it from components", () => {
    const rows = [
      row({ salesOrganic: 50, salesPpc: 50, amazonFees: -20, cogs: -30, adSpend: -15, netProfit: -42 }),
    ];
    const result = aggregateSellerboardProducts(rows);
    // Reconstruction would give 50 - 15 = 35; Sellerboard's authoritative total (-42) must win.
    expect(result[0].netProfit).toBe(-42);
  });

  it('sums the raw signed Net Profit column across rows rather than recomputing per-row', () => {
    const rows = [
      row({ date: '2026-08-09', netProfit: -1.0 }),
      row({ date: '2026-08-10', netProfit: -0.53 }),
    ];
    const result = aggregateSellerboardProducts(rows);
    expect(result[0].netProfit).toBeCloseTo(-1.53);
  });

  it('does not let salesSponsoredProducts (a sales metric) leak into ppcSpend or netProfit — only Ads spend is the PPC cost source', () => {
    const rows = [row({ salesOrganic: 0, salesPpc: 0, amazonFees: -0.59, adSpend: -0.94, salesSponsoredProducts: 999 })];
    const result = aggregateSellerboardProducts(rows);
    expect(result[0].ppcSpend).toBe(0.94);
    expect(result[0].netProfit).toBeCloseTo(-1.53);
  });

  describe('real Aug 9-12 regression fixture (Coconut/Mango/Rose/Vanilla)', () => {
    const rows: SellerboardProductRow[] = [
      row({ asin: 'B0GZVGXXS2', sku: 'COCO-001', amazonFees: -0.59, adSpend: -0.94 }),
      row({ asin: 'B0GZVP9HRB', sku: 'MANGO-001', amazonFees: -0.76, adSpend: 0 }),
      row({ asin: 'B0GZVBBRZP', sku: 'ROSE-001', amazonFees: -0.86, adSpend: -4.69 }),
      row({ asin: 'B0H28WG6BB', sku: 'VANILLA-001', amazonFees: -0.96, adSpend: -10.85 }),
    ];
    const result = aggregateSellerboardProducts(rows);
    const byAsin = new Map(result.map((r) => [r.asin, r]));

    it('Coconut: -1.53', () => expect(byAsin.get('B0GZVGXXS2')!.netProfit).toBeCloseTo(-1.53));
    it('Mango: -0.76', () => expect(byAsin.get('B0GZVP9HRB')!.netProfit).toBeCloseTo(-0.76));
    it('Rose: -5.55', () => expect(byAsin.get('B0GZVBBRZP')!.netProfit).toBeCloseTo(-5.55));
    it('Vanilla: -11.81', () => expect(byAsin.get('B0H28WG6BB')!.netProfit).toBeCloseTo(-11.81));
    it('Total Product Profit: -19.65', () => {
      const total = result.reduce((a, r) => a + r.netProfit, 0);
      expect(total).toBeCloseTo(-19.65);
    });
  });

  it('previously-validated profitable full-period case still works: sales, promotions, COGS, refunds, and PPC together, all realistically signed', () => {
    const rows = [
      row({
        salesOrganic: 200, salesPpc: 300, // totalSales = 500
        promotions: -10, amazonFees: -75, cogs: -150, refundCost: -5, adSpend: -40,
      }),
    ];
    const result = aggregateSellerboardProducts(rows);
    // contributionBeforeAds = 500 - 10 - 75 - 150 - 5 = 260
    expect(result[0].contributionBeforeAds).toBeCloseTo(260);
    expect(result[0].breakEvenAcos).toBeCloseTo(260 / 500);
    // netProfit = contributionBeforeAds - ppcSpend = 260 - 40 = 220 (profitable)
    expect(result[0].netProfit).toBeCloseTo(220);
    expect(result[0].margin).toBeCloseTo(220 / 500);
    expect(result[0].realAcos).toBeCloseTo(40 / 500);
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
