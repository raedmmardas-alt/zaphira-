import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CampaignRow, ReportImportMeta } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { EMPTY_ROWS } from './store';
import type { ReportRowsByType } from './store';

// Real IndexedDB isn't available in the jsdom test environment, so localDb
// is replaced with an in-memory stand-in — DB_KEYS itself stays real, so
// this still verifies the actual persisted keys and hydrate()/action wiring
// in store.ts, not a rewritten version of it.
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

function campaignMeta(overrides: Partial<ReportImportMeta> = {}): ReportImportMeta {
  return {
    id: 'm1', type: 'campaign', filename: 'campaign.csv', fileSizeBytes: 100, rowCount: 1,
    importedAt: '2026-08-19T00:00:00.000Z', requestedPeriod: null, observedPeriod: { start: '2026-08-14', end: '2026-08-17' },
    periodConfirmedManually: false, status: 'OK', detectedColumns: [], missingRequiredFields: [], missingOptionalFields: [],
    ...overrides,
  };
}

function campaignRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return { campaign: 'Coconut - Sponsored Products', impressions: 100, clicks: 10, spend: 5, orders: 1, sales: 20, ...overrides };
}

function rowsWithCampaign(spend: number): ReportRowsByType {
  return { ...EMPTY_ROWS, campaign: [campaignRow({ spend })] };
}

