import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

process.env.AMAZON_REPORT_POLL_INTERVAL_MS = '5';
process.env.AMAZON_REPORT_MAX_POLL_MS = '150';
process.env.AMAZON_ADS_CLIENT_ID = 'test-client-id';
process.env.AMAZON_ADS_CLIENT_SECRET = 'super-secret-value';
process.env.AMAZON_ADS_REFRESH_TOKEN = 'refresh-token-value';
process.env.AMAZON_ADS_PROFILE_ID = '98765432109876543';

const { createApp } = await import('../src/app.js');
const { __resetForTests } = await import('../src/amazonAuth.js');

const originalFetch = globalThis.fetch;
let server;
let baseUrl;

const KEYWORDS_RESPONSE = JSON.stringify({
  keywords: [
    { keywordId: 222222222222222, campaignId: 111111111111111, adGroupId: 333333333333333, keywordText: 'coconut oil organic', matchType: 'EXACT', state: 'ENABLED', bid: 0.85 },
  ],
});
const TARGETS_RESPONSE = JSON.stringify({
  targetingClauses: [
    { targetId: 444444444444444, campaignId: 111111111111111, adGroupId: 333333333333333, expression: [{ type: 'ASIN_SAME_AS', value: 'B0EXAMPLE123' }], state: 'PAUSED', bid: 0.6 },
  ],
});
const CAMPAIGNS_RESPONSE = JSON.stringify({
  campaigns: [{ campaignId: 111111111111111, name: 'Coconut - Sponsored Products', state: 'ENABLED', budget: { budget: 20 } }],
});
const AD_GROUPS_RESPONSE = JSON.stringify({
  adGroups: [{ adGroupId: 333333333333333, campaignId: 111111111111111, name: 'Coconut - Broad', state: 'ENABLED' }],
});

function gzipReportPayload(rows) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(rows), 'utf8'));
}

function mockAmazonFetch({ reportRows, reportStatusSequence } = {}) {
  const calls = [];
  const rows = reportRows ?? [
    { keywordId: 222222222222222, impressions: 400, clicks: 18, cost: 12.4, purchases1d: 2, sales1d: 39.98 },
    { keywordId: 444444444444444, impressions: 50, clicks: 1, cost: 0.9, purchases1d: 0, sales1d: 0 },
  ];
  const statuses = reportStatusSequence ?? ['COMPLETED'];
  let statusCallIndex = 0;

  globalThis.fetch = async (url, opts) => {
    const s = String(url);
    const isAmazonHost = s.includes('/auth/o2/token') || s.includes('/sp/keywords/list') || s.includes('/sp/targets/list')
      || s.includes('/sp/campaigns/list') || s.includes('/sp/adGroups/list') || s.includes('/reporting/reports')
      || s === 'https://fake-s3.example.com/targeting-report.json.gz';
    if (isAmazonHost) calls.push({ url: s, method: opts?.method, body: opts?.body });

    if (s.includes('/auth/o2/token')) return { ok: true, json: async () => ({ access_token: 'test-access-token', expires_in: 3600 }) };
    if (s.includes('/sp/keywords/list')) return { ok: true, status: 200, text: async () => KEYWORDS_RESPONSE };
    if (s.includes('/sp/targets/list')) return { ok: true, status: 200, text: async () => TARGETS_RESPONSE };
    if (s.includes('/sp/campaigns/list')) return { ok: true, status: 200, text: async () => CAMPAIGNS_RESPONSE };
    if (s.includes('/sp/adGroups/list')) return { ok: true, status: 200, text: async () => AD_GROUPS_RESPONSE };
    if (s.endsWith('/reporting/reports')) return { ok: true, status: 200, text: async () => JSON.stringify({ reportId: 'targeting-report-123', status: 'PENDING' }) };
    if (s.includes('/reporting/reports/targeting-report-123')) {
      const status = statuses[Math.min(statusCallIndex, statuses.length - 1)];
      statusCallIndex++;
      if (status === 'COMPLETED') {
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'COMPLETED', url: 'https://fake-s3.example.com/targeting-report.json.gz' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ status }) };
    }
    if (s === 'https://fake-s3.example.com/targeting-report.json.gz') {
      const buf = gzipReportPayload(rows);
      return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
    return originalFetch(url, opts);
  };

  return calls;
}

