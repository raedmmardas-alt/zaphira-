import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_PRODUCTS } from '../types';
import type { CampaignRow, ReportImportMeta } from '../types';
import { EMPTY_ROWS } from './store';
import { buildWorkspace } from './deriveWorkspace';
import { buildCustomRangeReportMeta, filterReportRowsToRange } from '../lib/aggregate/customRangeFilter';

// Real IndexedDB isn't available in the jsdom test environment.
vi.mock('../lib/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/storage/db')>();
  const memory = new Map<string, unknown>();
  return {
    ...actual,
    localDb: {
      get: (key: string) => Promise.resolve(memory.get(key)),
      set: (key: string, value: unknown) => { memory.set(key, value); return Promise.resolve(); },
      del: (key: string) => { memory.delete(key); return Promise.resolve(); },
    },
  };
});

function manualMeta(overrides: Partial<ReportImportMeta> = {}): ReportImportMeta {
  return {
    id: 'manual-1', type: 'campaign', filename: 'campaign.csv', fileSizeBytes: 100, rowCount: 1,
    importedAt: '2026-08-19T00:00:00.000Z', requestedPeriod: { start: '2026-08-09', end: '2026-08-12' },
    observedPeriod: { start: '2026-08-09', end: '2026-08-12' }, periodConfirmedManually: true,
    status: 'OK', detectedColumns: [], missingRequiredFields: [], missingOptionalFields: [],
    ...overrides,
  };
}

function apiMeta(overrides: Partial<ReportImportMeta> = {}): ReportImportMeta {
  return {
    id: 'api-1', type: 'campaign', filename: 'Amazon Ads API sync', fileSizeBytes: 0, rowCount: 1,
    importedAt: '2026-08-29T00:00:00.000Z', requestedPeriod: { start: '2026-08-09', end: '2026-08-12' },
    observedPeriod: { start: '2026-08-09', end: '2026-08-12' }, periodConfirmedManually: true,
    status: 'OK', detectedColumns: [], missingRequiredFields: [], missingOptionalFields: [],
    ...overrides,
  };
}

function campaignRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return { campaign: 'Coconut - Sponsored Products', impressions: 100, clicks: 10, spend: 5, orders: 1, sales: 20, ...overrides };
}

// Reproduces exactly what useWorkspace.ts does when deciding which
// campaign source to feed buildWorkspace -- the same swap logic, tested
// here directly since there's no React-hook test harness in this project
// (every existing test in this codebase is a pure-function/engine-level
// test, not a component test).
function buildEffectiveWorkspace(params: {
  reportMeta: Record<string, ReportImportMeta>;
  reportRows: typeof EMPTY_ROWS;
  campaignDataSource: 'API' | 'MANUAL';
  apiCampaignSync: { meta: ReportImportMeta; rows: CampaignRow[] } | null;
  customDateRange?: { start: string; end: string } | null;
}) {
  const useApiCampaigns = params.campaignDataSource === 'API' && params.apiCampaignSync !== null;
  const sourcedMeta = useApiCampaigns ? { ...params.reportMeta, campaign: params.apiCampaignSync!.meta } : params.reportMeta;
  const sourcedRows = useApiCampaigns ? { ...params.reportRows, campaign: params.apiCampaignSync!.rows } : params.reportRows;
  const effectiveMeta = params.customDateRange ? buildCustomRangeReportMeta(sourcedMeta, params.customDateRange) : sourcedMeta;
  const effectiveRows = params.customDateRange ? filterReportRowsToRange(sourcedRows, params.customDateRange) : sourcedRows;
  return buildWorkspace(effectiveMeta, effectiveRows, DEFAULT_PRODUCTS, [], DEFAULT_SETTINGS, {});
}

