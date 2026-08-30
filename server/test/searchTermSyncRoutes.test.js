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
    { campaignId: 111111111111111, adGroupId: 333333333333333, searchTerm: 'organic coconut oil', keyword: 'coconut oil', matchType: 'BROAD', impressions: 200, clicks: 9, cost: 6.2, purchases1d: 1, sales1d: 19.99 },
  ];
  const statuses = reportStatusSequence ?? ['COMPLETED'];
  let statusCallIndex = 0;

  globalThis.fetch = async (url, opts) => {
    const s = String(url);
    const isAmazonHost = s.includes('/auth/o2/token') || s.includes('/sp/campaigns/list') || s.includes('/sp/adGroups/list')
      || s.includes('/reporting/reports') || s === 'https://fake-s3.example.com/search-term-report.json.gz';
    if (isAmazonHost) calls.push({ url: s, method: opts?.method, body: opts?.body });

    if (s.includes('/auth/o2/token')) return { ok: true, json: async () => ({ access_token: 'test-access-token', expires_in: 3600 }) };
    if (s.includes('/sp/campaigns/list')) return { ok: true, status: 200, text: async () => CAMPAIGNS_RESPONSE };
    if (s.includes('/sp/adGroups/list')) return { ok: true, status: 200, text: async () => AD_GROUPS_RESPONSE };
    if (s.endsWith('/reporting/reports')) return { ok: true, status: 200, text: async () => JSON.stringify({ reportId: 'search-term-report-123', status: 'PENDING' }) };
    if (s.includes('/reporting/reports/search-term-report-123')) {
      const status = statuses[Math.min(statusCallIndex, statuses.length - 1)];
      statusCallIndex++;
      if (status === 'COMPLETED') {
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'COMPLETED', url: 'https://fake-s3.example.com/search-term-report.json.gz' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ status }) };
    }
    if (s === 'https://fake-s3.example.com/search-term-report.json.gz') {
      const buf = gzipReportPayload(rows);
      return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
    return originalFetch(url, opts);
  };

  return calls;
}

async function postSync(payload) {
  const res = await fetch(`${baseUrl}/api/amazon/searchterms/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { res, body: await res.json() };
}

async function getStatus() {
  return (await fetch(`${baseUrl}/api/amazon/searchterms/status`)).json();
}

async function getResult() {
  return (await fetch(`${baseUrl}/api/amazon/searchterms/result`)).json();
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

describe('POST /api/amazon/searchterms/sync -- returns immediately, runs in the background', () => {
  test('acknowledges the sync request right away without waiting for Amazon', async () => {
    mockAmazonFetch();
    const { res, body } = await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    assert.equal(res.status, 202);
    assert.equal(body.pending, true);
    assert.equal(body.rows, undefined);
    await waitForSyncToFinish();
  });

  test('normalizes search term rows, retrievable via GET /result once the background sync completes', async () => {
    mockAmazonFetch();
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    const status = await waitForSyncToFinish();
    assert.equal(status.lastSyncError, null);

    const result = await getResult();
    assert.equal(result.success, true);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].campaign, 'Coconut - Sponsored Products');
    assert.equal(result.rows[0].searchTerm, 'organic coconut oil');
    assert.equal(result.rows[0].spend, 6.2);
  });

  test('requests the report exactly once no matter how many status polls it takes to complete', async () => {
    const calls = mockAmazonFetch({ reportStatusSequence: ['PENDING', 'PROCESSING', 'COMPLETED'] });
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    await waitForSyncToFinish();
    const reportCreationCalls = calls.filter((c) => c.url.endsWith('/reporting/reports') && c.method === 'POST');
    assert.equal(reportCreationCalls.length, 1);
  });
});

describe('POST /api/amazon/searchterms/sync -- validation, failure, and concurrency', () => {
  test('rejects an invalid date range without calling Amazon at all', async () => {
    const calls = mockAmazonFetch();
    const { body } = await postSync({ startDate: '2026-08-12', endDate: '2026-08-09' });
    assert.equal(body.success, false);
    assert.equal(calls.length, 0);
  });

  test('an API failure surfaces a clear error via status without leaking a secret', async () => {
    globalThis.fetch = async (url, opts) => {
      const s = String(url);
      if (s.includes('/auth/o2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      if (s.includes('/sp/campaigns/list')) return { ok: false, status: 500, text: async () => 'Internal error' };
      return originalFetch(url, opts);
    };
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    const status = await waitForSyncToFinish();
    assert.ok(status.lastSyncError);
    assert.ok(!JSON.stringify(status).includes('super-secret-value'));
  });

  test('a second sync request is rejected immediately while the first is still generating, and never triggers a second report', async () => {
    let reportRequestCount = 0;
    let releaseFirstReportRequest;
    const gate = new Promise((resolve) => { releaseFirstReportRequest = resolve; });

    globalThis.fetch = async (url, opts) => {
      const s = String(url);
      if (s.includes('/auth/o2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      if (s.includes('/sp/campaigns/list')) return { ok: true, status: 200, text: async () => CAMPAIGNS_RESPONSE };
      if (s.includes('/sp/adGroups/list')) return { ok: true, status: 200, text: async () => AD_GROUPS_RESPONSE };
      if (s.endsWith('/reporting/reports')) {
        reportRequestCount++;
        await gate;
        return { ok: true, status: 200, text: async () => JSON.stringify({ reportId: 'search-term-report-123', status: 'PENDING' }) };
      }
      if (s.includes('/reporting/reports/search-term-report-123')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'COMPLETED', url: 'https://fake-s3.example.com/search-term-report.json.gz' }) };
      }
      if (s === 'https://fake-s3.example.com/search-term-report.json.gz') {
        const buf = gzipReportPayload([]);
        return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
      }
      return originalFetch(url, opts);
    };

    const { body: firstBody } = await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    assert.equal(firstBody.pending, true);
    const { body: secondBody } = await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    assert.equal(secondBody.success, false);
    assert.match(secondBody.error, /already in progress/i);

    releaseFirstReportRequest();
    await waitForSyncToFinish();
    assert.equal(reportRequestCount, 1);
  });
});

describe('Amazon write operations remain unavailable on the search-term-sync router too', () => {
  test('no route exists for creating/updating/deleting keywords, campaigns, or bids under /api/amazon/searchterms', async () => {
    const writeShapedRequests = [
      { method: 'POST', path: '/api/amazon/searchterms' },
      { method: 'PUT', path: '/api/amazon/searchterms/111' },
      { method: 'DELETE', path: '/api/amazon/searchterms/111' },
      { method: 'POST', path: '/api/amazon/searchterms/negatives' },
    ];
    for (const { method, path } of writeShapedRequests) {
      const res = await fetch(`${baseUrl}${path}`, { method });
      assert.equal(res.status, 404, `${method} ${path} should not exist (got ${res.status})`);
    }
  });
});
