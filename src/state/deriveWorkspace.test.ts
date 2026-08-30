import { describe, it, expect } from 'vitest';
import { buildWorkspace } from './deriveWorkspace';
import { DEFAULT_SETTINGS } from '../types';
import { EMPTY_ROWS } from './store';
import type {
  AccountNetProfitEntry, AdvertisedProductRow, CampaignRow, ReportImportMeta, SearchTermRow, SellerboardProductRow, TargetingRow,
} from '../types';

function campaignMeta(period: { start: string; end: string }): ReportImportMeta {
  return {
    id: 'c1', type: 'campaign', filename: 'c.csv', fileSizeBytes: 1, rowCount: 1, importedAt: new Date().toISOString(),
    requestedPeriod: period, observedPeriod: period, periodConfirmedManually: true, status: 'OK',
    detectedColumns: [], missingRequiredFields: [], missingOptionalFields: [],
  };
}

// Same shape as campaignMeta, but explicitly DEGRADED (some optional fields
// missing) — used to prove report-quality status never leaks into the
// reconciliation badge.
function degradedMeta(type: ReportImportMeta['type'], period: { start: string; end: string }): ReportImportMeta {
  return {
    id: `${type}-degraded`, type, filename: `${type}.csv`, fileSizeBytes: 1, rowCount: 1, importedAt: new Date().toISOString(),
    requestedPeriod: period, observedPeriod: period, periodConfirmedManually: true, status: 'DEGRADED',
    detectedColumns: [], missingRequiredFields: [], missingOptionalFields: ['status', 'budget', 'startDate', 'endDate'],
  };
}

describe('Account Net Profit period isolation (failure mode #5)', () => {
  it('never carries an older period\'s Account Net Profit into the current period', () => {
    const currentPeriod = { start: '2026-08-09', end: '2026-08-12' };
    const oldPeriod = { start: '2026-07-13', end: '2026-08-12' };

    const anpByPeriod: Record<string, AccountNetProfitEntry> = {
      [`${oldPeriod.start}_${oldPeriod.end}`]: {
        periodKey: `${oldPeriod.start}_${oldPeriod.end}`, period: oldPeriod, accountNetProfit: -163.94, enteredAt: '2026-08-12T00:00:00Z',
      },
    };

    const campaignRows: CampaignRow[] = [{ campaign: 'Rose', impressions: 100, clicks: 5, spend: 10, orders: 1, sales: 30, activityStart: currentPeriod.start, activityEnd: currentPeriod.end }];

    const ws = buildWorkspace(
      { campaign: campaignMeta(currentPeriod), targeting: campaignMeta(currentPeriod) },
      { ...EMPTY_ROWS, campaign: campaignRows },
      [],
      [],
      DEFAULT_SETTINGS,
      anpByPeriod,
    );

    expect(ws.currentPeriod).toEqual(currentPeriod);
    expect(ws.accountNetProfitEntry).toBeNull();
    expect(ws.kpis.accountNetProfit).toBeNull();
  });

  it('picks the correct entry when the current period does have one set', () => {
    const currentPeriod = { start: '2026-08-09', end: '2026-08-12' };
    const anpByPeriod: Record<string, AccountNetProfitEntry> = {
      [`${currentPeriod.start}_${currentPeriod.end}`]: {
        periodKey: `${currentPeriod.start}_${currentPeriod.end}`, period: currentPeriod, accountNetProfit: 120, enteredAt: '2026-08-12T00:00:00Z',
      },
    };
    const ws = buildWorkspace(
      { campaign: campaignMeta(currentPeriod), targeting: campaignMeta(currentPeriod) },
      EMPTY_ROWS,
      [],
      [],
      DEFAULT_SETTINGS,
      anpByPeriod,
    );
    expect(ws.kpis.accountNetProfit).toBe(120);
  });
});

describe('Business Overview traffic KPIs (Impressions/Clicks/CTR/Average CPC)', () => {
  it('matches the real Aug 14-16 observed activity exactly, with ACoS unavailable when sales are zero', () => {
    const period = { start: '2026-08-14', end: '2026-08-16' };
    const campaignRows: CampaignRow[] = [
      { campaign: 'Rose - Sponsored Products', impressions: 900, clicks: 5, spend: 6.10, orders: 0, sales: 0, activityStart: period.start, activityEnd: period.end },
      { campaign: 'Vanilla - Sponsored Products', impressions: 777, clicks: 3, spend: 3.28, orders: 0, sales: 0, activityStart: period.start, activityEnd: period.end },
    ];

    const ws = buildWorkspace(
      { campaign: campaignMeta(period), targeting: campaignMeta(period) },
      { ...EMPTY_ROWS, campaign: campaignRows },
      [],
      [],
      DEFAULT_SETTINGS,
      {},
    );

    expect(ws.currentPeriod).toEqual(period);
    expect(ws.kpis.impressions).toBe(1677);
    expect(ws.kpis.clicks).toBe(8);
    expect(ws.kpis.ppcSpend).toBeCloseTo(9.38);
    expect(ws.kpis.orders).toBe(0);
    expect(ws.kpis.attributedSales).toBe(0);

    // ACoS must be unavailable (null), never a misleading 0%, since sales are zero.
    expect(ws.kpis.acos).toBeNull();

    // CTR ~0.48%, Average CPC ~$1.17 (derived at display time from the same KPIs).
    const ctr = ws.kpis.clicks / ws.kpis.impressions;
    const cpc = ws.kpis.ppcSpend / ws.kpis.clicks;
    expect(ctr).toBeCloseTo(0.0048, 3);
    expect(cpc).toBeCloseTo(1.17, 2);
  });
});

