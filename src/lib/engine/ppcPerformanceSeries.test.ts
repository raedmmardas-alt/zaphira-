import { describe, it, expect } from 'vitest';
import { buildDailySeriesFromCampaigns, bucketSeries, buildProductPerformanceRows } from './ppcPerformanceSeries';
import { computeRoas } from './metrics';
import type { CampaignRow, EnrichedCampaign, Product } from '../../types';

const PERIOD = { start: '2026-08-09', end: '2026-08-16' };

describe('buildDailySeriesFromCampaigns', () => {
  it('builds one point per genuine single-day row, summed across campaigns', () => {
    const rows: CampaignRow[] = [
      { campaign: 'Rose', impressions: 100, clicks: 5, spend: 2, orders: 0, sales: 0, activityStart: '2026-08-09', activityEnd: '2026-08-09' },
      { campaign: 'Coconut', impressions: 50, clicks: 2, spend: 1, orders: 0, sales: 0, activityStart: '2026-08-09', activityEnd: '2026-08-09' },
      { campaign: 'Rose', impressions: 80, clicks: 4, spend: 1.5, orders: 1, sales: 20, activityStart: '2026-08-10', activityEnd: '2026-08-10' },
    ];
    const series = buildDailySeriesFromCampaigns(rows, PERIOD);
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ date: '2026-08-09', impressions: 150, clicks: 7, spend: 3 });
    expect(series[1]).toMatchObject({ date: '2026-08-10', impressions: 80, clicks: 4, spend: 1.5, sales: 20 });
  });

  it('never fabricates a daily value from an aggregated multi-day row', () => {
    const rows: CampaignRow[] = [
      { campaign: 'Rose', impressions: 900, clicks: 50, spend: 20, orders: 2, sales: 60, activityStart: '2026-08-09', activityEnd: '2026-08-16' },
    ];
    const series = buildDailySeriesFromCampaigns(rows, PERIOD);
    expect(series).toHaveLength(0);
  });

  it('excludes rows with no date information at all', () => {
    const rows: CampaignRow[] = [{ campaign: 'Rose', impressions: 900, clicks: 50, spend: 20, orders: 2, sales: 60 }];
    expect(buildDailySeriesFromCampaigns(rows, PERIOD)).toHaveLength(0);
  });

  it('excludes genuine daily rows that fall outside the current period', () => {
    const rows: CampaignRow[] = [
      { campaign: 'Rose', impressions: 100, clicks: 5, spend: 2, orders: 0, sales: 0, activityStart: '2026-07-01', activityEnd: '2026-07-01' },
    ];
    expect(buildDailySeriesFromCampaigns(rows, PERIOD)).toHaveLength(0);
  });

  it('returns an empty series when there is no current period established', () => {
    const rows: CampaignRow[] = [{ campaign: 'Rose', impressions: 100, clicks: 5, spend: 2, orders: 0, sales: 0, activityStart: '2026-08-09', activityEnd: '2026-08-09' }];
    expect(buildDailySeriesFromCampaigns(rows, null)).toHaveLength(0);
  });
});

describe('bucketSeries', () => {
  const daily = [
    { date: '2026-08-09', impressions: 100, clicks: 5, spend: 2, sales: 10 }, // Sunday
    { date: '2026-08-10', impressions: 80, clicks: 4, spend: 1.5, sales: 20 }, // Monday (new ISO week)
    { date: '2026-08-11', impressions: 60, clicks: 3, spend: 1, sales: 0 }, // Tuesday, same week as the 10th
  ];

  it('passes daily granularity through unchanged', () => {
    expect(bucketSeries(daily, 'daily')).toEqual(daily);
  });

  it('aggregates into ISO weeks (Monday-start) without inventing days', () => {
    const weekly = bucketSeries(daily, 'weekly');
    // Aug 9, 2026 is a Sunday -> its own week (starting Mon Aug 3).
    // Aug 10-11 are Mon/Tue of the following week (starting Aug 10).
    expect(weekly).toHaveLength(2);
    const week1 = weekly.find((w) => w.date === '2026-08-03')!;
    expect(week1).toMatchObject({ impressions: 100, clicks: 5, spend: 2, sales: 10 });
    const week2 = weekly.find((w) => w.date === '2026-08-10')!;
    expect(week2).toMatchObject({ impressions: 140, clicks: 7, spend: 2.5, sales: 20 });
  });

  it('aggregates into calendar months', () => {
    const monthly = bucketSeries(daily, 'monthly');
    expect(monthly).toHaveLength(1);
    expect(monthly[0]).toMatchObject({ date: '2026-08-01', impressions: 240, clicks: 12, spend: 4.5, sales: 30 });
  });
});

