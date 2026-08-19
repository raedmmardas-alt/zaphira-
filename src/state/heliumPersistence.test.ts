import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HeliumImportState } from './store';
import type { HeliumRawKeywordRow } from '../types/helium';

// The Helium keyword import must persist through the app's existing
// browser-only IndexedDB model (idb-keyval, via lib/storage/db.ts) exactly
// like every other report. Real IndexedDB isn't available in the jsdom test
// environment, so localDb is replaced with an in-memory stand-in here —
// DB_KEYS itself stays real, so this still verifies the actual persisted
// key and the actual hydrate()/delete wiring in store.ts, not a rewritten
// version of it.
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

function sampleRow(): HeliumRawKeywordRow {
  return {
    keyword: 'coconut body butter', searchVolume: 1672, organicRank: 8, sponsoredRank: 4, competingProducts: 800,
    titleDensity: 3, cerebroIqScore: 61, cpr: 14, suggestedBid: 0.9, keywordSales: null, searchVolumeTrend: null,
    competitorAsin: 'B0GZVGXXS2',
  };
}

function sampleImport(): HeliumImportState {
  return {
    meta: {
      id: 'helium-1', filename: 'cerebro_export.csv', fileSizeBytes: 4096, rowCount: 1,
      importedAt: '2026-08-19T00:00:00.000Z', status: 'OK', detectedColumns: ['Keyword Phrase'],
      missingRequiredFields: [], missingOptionalFields: [],
    },
    rows: [sampleRow()],
  };
}

describe('Helium keyword import persistence (browser-only IndexedDB model)', () => {
  beforeEach(async () => {
    // Each test starts from a clean slate in both the in-memory store and
    // the mocked persisted storage (the mock's in-memory Map otherwise
    // survives across tests in this file, since the mock factory only runs
    // once).
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');
    useAppStore.setState({ heliumImport: null });
    await localDb.del(DB_KEYS.heliumKeywordImport);
  });

  it('re-hydrates a previously persisted Helium import back into state after a simulated reload', async () => {
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');

    await localDb.set(DB_KEYS.heliumKeywordImport, sampleImport());
    expect(useAppStore.getState().heliumImport).toBeNull(); // not yet loaded into this session

    await useAppStore.getState().hydrate();

    expect(useAppStore.getState().heliumImport).toEqual(sampleImport());
  });

  it('starts with no Helium import when nothing was ever persisted', async () => {
    const { useAppStore } = await import('./store');
    await useAppStore.getState().hydrate();
    expect(useAppStore.getState().heliumImport).toBeNull();
  });

  it('deleteHeliumKeywordImport clears both in-memory state and persisted storage, so a later reload stays empty', async () => {
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');

    await localDb.set(DB_KEYS.heliumKeywordImport, sampleImport());
    await useAppStore.getState().hydrate();
    expect(useAppStore.getState().heliumImport).not.toBeNull();

    useAppStore.getState().deleteHeliumKeywordImport();
    expect(useAppStore.getState().heliumImport).toBeNull();
    expect(await localDb.get(DB_KEYS.heliumKeywordImport)).toBeUndefined();

    // Simulate a reload: hydrate() again should find nothing.
    await useAppStore.getState().hydrate();
    expect(useAppStore.getState().heliumImport).toBeNull();
  });
});
