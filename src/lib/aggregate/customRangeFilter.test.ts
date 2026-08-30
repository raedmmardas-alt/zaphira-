import { describe, it, expect } from 'vitest';
import { assessCustomRangeSupport, filterReportRowsToRange, buildCustomRangeReportMeta } from './customRangeFilter';
import { EMPTY_ROWS } from '../../state/store';
import type { ReportRowsByType } from '../../state/store';
import type { CampaignRow, ReportImportMeta, SellerboardProductRow } from '../../types';

function campaignRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    campaign: 'Coconut - Sponsored Products', impressions: 100, clicks: 10, spend: 5, orders: 1, sales: 20,
    ...overrides,
  };
}

function sbProductRow(overrides: Partial<SellerboardProductRow> = {}): SellerboardProductRow {
  return {
    date: '2026-08-15', marketplace: 'US', asin: 'B0GZVGXXS2', sku: 'ZAP-COCO-2026',
    salesOrganic: 10, salesPpc: 5, salesSponsoredProducts: 5, promotions: 0, amazonFees: -3,
    cogs: -2, refundCost: 0, adSpend: -1, units: 1, orders: 1, netProfit: 4,
    ...overrides,
  };
}

function reportImportMeta(overrides: Partial<ReportImportMeta> = {}): ReportImportMeta {
  return {
    id: 'm1', type: 'campaign', filename: 'campaign.csv', fileSizeBytes: 100, rowCount: 1,
    importedAt: '2026-08-19T00:00:00.000Z', requestedPeriod: null, observedPeriod: { start: '2026-08-14', end: '2026-08-17' },
    periodConfirmedManually: false, status: 'OK', detectedColumns: [], missingRequiredFields: [], missingOptionalFields: [],
    ...overrides,
  };
}

describe('assessCustomRangeSupport — daily rows support a sub-range', () => {
  it('supports a custom range fully inside genuinely daily campaign rows', () => {
    const rows: ReportRowsByType = {
      ...EMPTY_ROWS,
      campaign: [
        campaignRow({ activityStart: '2026-08-14', activityEnd: '2026-08-14' }),
        campaignRow({ activityStart: '2026-08-15', activityEnd: '2026-08-15' }),
        campaignRow({ activityStart: '2026-08-16', activityEnd: '2026-08-16' }),
        campaignRow({ activityStart: '2026-08-17', activityEnd: '2026-08-17' }),
      ],
    };
    const result = assessCustomRangeSupport(rows, { start: '2026-08-15', end: '2026-08-16' });
    expect(result.supported).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('supports a custom range when every row already sits fully inside it (not just single-day rows)', () => {
    const rows: ReportRowsByType = {
      ...EMPTY_ROWS,
      campaign: [campaignRow({ activityStart: '2026-08-15', activityEnd: '2026-08-16' })],
    };
    const result = assessCustomRangeSupport(rows, { start: '2026-08-14', end: '2026-08-17' });
    expect(result.supported).toBe(true);
  });
});

describe('assessCustomRangeSupport — aggregated rows cannot be subdivided (never fabricate)', () => {
  it('rejects a sub-range when a row spans wider than the requested range', () => {
    const rows: ReportRowsByType = {
      ...EMPTY_ROWS,
      campaign: [campaignRow({ activityStart: '2026-08-14', activityEnd: '2026-08-17' })],
    };
    const result = assessCustomRangeSupport(rows, { start: '2026-08-15', end: '2026-08-16' });
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/2026-08-14 to 2026-08-17 as one aggregated period/);
    expect(result.reason).toMatch(/Upload a daily report/);
  });

  it('rejects a sub-range when rows have no date info at all', () => {
    const rows: ReportRowsByType = { ...EMPTY_ROWS, campaign: [campaignRow({})] };
    const result = assessCustomRangeSupport(rows, { start: '2026-08-15', end: '2026-08-16' });
    expect(result.supported).toBe(false);
  });

  it('rejects a sub-range when a row partially straddles the requested boundary', () => {
    const rows: ReportRowsByType = {
      ...EMPTY_ROWS,
      campaign: [campaignRow({ activityStart: '2026-08-13', activityEnd: '2026-08-15' })],
    };
    // Requested range starts mid-row -> the row can't be safely split.
    const result = assessCustomRangeSupport(rows, { start: '2026-08-14', end: '2026-08-17' });
    expect(result.supported).toBe(false);
  });

  it('rejects a sub-range when a Sellerboard Product row has a null date', () => {
    const rows: ReportRowsByType = { ...EMPTY_ROWS, sellerboardProduct: [sbProductRow({ date: null })] };
    const result = assessCustomRangeSupport(rows, { start: '2026-08-15', end: '2026-08-16' });
    expect(result.supported).toBe(false);
  });

  it('ignores report types with zero loaded rows — they never block a custom range', () => {
    const rows: ReportRowsByType = { ...EMPTY_ROWS, campaign: [campaignRow({ activityStart: '2026-08-15', activityEnd: '2026-08-15' })] };
    const result = assessCustomRangeSupport(rows, { start: '2026-08-15', end: '2026-08-15' });
    expect(result.supported).toBe(true);
  });
});

describe('filterReportRowsToRange', () => {
  it('keeps only rows fully inside the range, dropping rows entirely outside it', () => {
    const rows: ReportRowsByType = {
      ...EMPTY_ROWS,
      campaign: [
        campaignRow({ campaign: 'in-range', activityStart: '2026-08-15', activityEnd: '2026-08-15' }),
        campaignRow({ campaign: 'out-of-range', activityStart: '2026-08-20', activityEnd: '2026-08-20' }),
      ],
      sellerboardProduct: [sbProductRow({ date: '2026-08-15' }), sbProductRow({ date: '2026-08-20' })],
    };
    const filtered = filterReportRowsToRange(rows, { start: '2026-08-14', end: '2026-08-17' });
    expect(filtered.campaign).toHaveLength(1);
    expect(filtered.campaign[0].campaign).toBe('in-range');
    expect(filtered.sellerboardProduct).toHaveLength(1);
    expect(filtered.sellerboardProduct[0].date).toBe('2026-08-15');
  });

  it('never mutates the input arrays (pure)', () => {
    const rows: ReportRowsByType = { ...EMPTY_ROWS, campaign: [campaignRow({ activityStart: '2026-08-15', activityEnd: '2026-08-15' })] };
    const originalLength = rows.campaign.length;
    filterReportRowsToRange(rows, { start: '2026-08-15', end: '2026-08-15' });
    expect(rows.campaign).toHaveLength(originalLength);
  });
});

describe('buildCustomRangeReportMeta', () => {
  it('overrides requestedPeriod to the custom range for period-driving report types only', () => {
    const meta = {
      campaign: reportImportMeta({ type: 'campaign' }),
      targeting: reportImportMeta({ type: 'targeting' }),
      sellerboardProduct: reportImportMeta({ type: 'sellerboardProduct' }),
    };
    const range = { start: '2026-08-15', end: '2026-08-16' };
    const next = buildCustomRangeReportMeta(meta, range);
    expect(next.campaign!.requestedPeriod).toEqual(range);
    expect(next.targeting!.requestedPeriod).toEqual(range);
    // Not a period-driving type — left untouched.
    expect(next.sellerboardProduct!.requestedPeriod).toEqual(meta.sellerboardProduct.requestedPeriod);
  });

  it('never fabricates a meta entry for a report type that was never loaded', () => {
    const next = buildCustomRangeReportMeta({}, { start: '2026-08-15', end: '2026-08-16' });
    expect(next.campaign).toBeUndefined();
  });
});
