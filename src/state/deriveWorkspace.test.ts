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