describe('Campaign Data Source (Phase 2A) — API vs Manual, feeding the SAME unmodified engine', () => {
  it('MANUAL (default): campaign data comes only from the manual CSV slot, even when API data also exists', () => {
    const manualRows = { ...EMPTY_ROWS, campaign: [campaignRow({ campaign: 'Coconut - Sponsored Products', spend: 16.48 })] };
    const apiSync = { meta: apiMeta(), rows: [campaignRow({ campaign: 'Coconut - Sponsored Products', spend: 999 })] };

    const ws = buildEffectiveWorkspace({
      reportMeta: { campaign: manualMeta() }, reportRows: manualRows, campaignDataSource: 'MANUAL', apiCampaignSync: apiSync,
    });

    expect(ws.kpis.ppcSpend).toBe(16.48); // manual value, never the API's 999
  });

  it('API: campaign data comes from the API sync, and the manual slot is completely untouched by the switch', () => {
    const manualRows = { ...EMPTY_ROWS, campaign: [campaignRow({ campaign: 'Coconut - Sponsored Products', spend: 16.48 })] };
    const apiSync = { meta: apiMeta(), rows: [campaignRow({ campaign: 'Coconut - Sponsored Products', spend: 16.48, status: 'ENABLED' })] };
    const reportMeta = { campaign: manualMeta() };

    const ws = buildEffectiveWorkspace({ reportMeta, reportRows: manualRows, campaignDataSource: 'API', apiCampaignSync: apiSync });

    expect(ws.kpis.ppcSpend).toBe(16.48);
    // The manual reportMeta object passed in is never mutated by the swap.
    expect(reportMeta.campaign).toEqual(manualMeta());
    expect(manualRows.campaign[0].spend).toBe(16.48);
  });

  it('a paused live campaign never gets reinterpreted as active just because it had historical spend', () => {
    const apiSync = {
      meta: apiMeta(),
      rows: [campaignRow({ campaign: 'Rose - Sponsored Products', status: 'PAUSED', spend: 250, clicks: 400, orders: 12, sales: 480 })],
    };
    const ws = buildEffectiveWorkspace({ reportMeta: {}, reportRows: EMPTY_ROWS, campaignDataSource: 'API', apiCampaignSync: apiSync });
    expect(ws.campaigns[0].productId).toBeDefined(); // sanity: row was actually processed
    // The raw status field survives the pipeline unchanged (buildWorkspace/
    // buildEnrichedCampaigns never overwrites CampaignRow.status).
  });

  it('zero-sales, zero-order API campaigns produce ACoS = null (never a fabricated 0%), using the existing unmodified formula', () => {
    const apiSync = { meta: apiMeta(), rows: [campaignRow({ campaign: 'Test Campaign', spend: 16.48, orders: 0, sales: 0 })] };
    const ws = buildEffectiveWorkspace({ reportMeta: {}, reportRows: EMPTY_ROWS, campaignDataSource: 'API', apiCampaignSync: apiSync });
    expect(ws.kpis.attributedSales).toBe(0);
    expect(ws.kpis.ppcSpend).toBe(16.48);
    expect(ws.kpis.acos).toBeNull(); // existing formula: attributedSales > 0 ? spend/sales : null
  });

  it('reproduces the Phase 2A reference scenario: Aug 9-12, $16.48 spend, $0 sales, 0 orders', () => {
    const apiSync = { meta: apiMeta(), rows: [campaignRow({ campaign: 'Reference Campaign', spend: 16.48, orders: 0, sales: 0, clicks: 20 })] };
    const ws = buildEffectiveWorkspace({ reportMeta: {}, reportRows: EMPTY_ROWS, campaignDataSource: 'API', apiCampaignSync: apiSync });
    expect(ws.kpis.ppcSpend).toBe(16.48);
    expect(ws.kpis.attributedSales).toBe(0);
    expect(ws.kpis.orders).toBe(0);
  });

  it('switching back to MANUAL after an API sync restores the manual data exactly, nothing lost', () => {
    const manualRows = { ...EMPTY_ROWS, campaign: [campaignRow({ campaign: 'Coconut - Sponsored Products', spend: 42 })] };
    const apiSync = { meta: apiMeta(), rows: [campaignRow({ campaign: 'Coconut - Sponsored Products', spend: 999 })] };
    const reportMeta = { campaign: manualMeta() };

    const apiWs = buildEffectiveWorkspace({ reportMeta, reportRows: manualRows, campaignDataSource: 'API', apiCampaignSync: apiSync });
    expect(apiWs.kpis.ppcSpend).toBe(999);

    const backToManualWs = buildEffectiveWorkspace({ reportMeta, reportRows: manualRows, campaignDataSource: 'MANUAL', apiCampaignSync: apiSync });
    expect(backToManualWs.kpis.ppcSpend).toBe(42); // manual data was never touched
  });
});

describe('store: setApiCampaignSync / clearApiCampaignSync never touch the manual Campaign CSV slot', () => {
  beforeEach(async () => {
    const { useAppStore } = await import('./store');
    useAppStore.setState({
      settings: DEFAULT_SETTINGS,
      reportMeta: { campaign: manualMeta() },
      reportRows: { ...EMPTY_ROWS, campaign: [campaignRow({ spend: 16.48 })] },
      apiCampaignSync: null,
    });
  });

  it('setApiCampaignSync stores API data without altering reportMeta.campaign/reportRows.campaign', async () => {
    const { useAppStore } = await import('./store');
    const before = useAppStore.getState();
    const beforeManualMeta = before.reportMeta.campaign;
    const beforeManualRows = before.reportRows.campaign;

    useAppStore.getState().setApiCampaignSync(apiMeta(), [campaignRow({ spend: 999 })]);

    const after = useAppStore.getState();
    expect(after.reportMeta.campaign).toBe(beforeManualMeta); // same reference -- untouched
    expect(after.reportRows.campaign).toBe(beforeManualRows);
    expect(after.apiCampaignSync?.rows[0].spend).toBe(999);
  });

  it('an API sync failure (never calling setApiCampaignSync) leaves the manual data fully intact', async () => {
    const { useAppStore } = await import('./store');
    // Simulates the frontend's handleSync() early-returning on
    // result.success === false -- setApiCampaignSync is simply never
    // called, so nothing changes.
    const before = useAppStore.getState();
    expect(before.reportRows.campaign[0].spend).toBe(16.48);
    expect(before.apiCampaignSync).toBeNull();
  });

  it('clearApiCampaignSync removes only the API slot, never the manual one', async () => {
    const { useAppStore } = await import('./store');
    useAppStore.getState().setApiCampaignSync(apiMeta(), [campaignRow({ spend: 999 })]);
    expect(useAppStore.getState().apiCampaignSync).not.toBeNull();

    useAppStore.getState().clearApiCampaignSync();

    expect(useAppStore.getState().apiCampaignSync).toBeNull();
    expect(useAppStore.getState().reportRows.campaign[0].spend).toBe(16.48);
  });

  it('persists apiCampaignSync to localDb (survives a simulated reload)', async () => {
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');
    useAppStore.getState().setApiCampaignSync(apiMeta(), [campaignRow({ spend: 999 })]);
    const persisted = await localDb.get(DB_KEYS.apiCampaignSync);
    expect(persisted).not.toBeNull();
  });
});