async function postSync(payload) {
  const res = await fetch(`${baseUrl}/api/amazon/targeting/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { res, body: await res.json() };
}

async function getStatus() {
  return (await fetch(`${baseUrl}/api/amazon/targeting/status`)).json();
}

async function getResult() {
  return (await fetch(`${baseUrl}/api/amazon/targeting/result`)).json();
}

async function waitForSyncToFinish({ intervalMs = 5, maxWaitMs = 5000 } = {}) {
  const deadline = Date.now() + maxWaitMs;
  let status = await getStatus();
  while (status.syncInProgress) {
    if (Date.now() > deadline) throw new Error('Test timed out waiting for the background sync to finish.');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    status = await getStatus();
  }
  return status;
}

beforeEach(async () => {
  __resetForTests();
  globalThis.fetch = originalFetch;
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe('POST /api/amazon/targeting/sync -- returns immediately, runs in the background', () => {
  test('acknowledges the sync request right away without waiting for Amazon', async () => {
    mockAmazonFetch();
    const { res, body } = await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    assert.equal(res.status, 202);
    assert.equal(body.success, true);
    assert.equal(body.pending, true);
    assert.equal(body.rows, undefined);
    await waitForSyncToFinish();
  });

  test('normalizes keyword AND product-targeting rows into the TargetingRow shape, merging live state with performance', async () => {
    mockAmazonFetch();
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    const status = await waitForSyncToFinish();
    assert.equal(status.lastSyncError, null);

    const result = await getResult();
    assert.equal(result.success, true);
    assert.equal(result.rows.length, 2);

    const keyword = result.rows.find((r) => r.targetingId === '222222222222222');
    assert.equal(keyword.campaign, 'Coconut - Sponsored Products');
    assert.equal(keyword.adGroup, 'Coconut - Broad');
    assert.equal(keyword.targetingText, 'coconut oil organic');
    assert.equal(keyword.matchType, 'EXACT');
    assert.equal(keyword.bid, 0.85);
    assert.equal(keyword.status, 'ENABLED');
    assert.equal(keyword.spend, 12.4);
    assert.equal(keyword.sales, 39.98);

    const productTarget = result.rows.find((r) => r.targetingId === '444444444444444');
    assert.equal(productTarget.targetingText, 'ASIN_SAME_AS=B0EXAMPLE123');
    assert.equal(productTarget.status, 'PAUSED'); // live state, not inferred from having any spend
    assert.equal(productTarget.spend, 0.9);
    assert.equal(productTarget.sales, 0); // zero-sales reported as a real 0
  });

  test('GET /api/amazon/targeting/status reflects the last successful sync', async () => {
    mockAmazonFetch();
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    const status = await waitForSyncToFinish();
    assert.ok(status.lastTargetingSync);
    assert.deepEqual(status.lastRequestedPeriod, { start: '2026-08-09', end: '2026-08-12' });
    assert.equal(status.lastRowCount, 2);
    assert.equal(status.lastSyncError, null);
  });

  test('requests the report exactly once no matter how many status polls it takes to complete', async () => {
    const calls = mockAmazonFetch({ reportStatusSequence: ['PENDING', 'PENDING', 'PROCESSING', 'COMPLETED'] });
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    await waitForSyncToFinish();

    const reportCreationCalls = calls.filter((c) => c.url.endsWith('/reporting/reports') && c.method === 'POST');
    assert.equal(reportCreationCalls.length, 1, 'expected exactly one report-generation request, never a new report per poll');
  });
});

describe('POST /api/amazon/targeting/sync -- validation and failure handling', () => {
  test('rejects an invalid date range without calling Amazon at all', async () => {
    const calls = mockAmazonFetch();
    const { body } = await postSync({ startDate: '2026-08-12', endDate: '2026-08-09' });
    assert.equal(body.success, false);
    assert.equal(calls.length, 0);
  });

  test('an API failure surfaces a clear error via status, and manual targeting data is untouched (this router never deletes anything -- it holds no manual data at all)', async () => {
    globalThis.fetch = async (url, opts) => {
      const s = String(url);
      if (s.includes('/auth/o2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      if (s.includes('/sp/keywords/list')) return { ok: false, status: 500, text: async () => 'Internal error' };
      return originalFetch(url, opts);
    };
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    const status = await waitForSyncToFinish();
    assert.match(status.lastSyncError, /Amazon targeting list failed/);
    assert.ok(!JSON.stringify(status).includes('super-secret-value'));
  });

  test('gives up after the safety ceiling if the report never reaches a terminal state, without hanging forever', async () => {
    globalThis.fetch = async (url, opts) => {
      const s = String(url);
      if (s.includes('/auth/o2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      if (s.includes('/sp/keywords/list')) return { ok: true, status: 200, text: async () => KEYWORDS_RESPONSE };
      if (s.includes('/sp/targets/list')) return { ok: true, status: 200, text: async () => TARGETS_RESPONSE };
      if (s.includes('/sp/campaigns/list')) return { ok: true, status: 200, text: async () => CAMPAIGNS_RESPONSE };
      if (s.includes('/sp/adGroups/list')) return { ok: true, status: 200, text: async () => AD_GROUPS_RESPONSE };
      if (s.endsWith('/reporting/reports')) return { ok: true, status: 200, text: async () => JSON.stringify({ reportId: 'targeting-report-123', status: 'PENDING' }) };
      if (s.includes('/reporting/reports/targeting-report-123')) return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'PENDING' }) };
      return originalFetch(url, opts);
    };
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    const status = await waitForSyncToFinish();
    assert.equal(status.syncInProgress, false);
    assert.match(status.lastSyncError, /gave up/i);
  });
});

describe('secrets are never exposed by any targeting-sync response', () => {
  test('a successful sync response never includes the configured Client Secret or refresh token', async () => {
    mockAmazonFetch();
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    const status = await waitForSyncToFinish();
    const result = await getResult();
    const combined = JSON.stringify({ status, result });
    assert.ok(!combined.includes('super-secret-value'));
    assert.ok(!combined.includes('refresh-token-value'));
  });
});

describe('Amazon write operations remain unavailable on the targeting-sync router too', () => {
  test('no route exists for creating/updating/deleting keywords, targets, ad groups, or bids under /api/amazon/targeting', async () => {
    const writeShapedRequests = [
      { method: 'POST', path: '/api/amazon/targeting' },
      { method: 'PUT', path: '/api/amazon/targeting/111' },
      { method: 'DELETE', path: '/api/amazon/targeting/111' },
      { method: 'PATCH', path: '/api/amazon/targeting/111' },
      { method: 'POST', path: '/api/amazon/targeting/keywords' },
      { method: 'POST', path: '/api/amazon/targeting/negatives' },
      { method: 'POST', path: '/api/amazon/targeting/pause' },
      { method: 'PUT', path: '/api/amazon/targeting/bids' },
    ];
    for (const { method, path } of writeShapedRequests) {
      const res = await fetch(`${baseUrl}${path}`, { method });
      assert.equal(res.status, 404, `${method} ${path} should not exist (got ${res.status})`);
    }
  });
});
