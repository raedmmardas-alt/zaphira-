import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

process.env.AMAZON_REPORT_POLL_INTERVAL_MS = '5';
process.env.AMAZON_ADS_CLIENT_ID = 'test-client-id';
process.env.AMAZON_ADS_CLIENT_SECRET = 'super-secret-value';
process.env.AMAZON_ADS_REFRESH_TOKEN = 'refresh-token-value';
process.env.AMAZON_ADS_PROFILE_ID = '98765432109876543';

const { createApp } = await import('../src/app.js');
const { __resetForTests, getTokenRefreshStatus } = await import('../src/amazonAuth.js');

const originalFetch = globalThis.fetch;
let server;
let baseUrl;

const CAMPAIGNS_LIST_RESPONSE = JSON.stringify({
  campaigns: [
    { campaignId: 111111111111111, name: 'Coconut - Sponsored Products', state: 'ENABLED', budget: { budget: 20 } },
    { campaignId: 222222222222222, name: 'Vanilla - Sponsored Products', state: 'PAUSED', budget: { budget: 15 } },
  ],
});

function gzipReportPayload(rows) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(rows), 'utf8'));
}

// Tracks every URL fetched during a test, and only intercepts calls to
// Amazon's own hosts / the fake "download URL" -- calls to the local test
// server itself fall through to the real fetch.
function mockAmazonFetch({ reportRows, reportStatusSequence } = {}) {
  const calls = [];
  const rows = reportRows ?? [{ campaignId: 111111111111111, impressions: 500, clicks: 20, cost: 16.48, purchases1d: 0, sales1d: 0 }];
  const statuses = reportStatusSequence ?? ['COMPLETED'];
  let statusCallIndex = 0;

  globalThis.fetch = async (url, opts) => {
    const s = String(url);
    const isAmazonHost = s.includes('/auth/o2/token') || s.includes('/sp/campaigns/list')
      || s.includes('/reporting/reports') || s === 'https://fake-s3.example.com/report.json.gz';
    if (isAmazonHost) calls.push({ url: s, method: opts?.method, body: opts?.body });

    if (s.includes('/auth/o2/token')) {
      return { ok: true, json: async () => ({ access_token: 'test-access-token', expires_in: 3600 }) };
    }
    if (s.includes('/sp/campaigns/list')) {
      return { ok: true, text: async () => CAMPAIGNS_LIST_RESPONSE };
    }
    if (s.endsWith('/reporting/reports')) {
      return { ok: true, text: async () => JSON.stringify({ reportId: 'report-123', status: 'PENDING' }) };
    }
    if (s.includes('/reporting/reports/report-123')) {
      const status = statuses[Math.min(statusCallIndex, statuses.length - 1)];
      statusCallIndex++;
      if (status === 'COMPLETED') {
        return { ok: true, text: async () => JSON.stringify({ status: 'COMPLETED', url: 'https://fake-s3.example.com/report.json.gz' }) };
      }
      return { ok: true, text: async () => JSON.stringify({ status }) };
    }
    if (s === 'https://fake-s3.example.com/report.json.gz') {
      const buf = gzipReportPayload(rows);
      return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
    return originalFetch(url, opts);
  };

  return calls;
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

describe('POST /api/amazon/campaigns/sync -- success', () => {
  test('returns normalized campaign rows for the requested period', async () => {
    mockAmazonFetch();

    const res = await fetch(`${baseUrl}/api/amazon/campaigns/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: '2026-08-09', endDate: '2026-08-12' }),
    });
    const body = await res.json();

    assert.equal(body.success, true);
    assert.deepEqual(body.requestedPeriod, { start: '2026-08-09', end: '2026-08-12' });
    assert.equal(body.rows.length, 2);
    assert.equal(body.campaignCount, 2);
    const coconut = body.rows.find((r) => r.campaignId === '111111111111111');
    assert.equal(coconut.spend, 16.48);
    assert.equal(coconut.status, 'ENABLED');
  });

  test('token refresh happens as part of the sync flow', async () => {
    mockAmazonFetch();
    assert.equal(getTokenRefreshStatus().status, 'NOT_YET_REFRESHED');

    const res = await fetch(`${baseUrl}/api/amazon/campaigns/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: '2026-08-09', endDate: '2026-08-12' }),
    });
    await res.json();

    assert.equal(getTokenRefreshStatus().status, 'OK');
  });

  test('the exact requested date range is sent to Amazon\'s reporting endpoint', async () => {
    const calls = mockAmazonFetch();

    await fetch(`${baseUrl}/api/amazon/campaigns/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: '2026-08-09', endDate: '2026-08-12' }),
    });

    const reportRequestCall = calls.find((c) => c.url.endsWith('/reporting/reports') && c.method === 'POST');
    assert.ok(reportRequestCall, 'expected a POST to /reporting/reports');
    const sentBody = JSON.parse(reportRequestCall.body);
    assert.equal(sentBody.startDate, '2026-08-09');
    assert.equal(sentBody.endDate, '2026-08-12');
  });

  test('waits through PENDING/PROCESSING polls before returning the completed report', async () => {
    mockAmazonFetch({ reportStatusSequence: ['PENDING', 'PROCESSING', 'COMPLETED'] });

    const res = await fetch(`${baseUrl}/api/amazon/campaigns/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: '2026-08-09', endDate: '2026-08-12' }),
    });
    const body = await res.json();
    assert.equal(body.success, true);
  });

  test('GET /api/amazon/campaigns/status reflects the last successful sync', async () => {
    mockAmazonFetch();
    await fetch(`${baseUrl}/api/amazon/campaigns/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: '2026-08-09', endDate: '2026-08-12' }),
    });

    const res = await fetch(`${baseUrl}/api/amazon/campaigns/status`);
    const body = await res.json();
    assert.ok(body.lastCampaignSync);
    assert.deepEqual(body.lastRequestedPeriod, { start: '2026-08-09', end: '2026-08-12' });
    assert.equal(body.lastRowCount, 2);
    assert.equal(body.lastSyncError, null);
  });
});

describe('POST /api/amazon/campaigns/sync -- validation and failure handling', () => {
  test('rejects an invalid date range without calling Amazon at all', async () => {
    const calls = mockAmazonFetch();
    const res = await fetch(`${baseUrl}/api/amazon/campaigns/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: '2026-08-12', endDate: '2026-08-09' }), // end before start
    });
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(calls.length, 0);
  });

  test('a report generation failure surfaces a clear error and never includes a secret', async () => {
    globalThis.fetch = async (url, opts) => {
      const s = String(url);
      if (s.includes('/auth/o2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      if (s.includes('/sp/campaigns/list')) return { ok: true, text: async () => CAMPAIGNS_LIST_RESPONSE };
      if (s.endsWith('/reporting/reports')) return { ok: true, text: async () => JSON.stringify({ reportId: 'report-123', status: 'PENDING' }) };
      if (s.includes('/reporting/reports/report-123')) return { ok: true, text: async () => JSON.stringify({ status: 'FAILURE', failureReason: 'INTERNAL_ERROR' }) };
      return originalFetch(url, opts);
    };

    const res = await fetch(`${baseUrl}/api/amazon/campaigns/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: '2026-08-09', endDate: '2026-08-12' }),
    });
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /INTERNAL_ERROR/);
    assert.ok(!JSON.stringify(body).includes('super-secret-value'));
  });
});

describe('Amazon write operations remain unavailable on the campaign-sync router too', () => {
  test('no route exists for creating/updating/deleting campaigns, bids, or budgets under /api/amazon/campaigns', async () => {
    const writeShapedRequests = [
      { method: 'POST', path: '/api/amazon/campaigns' },
      { method: 'PUT', path: '/api/amazon/campaigns/111' },
      { method: 'DELETE', path: '/api/amazon/campaigns/111' },
      { method: 'PATCH', path: '/api/amazon/campaigns/111' },
      { method: 'POST', path: '/api/amazon/campaigns/pause' },
      { method: 'POST', path: '/api/amazon/campaigns/budget' },
      { method: 'PUT', path: '/api/amazon/campaigns/bids' },
    ];
    for (const { method, path } of writeShapedRequests) {
      const res = await fetch(`${baseUrl}${path}`, { method });
      assert.equal(res.status, 404, `${method} ${path} should not exist (got ${res.status})`);
    }
  });
});
