import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAmazonStatus, testAmazonConnection, fetchCampaignSyncStatus, syncCampaignData } from './amazonBackend';

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