describe('Marketplace + historical reporting period (real seller workflow)', () => {
  beforeEach(async () => {
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');
    useAppStore.setState({
      settings: DEFAULT_SETTINGS,
      reportMeta: {},
      reportRows: EMPTY_ROWS,
      reportSnapshots: [],
      customDateRange: null,
    });
    await Promise.all([
      localDb.del(DB_KEYS.reportSnapshots),
      localDb.del(DB_KEYS.customDateRange),
      localDb.del(DB_KEYS.reportImports),
      localDb.del(DB_KEYS.settings),
    ]);
  });

  it('(A) migrates existing pre-marketplace USA data into history on hydrate, without touching the active slot', async () => {
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');
    // Simulate a real pre-existing install: reportImports persisted, but no
    // reportSnapshots key at all (it didn't exist before this feature).
    await localDb.set(DB_KEYS.reportImports, { campaign: { meta: campaignMeta({ requestedPeriod: { start: '2026-08-14', end: '2026-08-17' } }), rows: [campaignRow()] } });

    await useAppStore.getState().hydrate();

    // Active slot loads exactly as it always did.
    expect(useAppStore.getState().reportMeta.campaign).toBeDefined();
    expect(useAppStore.getState().reportRows.campaign).toHaveLength(1);
    // AND it's now also backed into history as a US snapshot.
    const snapshots = useAppStore.getState().reportSnapshots;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].marketplace).toBe('US');
    expect(snapshots[0].period).toEqual({ start: '2026-08-14', end: '2026-08-17' });
  });

  it('(B) marketplace dropdown supports exactly USA, Canada, Mexico', async () => {
    const { SUPPORTED_MARKETPLACES } = await import('../types');
    expect(SUPPORTED_MARKETPLACES.map((m) => m.country).sort()).toEqual(['CA', 'MX', 'US']);
  });

  it('(C) switching to Canada with no Canada data empties the active slot (never shows USA data)', async () => {
    const { useAppStore } = await import('./store');
    useAppStore.setState({
      reportMeta: { campaign: campaignMeta() },
      reportRows: rowsWithCampaign(500),
    });

    useAppStore.getState().setActiveMarketplace('CA');

    expect(useAppStore.getState().settings.country).toBe('CA');
    expect(useAppStore.getState().settings.currency).toBe('CAD');
    expect(useAppStore.getState().reportMeta).toEqual({});
    expect(useAppStore.getState().reportRows).toEqual(EMPTY_ROWS);
  });

  it('(D) returning to USA restores the exact USA data, unchanged', async () => {
    const { useAppStore } = await import('./store');
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, country: 'US', currency: 'USD' },
      reportMeta: { campaign: campaignMeta({ requestedPeriod: { start: '2026-08-14', end: '2026-08-17' } }) },
      reportRows: rowsWithCampaign(123.45),
    });

    useAppStore.getState().setActiveMarketplace('CA'); // leave USA (auto-saves it)
    expect(useAppStore.getState().reportMeta).toEqual({});

    useAppStore.getState().setActiveMarketplace('US'); // return

    expect(useAppStore.getState().settings.country).toBe('US');
    expect(useAppStore.getState().settings.currency).toBe('USD');
    expect(useAppStore.getState().reportRows.campaign[0].spend).toBe(123.45);
  });

  it('(E) a second USA reporting period does not erase the first — both remain selectable', async () => {
    const { useAppStore } = await import('./store');
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, country: 'US' },
      reportMeta: { campaign: campaignMeta({ requestedPeriod: { start: '2026-08-14', end: '2026-08-17' } }) },
      reportRows: rowsWithCampaign(100),
    });

    useAppStore.getState().startNewReportingPeriod();
    expect(useAppStore.getState().reportMeta).toEqual({});

    useAppStore.setState({
      reportMeta: { campaign: campaignMeta({ requestedPeriod: { start: '2026-08-18', end: '2026-08-20' } }) },
      reportRows: rowsWithCampaign(200),
    });
    // confirmReportPeriod auto-saves the active data into reportSnapshots.
    useAppStore.getState().confirmReportPeriod('campaign', { start: '2026-08-18', end: '2026-08-20' });

    const usSnapshots = useAppStore.getState().reportSnapshots.filter((s) => s.marketplace === 'US' && s.period);
    expect(usSnapshots).toHaveLength(2);
    const periods = usSnapshots.map((s) => `${s.period!.start}_${s.period!.end}`).sort();
    expect(periods).toEqual(['2026-08-14_2026-08-17', '2026-08-18_2026-08-20']);
  });

  it('(F) switching between two saved USA periods changes the active dashboard data', async () => {
    const { useAppStore } = await import('./store');
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, country: 'US' } });

    useAppStore.setState({ reportMeta: { campaign: campaignMeta({ requestedPeriod: { start: '2026-08-14', end: '2026-08-17' } }) }, reportRows: rowsWithCampaign(111) });
    useAppStore.getState().confirmReportPeriod('campaign', { start: '2026-08-14', end: '2026-08-17' });
    useAppStore.getState().startNewReportingPeriod();

    useAppStore.setState({ reportMeta: { campaign: campaignMeta({ requestedPeriod: { start: '2026-08-18', end: '2026-08-20' } }) }, reportRows: rowsWithCampaign(222) });
    useAppStore.getState().confirmReportPeriod('campaign', { start: '2026-08-18', end: '2026-08-20' });

    expect(useAppStore.getState().reportRows.campaign[0].spend).toBe(222);

    const firstPeriodId = useAppStore.getState().reportSnapshots.find((s) => s.period?.start === '2026-08-14')!.id;
    useAppStore.getState().setActivePeriod(firstPeriodId);
    expect(useAppStore.getState().reportRows.campaign[0].spend).toBe(111);

    const secondPeriodId = useAppStore.getState().reportSnapshots.find((s) => s.period?.start === '2026-08-18')!.id;
    useAppStore.getState().setActivePeriod(secondPeriodId);
    expect(useAppStore.getState().reportRows.campaign[0].spend).toBe(222);
  });

  it('(G) uploading a replacement report for an existing period updates only that period, never duplicating it', async () => {
    const { useAppStore } = await import('./store');
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, country: 'US' } });

    useAppStore.setState({ reportMeta: { campaign: campaignMeta({ requestedPeriod: { start: '2026-08-14', end: '2026-08-17' } }) }, reportRows: rowsWithCampaign(100) });
    useAppStore.getState().confirmReportPeriod('campaign', { start: '2026-08-14', end: '2026-08-17' });
    expect(useAppStore.getState().reportSnapshots.filter((s) => s.marketplace === 'US')).toHaveLength(1);

    // Replacement upload for the SAME period (e.g. a corrected export).
    useAppStore.setState({ reportRows: rowsWithCampaign(999) });
    useAppStore.getState().confirmReportPeriod('campaign', { start: '2026-08-14', end: '2026-08-17' });

    const usSnapshots = useAppStore.getState().reportSnapshots.filter((s) => s.marketplace === 'US');
    expect(usSnapshots).toHaveLength(1); // never duplicated
    expect(usSnapshots[0].reportRows.campaign[0].spend).toBe(999); // updated in place
  });

  it('never mixes marketplaces: a Mexico snapshot never appears when Canada is active, and vice versa', async () => {
    const { useAppStore } = await import('./store');
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, country: 'CA', currency: 'CAD' } });
    useAppStore.setState({ reportMeta: { campaign: campaignMeta({ requestedPeriod: { start: '2026-08-14', end: '2026-08-17' } }) }, reportRows: rowsWithCampaign(1) });
    useAppStore.getState().confirmReportPeriod('campaign', { start: '2026-08-14', end: '2026-08-17' });

    useAppStore.getState().setActiveMarketplace('MX');
    expect(useAppStore.getState().reportMeta).toEqual({}); // no Canada data leaked into Mexico

    useAppStore.getState().setActiveMarketplace('CA');
    expect(useAppStore.getState().reportRows.campaign[0].spend).toBe(1); // Canada data intact
  });

  it('persists reportSnapshots to localDb (survives a simulated reload)', async () => {
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, country: 'US' } });
    useAppStore.setState({ reportMeta: { campaign: campaignMeta({ requestedPeriod: { start: '2026-08-14', end: '2026-08-17' } }) }, reportRows: rowsWithCampaign(50) });
    useAppStore.getState().confirmReportPeriod('campaign', { start: '2026-08-14', end: '2026-08-17' });

    const persisted = await localDb.get(DB_KEYS.reportSnapshots);
    expect(Array.isArray(persisted)).toBe(true);
    expect((persisted as unknown[]).length).toBeGreaterThan(0);
  });
});
