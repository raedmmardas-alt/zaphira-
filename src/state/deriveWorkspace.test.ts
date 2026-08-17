import { describe, it, expect } from 'vitest';
import { buildWorkspace } from './deriveWorkspace';
import { DEFAULT_SETTINGS } from '../types';
import { EMPTY_ROWS } from './store';
import type { AccountNetProfitEntry, CampaignRow, ReportImportMeta } from '../types';

function campaignMeta(period: { start: string; end: string }): ReportImportMeta {
  return {
    id: 'c1', type: 'campaign', filename: 'c.csv', fileSizeBytes: 1, rowCount: 1, importedAt: new Date().toISOString(),
    requestedPeriod: period, observedPeriod: period, periodConfirmedManually: true, status: 'OK',
    detectedColumns: [], missingRequiredFields: [], missingOptionalFields: [],
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