describe('buildProductPerformanceRows', () => {
  const products: Product[] = [
    { id: 'rose', name: 'Rose', asin: 'B0GZVBBRZP', sku: '', sellingPrice: 19.99, aliases: [], campaignAliases: [], adGroupAliases: [] },
    { id: 'coconut', name: 'Coconut', asin: 'B0GZVGXXS2', sku: '', sellingPrice: 19.99, aliases: [], campaignAliases: [], adGroupAliases: [] },
  ];

  function campaign(overrides: Partial<EnrichedCampaign>): EnrichedCampaign {
    return {
      campaign: 'C', productId: 'rose', productName: 'Rose', statusConfidence: 'CURRENT_ACTIVITY_CONFIRMED',
      impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0, acos: null, ctr: null, cpc: null, cvr: null, budget: null,
      recommendation: '', risk: 'LOW', confidence: 'MEDIUM', isCurrentPeriod: true,
      ...overrides,
    };
  }

  it('rolls up impressions/clicks/spend/orders/sales per product and computes CPC/ACoS/ROAS from the totals', () => {
    const campaigns = [
      campaign({ productId: 'rose', impressions: 1000, clicks: 40, spend: 20, orders: 2, sales: 60 }),
      campaign({ productId: 'rose', impressions: 500, clicks: 10, spend: 5, orders: 0, sales: 0 }),
      campaign({ productId: 'coconut', impressions: 200, clicks: 5, spend: 3, orders: 0, sales: 0 }),
    ];
    const rows = buildProductPerformanceRows(campaigns, products);
    const rose = rows.find((r) => r.productId === 'rose')!;
    expect(rose.impressions).toBe(1500);
    expect(rose.clicks).toBe(50);
    expect(rose.spend).toBeCloseTo(25);
    expect(rose.orders).toBe(2);
    expect(rose.sales).toBeCloseTo(60);
    expect(rose.cpc).toBeCloseTo(25 / 50);
    expect(rose.acos).toBeCloseTo(25 / 60);
    expect(rose.roas).toBeCloseTo(60 / 25);
  });

  it('shows ACoS as unavailable (null), not 0%, when spend exists but sales are zero', () => {
    const campaigns = [campaign({ productId: 'coconut', impressions: 200, clicks: 5, spend: 3, orders: 0, sales: 0 })];
    const rows = buildProductPerformanceRows(campaigns, products);
    const coconut = rows.find((r) => r.productId === 'coconut')!;
    expect(coconut.acos).toBeNull();
  });

  it('computes ROAS as a well-defined 0 (not null) when spend exists but sales are zero', () => {
    expect(computeRoas(0, 5)).toBe(0);
  });

  it('leaves ROAS unavailable (null) when there is no spend at all', () => {
    expect(computeRoas(0, 0)).toBeNull();
  });

  it('excludes historical (non-current-period) campaigns from the rollup', () => {
    const campaigns = [
      campaign({ productId: 'rose', impressions: 1000, clicks: 40, spend: 20, isCurrentPeriod: true }),
      campaign({ productId: 'rose', impressions: 9999, clicks: 999, spend: 999, isCurrentPeriod: false }),
    ];
    const rows = buildProductPerformanceRows(campaigns, products);
    expect(rows.find((r) => r.productId === 'rose')!.impressions).toBe(1000);
  });

  it('returns a zeroed row (never fabricated) for a product with no current-period campaigns at all', () => {
    const rows = buildProductPerformanceRows([], products);
    const coconut = rows.find((r) => r.productId === 'coconut')!;
    expect(coconut.impressions).toBe(0);
    expect(coconut.spend).toBe(0);
    expect(coconut.acos).toBeNull();
    expect(coconut.roas).toBeNull();
  });
});
