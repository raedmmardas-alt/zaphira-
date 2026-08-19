import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HeliumImportSource } from '../types/helium';

// Helium keyword sources must persist through the app's existing
// browser-only IndexedDB model (idb-keyval, via lib/storage/db.ts) exactly
// like every other report. Real IndexedDB isn't available in the jsdom test
// environment, so localDb is replaced with an in-memory stand-in here —
// DB_KEYS itself stays real, so this still verifies the actual persisted
// key and the actual hydrate()/remove wiring in store.ts, not a rewritten
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

function sampleSource(id: string, filename: string, keyword: string): HeliumImportSource {
  return {
    meta: {
      id, filename, fileSizeBytes: 4096, rowCount: 1, importedAt: '2026-08-19T00:00:00.000Z',
      status: 'OK', detectedColumns: ['Keyword Phrase'], missingRequiredFields: [], missingOptionalFields: [],
    },
    rows: [{
      keyword, searchVolume: 1672, organicRank: 8, sponsoredRank: 4, competingProducts: 800,
      titleDensity: 3, cerebroIqScore: 61, cpr: 14, suggestedBid: 0.9, keywordSales: null, searchVolumeTrend: null,
      competitorAsin: 'B0GZVGXXS2', sourceId: id,
    }],
  };
}

describe('Helium keyword source persistence (browser-only IndexedDB model)', () => {
  beforeEach(async () => {
    // Each test starts from a clean slate in both the in-memory store and
    // the mocked persisted storage (the mock's in-memory Map otherwise
    // survives across tests in this file, since the mock factory only runs
    // once).
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');
    useAppStore.setState({ heliumSources: [] });
    await localDb.del(DB_KEYS.heliumKeywordImport);
  });

  it('re-hydrates previously persisted Helium sources back into state after a simulated reload', async () => {
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');
    const sources = [sampleSource('s1', 'cerebro_a.csv', 'coconut body butter'), sampleSource('s2', 'cerebro_b.csv', 'coconut body butter')];

    await localDb.set(DB_KEYS.heliumKeywordImport, sources);
    expect(useAppStore.getState().heliumSources).toEqual([]); // not yet loaded into this session

    await useAppStore.getState().hydrate();

    expect(useAppStore.getState().heliumSources).toEqual(sources);
  });

  it('starts with no Helium sources when nothing was ever persisted', async () => {
    const { useAppStore } = await import('./store');
    await useAppStore.getState().hydrate();
    expect(useAppStore.getState().heliumSources).toEqual([]);
  });

  it('removeHeliumKeywordSource removes only the targeted source from both state and persisted storage', async () => {
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');
    const sources = [sampleSource('s1', 'cerebro_a.csv', 'coconut body butter'), sampleSource('s2', 'cerebro_b.csv', 'rose body butter')];

    await localDb.set(DB_KEYS.heliumKeywordImport, sources);
    await useAppStore.getState().hydrate();
    expect(useAppStore.getState().heliumSources).toHaveLength(2);

    useAppStore.getState().removeHeliumKeywordSource('s1');

    expect(useAppStore.getState().heliumSources).toHaveLength(1);
    expect(useAppStore.getState().heliumSources[0].meta.id).toBe('s2');
    const persisted = await localDb.get<HeliumImportSource[]>(DB_KEYS.heliumKeywordImport);
    expect(persisted).toHaveLength(1);
    expect(persisted![0].meta.id).toBe('s2');

    // Simulate a reload: hydrate() again should reflect the removal.
    await useAppStore.getState().hydrate();
    expect(useAppStore.getState().heliumSources).toHaveLength(1);
  });

  it('removing the last source leaves an empty array, not a fabricated single-source shape', async () => {
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');
    await localDb.set(DB_KEYS.heliumKeywordImport, [sampleSource('s1', 'cerebro_a.csv', 'coconut body butter')]);
    await useAppStore.getState().hydrate();

    useAppStore.getState().removeHeliumKeywordSource('s1');

    expect(useAppStore.getState().heliumSources).toEqual([]);
    expect(await localDb.get(DB_KEYS.heliumKeywordImport)).toEqual([]);
  });

  it('treats a non-array value found in storage (e.g. an old shape) as no sources loaded, rather than guessing', async () => {
    const { useAppStore } = await import('./store');
    const { localDb, DB_KEYS } = await import('../lib/storage/db');
    await localDb.set(DB_KEYS.heliumKeywordImport, { meta: {}, rows: [] } as unknown);

    await useAppStore.getState().hydrate();

    expect(useAppStore.getState().heliumSources).toEqual([]);
  });

  it('refuses to add a 5th source, enforcing the 1-4 file limit even if called directly (not just via the hidden UI control)', async () => {
    const { useAppStore } = await import('./store');
    const fourSources = [
      sampleSource('s1', 'a.csv', 'k1'), sampleSource('s2', 'b.csv', 'k2'),
      sampleSource('s3', 'c.csv', 'k3'), sampleSource('s4', 'd.csv', 'k4'),
    ];
    useAppStore.setState({ heliumSources: fourSources });

    await expect(useAppStore.getState().addHeliumKeywordFile({} as File)).rejects.toThrow(/Maximum 4/);
    expect(useAppStore.getState().heliumSources).toHaveLength(4);
  });
});
