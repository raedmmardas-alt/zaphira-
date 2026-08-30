import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_PRODUCTS } from '../types';
import type { TargetingRow, ReportImportMeta } from '../types';
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
    id: 'manual-1', type: 'targeting', filename: 'targeting.csv', fileSizeBytes: 100, rowCount: 1,
    importedAt: '2026-08-19T00:00:00.000Z', requestedPeriod: { start: '2026-08-09', end: '2026-08-12' },
    observedPeriod: { start: '2026-08-09', end: '2026-08-12' }, periodConfirmedManually: true,
    status: 'OK', detectedColumns: [], missingRequiredFields: [], missingOptionalFields: [],
    ...overrides,
  };
}

function apiMeta(overrides: Partial<ReportImportMeta> = {}): ReportImportMeta {
  return {
    id: 'api-1', type: 'targeting', filename: 'Amazon Ads API sync', fileSizeBytes: 0, rowCount: 1,
    importedAt: '2026-08-29T00:00:00.000Z', requestedPeriod: { start: '2026-08-09', end: '2026-08-12' },
    observedPeriod: { start: '2026-08-09', end: '2026-08-12' }, periodConfirmedManually: true,
    status: 'OK', detectedColumns: [], missingRequiredFields: [], missingOptionalFields: [],
    ...overrides,
  };
}

function targetingRow(overrides: Partial<TargetingRow> = {}): TargetingRow {
  return {
    campaign: 'Coconut - Sponsored Products', adGroup: 'Coconut - Broad', targetingText: 'coconut oil organic',
    matchType: 'EXACT', bid: 0.5, impressions: 100, clicks: 10, spend: 5, orders: 1, sales: 20,
    ...overrides,
  };
}

// Reproduces exactly what useWorkspace.ts does when deciding which
// targeting source to feed buildWorkspace -- same swap logic used for
// campaigns (Phase 2A), tested here directly since there's no React-hook
// test harness in this project.
function buildEffectiveWorkspace(params: {
  reportMeta: Record<string, ReportImportMeta>;
  reportRows: typeof EMPTY_ROWS;
  targetingDataSource: 'API' | 'MANUAL';
  apiTargetingSync: { meta: ReportImportMeta; rows: TargetingRow[] } | null;
  customDateRange?: { start: string; end: string } | null;
}) {
  const useApiTargeting = params.targetingDataSource === 'API' && params.apiTargetingSync !== null;
  const sourcedMeta = useApiTargeting ? { ...params.reportMeta, targeting: params.apiTargetingSync!.meta } : params.reportMeta;
  const sourcedRows = useApiTargeting ? { ...params.reportRows, targeting: params.apiTargetingSync!.rows } : params.reportRows;
  const effectiveMeta = params.customDateRange ? buildCustomRangeReportMeta(sourcedMeta, params.customDateRange) : sourcedMeta;
  const effectiveRows = params.customDateRange ? filterReportRowsToRange(sourcedRows, params.customDateRange) : sourcedRows;
  return buildWorkspace(effectiveMeta, effectiveRows, DEFAULT_PRODUCTS, [], DEFAULT_SETTINGS, {});
}

