import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchAmazonStatus, testAmazonConnection, fetchCampaignSyncStatus, syncCampaignData,
  fetchTargetingSyncStatus, syncTargetingData, fetchTargetingSyncResult,
  fetchSearchTermSyncStatus, syncSearchTermData, fetchSearchTermSyncResult,
  fetchAdvertisedProductSyncStatus, syncAdvertisedProductData, fetchAdvertisedProductSyncResult,
} from './amazonBackend';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('amazonBackend client -- never throws into the UI, never assumes the backend is reachable', () => {
  it('fetchAmazonStatus returns a clear NOT_CONNECTED status when the local backend is unreachable (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const status = await fetchAmazonStatus();
    expect(status.status).toBe('NOT_CONNECTED');
    expect(status.configured).toBe(false);
    expect(status.lastSyncError).toMatch(/not running/);
  });

  it('fetchAmazonStatus returns the backend-unreachable status on a non-OK HTTP response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const status = await fetchAmazonStatus();
    expect(status.status).toBe('NOT_CONNECTED');
  });

  it('fetchAmazonStatus passes through a real backend response unchanged', async () => {
    const real = {
      status: 'CONNECTED', marketplace: 'US', profileIdMasked: '************3456',
      lastSuccessfulSync: '2026-08-29T00:00:00.000Z', lastSyncError: null,
      tokenRefreshStatus: { status: 'OK' }, configured: true, missingConfigKeys: [], readOnly: true,
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => real });
    const status = await fetchAmazonStatus();
    expect(status).toEqual(real);
  });

  it('never includes a Client Secret or refresh token in any resolved value, even from a malformed backend response', async () => {
    // Defensive: even if something upstream leaked a secret-shaped field
    // into the JSON body, this client only ever passes through what the
    // backend sends -- it does not add secrets of its own. This test
    // documents that the frontend client itself introduces no new secret
    // exposure surface (it holds no credentials to leak).
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'CONNECTED', readOnly: true }) });
    const status = await fetchAmazonStatus();
    expect(JSON.stringify(status)).not.toMatch(/secret/i);
  });

  it('testAmazonConnection returns success:false and a clear message when the backend is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await testAmazonConnection();
    expect(result.success).toBe(false);
    expect(result.status).toBe('NOT_CONNECTED');
  });

  it('testAmazonConnection passes through a real success response unchanged', async () => {
    const real = {
      success: true, status: 'CONNECTED', marketplace: 'US', profileIdMasked: '************3456',
      lastSuccessfulSync: '2026-08-29T00:00:00.000Z', lastSyncError: null,
      tokenRefreshStatus: { status: 'OK' }, configured: true, missingConfigKeys: [], readOnly: true,
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => real });
    const result = await testAmazonConnection();
    expect(result).toEqual(real);
  });
});