describe('Dashboard reconciliation badge — single authoritative source, isolated from report quality', () => {
  it('shows DATA_RECONCILED when the financial checks reconcile, even though every report is DEGRADED (missing optional fields)', () => {
    const period = { start: '2026-08-14', end: '2026-08-17' };

    const campaignRows: CampaignRow[] = [
      { campaign: 'Coconut - Sponsored Products', impressions: 6131, clicks: 18, spend: 23.88, orders: 0, sales: 0, activityStart: period.start, activityEnd: period.end },
    ];
    const targetingRows: TargetingRow[] = [
      { campaign: 'Coconut - Sponsored Products', adGroup: 'Coconut AG', targetingText: 'coconut oil moisturizer', matchType: 'BROAD', bid: null, impressions: 6131, clicks: 18, spend: 23.88, orders: 0, sales: 0, activityStart: period.start, activityEnd: period.end },
    ];
    const searchTermRows: SearchTermRow[] = [
      { campaign: 'Coconut - Sponsored Products', adGroup: 'Coconut AG', searchTerm: 'coconut oil', targetingText: 'coconut oil moisturizer', matchType: 'BROAD', impressions: 5532, clicks: 18, spend: 23.88, orders: 0, sales: 0, activityStart: period.start, activityEnd: period.end },
    ];
    const advertisedProductRows: AdvertisedProductRow[] = [
      { campaign: 'Coconut - Sponsored Products', adGroup: 'Coconut AG', asin: 'B0GZVGXXS2', impressions: 6131, clicks: 18, spend: 23.88, orders: 0, sales: 0, activityStart: period.start, activityEnd: period.end },
    ];
    // Sellerboard's raw, signed expense (-23.88) — untouched, exactly as the
    // parser would produce it. Aggregation (unchanged by this fix) is what
    // normalizes this to a comparable magnitude before reconciliation runs.
    const sellerboardRows: SellerboardProductRow[] = [
      { date: period.start, marketplace: 'US', asin: 'B0GZVGXXS2', sku: 'COCO-001', salesOrganic: 10, salesPpc: 0, salesSponsoredProducts: 0, promotions: 0, amazonFees: 5.09, cogs: 2.91, refundCost: 0, adSpend: -23.88, units: 0, orders: 0, netProfit: null },
    ];

    const ws = buildWorkspace(
      {
        campaign: degradedMeta('campaign', period),
        targeting: degradedMeta('targeting', period),
        searchTerm: degradedMeta('searchTerm', period),
        advertisedProduct: degradedMeta('advertisedProduct', period),
        sellerboardProduct: degradedMeta('sellerboardProduct', period),
      },
      { ...EMPTY_ROWS, campaign: campaignRows, targeting: targetingRows, searchTerm: searchTermRows, advertisedProduct: advertisedProductRows, sellerboardProduct: sellerboardRows },
      [],
      [],
      DEFAULT_SETTINGS,
      {},
    );

    // The financial/data reconciliation badge must read DATA_RECONCILED —
    // report quality (DEGRADED, set on every report's own meta above) is a
    // completely separate signal and must never demote this status. Its
    // type (DashboardReconciliationStatus) cannot even represent 'DEGRADED'.
    expect(ws.reconciliation.status).toBe('DATA_RECONCILED');
    expect(ws.reconciliation.checks.every((c) => c.status !== 'DATA_MISMATCH_REVIEW_REQUIRED')).toBe(true);
  });

  it('shows INSUFFICIENT_DATA (never a falsely reassuring DATA_RECONCILED) when the Targeting report has not been uploaded at all', () => {
    const period = { start: '2026-08-14', end: '2026-08-17' };
    const campaignRows: CampaignRow[] = [
      { campaign: 'Coconut - Sponsored Products', impressions: 6131, clicks: 18, spend: 23.88, orders: 0, sales: 0, activityStart: period.start, activityEnd: period.end },
    ];
    const ws = buildWorkspace(
      { campaign: campaignMeta(period) },
      { ...EMPTY_ROWS, campaign: campaignRows },
      [],
      [],
      DEFAULT_SETTINGS,
      {},
    );
    expect(ws.reconciliation.status).toBe('INSUFFICIENT_DATA');
  });
});