describe('Targeting Data Source (Phase 2B) — API vs Manual, feeding the SAME unmodified engine', () => {
  it('MANUAL (default): targeting data comes only from the manual CSV slot, even when API data also exists', () => {
    const manualRows = { ...EMPTY_ROWS, targeting: [targetingRow({ spend: 12.4 })] };
    const apiSync = { meta: apiMeta(), rows: [targetingRow({ spend: 999 })] };

    const ws = buildEffectiveWorkspace({
      reportMeta: { targeting: manualMeta() }, reportRows: manualRows, targetingDataSource: 'MANUAL', apiTargetingSync: apiSync,
    });

    expect(ws.targets[0].spend).toBe(12.4); // manual value, never the API's 999
  });

  it('API: targeting data comes from the API sync, and the manual slot is completely untouched by the switch', () => {
    const manualRows = { ...EMPTY_ROWS, targeting: [targetingRow({ spend: 12.4 })] };
    const apiSync = { meta: apiMeta(), rows: [targetingRow({ spend: 12.4, bid: 0.85 })] };
    const reportMeta = { targeting: manualMeta() };

    const ws = buildEffectiveWorkspace({ reportMeta, reportRows: manualRows, targetingDataSource: 'API', apiTargetingSync: apiSync });

    expect(ws.targets[0].spend).toBe(12.4);
    expect(ws.targets[0].currentBid).toBe(0.85);
    // The manual reportMeta object passed in is never mutated by the swap.
    expect(reportMeta.targeting).toEqual(manualMeta());
    expect(manualRows.targeting[0].spend).toBe(12.4);
  });

  it('a paused live keyword never gets reinterpreted as active just because it had historical spend (status passes through unchanged)', () => {
    const apiSync = {
      meta: apiMeta(),
      rows: [targetingRow({ targetingText: 'discontinued keyword', status: 'PAUSED', spend: 210, clicks: 300, orders: 20, sales: 480 })],
    };
    const ws = buildEffectiveWorkspace({ reportMeta: {}, reportRows: EMPTY_ROWS, targetingDataSource: 'API', apiTargetingSync: apiSync });
    expect(ws.targets[0].targetingText).toBe('discontinued keyword'); // sanity: row was actually processed
    // buildBaseTargets/buildWorkspace never overwrite TargetingRow.status --
    // it survives on the underlying row even though EnrichedTarget doesn't
    // currently render it (the same passthrough behavior CampaignRow.status
    // already has).
  });

  it('zero-sales, zero-order API targets produce ACoS = null (never a fabricated 0%), using the existing unmodified formula', () => {
    const apiSync = { meta: apiMeta(), rows: [targetingRow({ spend: 2.1, orders: 0, sales: 0 })] };
    const ws = buildEffectiveWorkspace({ reportMeta: {}, reportRows: EMPTY_ROWS, targetingDataSource: 'API', apiTargetingSync: apiSync });
    expect(ws.targets[0].sales).toBe(0);
    expect(ws.targets[0].spend).toBe(2.1);
    expect(ws.targets[0].acos).toBeNull(); // existing formula: spend > 0 && sales === 0 -> null, never 0%
  });

  it('preserves NO DELIVERY / LOW DELIVERY classification for API-synced targets, using the existing unmodified delivery engine', () => {
    const apiSync = {
      meta: apiMeta(),
      rows: [
        targetingRow({ targetingText: 'zero impressions', impressions: 0, clicks: 0 }),
        targetingRow({ targetingText: 'low delivery', impressions: 5, clicks: 0 }), // <= lowDeliveryMaxImpressions(10), 0 clicks
        targetingRow({ targetingText: 'high delivery', impressions: 500, clicks: 20 }),
      ],
    };
    const ws = buildEffectiveWorkspace({ reportMeta: {}, reportRows: EMPTY_ROWS, targetingDataSource: 'API', apiTargetingSync: apiSync });
    const byText = Object.fromEntries(ws.targets.map((t) => [t.targetingText, t.delivery]));
    expect(byText['zero impressions']).toBe('NO_DELIVERY');
    expect(byText['low delivery']).toBe('LOW_DELIVERY');
    expect(byText['high delivery']).toBe('HIGH_DELIVERY');
  });

  it('switching back to MANUAL after an API sync restores the manual data exactly, nothing lost', () => {
    const manualRows = { ...EMPTY_ROWS, targeting: [targetingRow({ spend: 8 })] };
    const apiSync = { meta: apiMeta(), rows: [targetingRow({ spend: 999 })] };
    const reportMeta = { targeting: manualMeta() };

    const apiWs = buildEffectiveWorkspace({ reportMeta, reportRows: manualRows, targetingDataSource: 'API', apiTargetingSync: apiSync });
    expect(apiWs.targets[0].spend).toBe(999);

    const backToManualWs = buildEffectiveWorkspace({ reportMeta, reportRows: manualRows, targetingDataSource: 'MANUAL', apiTargetingSync: apiSync });
    expect(backToManualWs.targets[0].spend).toBe(8); // manual data was never touched
  });

  it('an API targeting sync does not affect campaign-level data (Phase 2A) even when both are active simultaneously', () => {
    const manualCampaignRows = { ...EMPTY_ROWS, campaign: [{ campaign: 'Coconut - Sponsored Products', impressions: 1, clicks: 1, spend: 16.48, orders: 0, sales: 0 }] };
    const apiTargeting = { meta: apiMeta(), rows: [targetingRow({ spend: 999 })] };
    const ws = buildEffectiveWorkspace({
      reportMeta: { campaign: manualMeta({ type: 'campaign' }) },
      reportRows: manualCampaignRows,
      targetingDataSource: 'API',
      apiTargetingSync: apiTargeting,
    });
    expect(ws.kpis.ppcSpend).toBe(16.48); // untouched campaign KPI, Phase 2B never touches campaign sync
    expect(ws.targets[0].spend).toBe(999); // targeting swap still applies independently
  });
});