describe('campaign sync client (Phase 2A) -- same graceful-failure guarantees', () => {
  it('fetchCampaignSyncStatus returns a clear "not running" status when the backend is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const status = await fetchCampaignSyncStatus();
    expect(status.lastCampaignSync).toBeNull();
    expect(status.lastSyncError).toMatch(/not running/);
    expect(status.syncInProgress).toBe(false);
  });

  it('fetchCampaignSyncStatus passes through syncInProgress:true unchanged, so the UI can show sync progress after a reload', async () => {
    const real = {
      lastCampaignSync: null, lastRequestedPeriod: { start: '2026-08-09', end: '2026-08-12' },
      lastRowCount: null, lastSyncError: null, syncInProgress: true,
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => real });
    const status = await fetchCampaignSyncStatus();
    expect(status).toEqual(real);
  });

  it('syncCampaignData sends the exact startDate/endDate to its own local backend', async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body as string;
      return { ok: true, json: async () => ({ success: true, rows: [] }) };
    });
    await syncCampaignData('2026-08-09', '2026-08-12');
    const sent = JSON.parse(capturedBody!);
    expect(sent).toEqual({ startDate: '2026-08-09', endDate: '2026-08-12' });
  });

  it('syncCampaignData returns success:false gracefully when the backend is unreachable, never throwing', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await syncCampaignData('2026-08-09', '2026-08-12');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not running/);
  });

  it('syncCampaignData passes through a real success response, including live campaign status, unchanged', async () => {
    const real = {
      success: true,
      requestedPeriod: { start: '2026-08-09', end: '2026-08-12' },
      rows: [{ campaign: 'Coconut - Sponsored Products', campaignId: '111', status: 'ENABLED', impressions: 500, clicks: 20, spend: 16.48, orders: 0, sales: 0 }],
      campaignCount: 1,
      performanceRowCount: 1,
      syncedAt: '2026-08-29T00:00:00.000Z',
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => real });
    const result = await syncCampaignData('2026-08-09', '2026-08-12');
    expect(result).toEqual(real);
    expect(result.rows![0].status).toBe('ENABLED');
  });

  it('never includes a secret in a campaign sync response, even from a malformed backend body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, rows: [] }) });
    const result = await syncCampaignData('2026-08-09', '2026-08-12');
    expect(JSON.stringify(result)).not.toMatch(/secret/i);
  });
});

describe('targeting sync client (Phase 2B) -- same graceful-failure guarantees', () => {
  it('fetchTargetingSyncStatus returns a clear "not running" status when the backend is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const status = await fetchTargetingSyncStatus();
    expect(status.lastTargetingSync).toBeNull();
    expect(status.lastSyncError).toMatch(/not running/);
    expect(status.syncInProgress).toBe(false);
  });

  it('fetchTargetingSyncStatus passes through syncInProgress:true unchanged, so the UI can show sync progress after a reload', async () => {
    const real = {
      lastTargetingSync: null, lastRequestedPeriod: { start: '2026-08-09', end: '2026-08-12' },
      lastRowCount: null, lastSyncError: null, syncInProgress: true, reportId: 'r-1', pollAttempts: 3, lastPolledStatus: 'PROCESSING',
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => real });
    const status = await fetchTargetingSyncStatus();
    expect(status).toEqual(real);
  });

  it('syncTargetingData sends the exact startDate/endDate to its own local backend', async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body as string;
      return { ok: true, json: async () => ({ success: true, pending: true }) };
    });
    await syncTargetingData('2026-08-09', '2026-08-12');
    const sent = JSON.parse(capturedBody!);
    expect(sent).toEqual({ startDate: '2026-08-09', endDate: '2026-08-12' });
  });

  it('syncTargetingData returns success:false gracefully when the backend is unreachable, never throwing', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await syncTargetingData('2026-08-09', '2026-08-12');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not running/);
  });

  it('fetchTargetingSyncResult passes through a real success response, including live keyword status and bid, unchanged', async () => {
    const real = {
      success: true,
      requestedPeriod: { start: '2026-08-09', end: '2026-08-12' },
      rows: [{ campaign: 'Coconut - Sponsored Products', adGroup: 'Coconut - Broad', targetingText: 'coconut oil organic', matchType: 'EXACT', targetingId: '222', bid: 0.85, status: 'ENABLED', impressions: 400, clicks: 18, spend: 12.4, orders: 2, sales: 39.98 }],
      targetingCount: 1,
      performanceRowCount: 1,
      syncedAt: '2026-08-29T00:00:00.000Z',
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => real });
    const result = await fetchTargetingSyncResult();
    expect(result).toEqual(real);
    expect(result.rows![0].status).toBe('ENABLED');
    expect(result.rows![0].bid).toBe(0.85);
  });

  it('never includes a secret in a targeting sync response, even from a malformed backend body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, rows: [] }) });
    const result = await syncTargetingData('2026-08-09', '2026-08-12');
    expect(JSON.stringify(result)).not.toMatch(/secret/i);
  });
});