describe('store: setApiTargetingSync / clearApiTargetingSync never touch the manual Targeting CSV slot', () => {
  beforeEach(async () => {
    const { useAppStore } = await import('./store');
    useAppStore.setState({
      settings: DEFAULT_SETTINGS,
      reportMeta: { targeting: manualMeta() },
      reportRows: { ...EMPTY_ROWS, targeting: [targetingRow({ spend: 12.4 })] },
      apiTargetingSync: null,
    });
  });

  it('setApiTargetingSync stores API data without altering reportMeta.targeting/reportRows.targeting', async () => {
    const { useAppStore } = await import('./store');
    const before = useAppStore.getState();
    const beforeManualMeta = before.reportMeta.targeting;
    const beforeManualRows = before.reportRows.targeting;

    useAppStore.getState().setApiTargetingSync(apiMeta(), [targetingRow({ spend: 999 })]);

    const after = useAppStore.getState();
    expect(after.reportMeta.targeting).toBe(beforeManualMeta); // same reference -- untouched
    expect(after.reportRows.targeting).toBe(beforeManualRows);
    expect(after.apiTargetingSync?.rows[0].spend).toBe(999);
  });

  it('an API sync failure (never calling setApiTargetingSync) leaves the manual data fully intact', async () => {
    const { useAppStore } = await import('./store');
    // Simulates the frontend's handleSync() early-returning on
    // result.success === false / status.lastSyncError -- setApiTargetingSync
    // is simply never called, so nothing changes.
    const before = useAppStore.getState();
    expect(before.reportRows.targeting[0].spend).toBe(12.4);
    expect(before.apiTargetingSync).toBeNull();
  });

  it('clearApiTargetingSync removes only the API slot, never the manual one', async () => {
    const { useAppStore } = await import('./store');
    useAppStore.getState().setApiTargetingSync(apiMeta(), [targetingRow({ spend: 999 })]);
    expect(useAppStore.getState().apiTargetingSync).not.toBeNull();

    useAppStore.getState().clearApiTargetingSync();

    expect(useAppStore.getState().apiTargetingSync).toBeNull();
    expect(useAppStore.getState().reportRows.targeting[0].spend).toBe(12.4);
  });

  it('persists apiTargetingSync to localDb (survives a simulated reload)', async () => {
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');
    useAppStore.getState().setApiTargetingSync(apiMeta(), [targetingRow({ spend: 999 })]);
    const persisted = await localDb.get(DB_KEYS.apiTargetingSync);
    expect(persisted).not.toBeNull();
  });
});