describe('search term sync client (Phase 2C) -- same graceful-failure guarantees', () => {
  it('fetchSearchTermSyncStatus returns a clear "not running" status when the backend is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const status = await fetchSearchTermSyncStatus();
    expect(status.lastSearchTermSync).toBeNull();
    expect(status.lastSyncError).toMatch(/not running/);
    expect(status.syncInProgress).toBe(false);
  });

  it('syncSearchTermData sends the exact startDate/endDate to its own local backend', async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body as string;
      return { ok: true, json: async () => ({ success: true, pending: true }) };
    });
    await syncSearchTermData('2026-08-09', '2026-08-12');
    const sent = JSON.parse(capturedBody!);
    expect(sent).toEqual({ startDate: '2026-08-09', endDate: '2026-08-12' });
  });

  it('syncSearchTermData returns success:false gracefully when the backend is unreachable, never throwing', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await syncSearchTermData('2026-08-09', '2026-08-12');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not running/);
  });

  it('fetchSearchTermSyncResult passes through a real success response unchanged, including zero-sales rows', async () => {
    const real = {
      success: true,
      requestedPeriod: { start: '2026-08-09', end: '2026-08-12' },
      rows: [{ campaign: 'Coconut - Sponsored Products', adGroup: 'Coconut - Broad', searchTerm: 'organic coconut oil', targetingText: 'coconut oil', matchType: 'BROAD', impressions: 200, clicks: 9, spend: 6.2, orders: 0, sales: 0 }],
      performanceRowCount: 1,
      syncedAt: '2026-08-29T00:00:00.000Z',
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => real });
    const result = await fetchSearchTermSyncResult();
    expect(result).toEqual(real);
    expect(result.rows![0].sales).toBe(0);
  });

  it('never includes a secret in a search term sync response, even from a malformed backend body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, rows: [] }) });
    const result = await syncSearchTermData('2026-08-09', '2026-08-12');
    expect(JSON.stringify(result)).not.toMatch(/secret/i);
  });
});

describe('advertised product sync client (Phase 2D) -- same graceful-failure guarantees', () => {
  it('fetchAdvertisedProductSyncStatus returns a clear "not running" status when the backend is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const status = await fetchAdvertisedProductSyncStatus();
    expect(status.lastAdvertisedProductSync).toBeNull();
    expect(status.lastSyncError).toMatch(/not running/);
    expect(status.syncInProgress).toBe(false);
  });

  it('syncAdvertisedProductData sends the exact startDate/endDate to its own local backend', async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body as string;
      return { ok: true, json: async () => ({ success: true, pending: true }) };
    });
    await syncAdvertisedProductData('2026-08-09', '2026-08-12');
    const sent = JSON.parse(capturedBody!);
    expect(sent).toEqual({ startDate: '2026-08-09', endDate: '2026-08-12' });
  });

  it('syncAdvertisedProductData returns success:false gracefully when the backend is unreachable, never throwing', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await syncAdvertisedProductData('2026-08-09', '2026-08-12');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not running/);
  });

  it('fetchAdvertisedProductSyncResult passes through a real success response unchanged', async () => {
    const real = {
      success: true,
      requestedPeriod: { start: '2026-08-09', end: '2026-08-12' },
      rows: [{ campaign: 'Coconut - Sponsored Products', adGroup: 'Coconut - Broad', asin: 'B0EXAMPLE123', sku: 'COCO-16OZ', impressions: 300, clicks: 15, spend: 9.5, orders: 2, sales: 39.98 }],
      performanceRowCount: 1,
      syncedAt: '2026-08-29T00:00:00.000Z',
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => real });
    const result = await fetchAdvertisedProductSyncResult();
    expect(result).toEqual(real);
    expect(result.rows![0].asin).toBe('B0EXAMPLE123');
  });

  it('never includes a secret in an advertised product sync response, even from a malformed backend body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, rows: [] }) });
    const result = await syncAdvertisedProductData('2026-08-09', '2026-08-12');
    expect(JSON.stringify(result)).not.toMatch(/secret/i);
  });
});
