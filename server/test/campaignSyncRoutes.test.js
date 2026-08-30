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
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'COMPLETED', url: 'https://fake-s3.example.com/report.json.gz' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ status }) };
    }
    if (s === 'https://fake-s3.example.com/report.json.gz') {
      const buf = gzipReportPayload(rows);
      return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
    return originalFetch(url, opts);
  };

  return calls;
}

async function postSync(payload) {
  const res = await fetch(`${baseUrl}/api/amazon/campaigns/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { res, body: await res.json() };
}

async function getStatus() {
  return (await fetch(`${baseUrl}/api/amazon/campaigns/status`)).json();
}

async function getResult() {
  return (await fetch(`${baseUrl}/api/amazon/campaigns/result`)).json();
}

// POST /sync no longer waits for Amazon -- it kicks off the background
// sync and returns immediately (see routes/campaignSync.js). Tests poll
// this lightweight, local-only status endpoint to know when the
// background work has finished, exactly like the real frontend does.
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

describe('POST /api/amazon/campaigns/sync -- returns immediately, runs in the background', () => {
  test('acknowledges the sync request right away without waiting for Amazon', async () => {
    mockAmazonFetch();
    const { res, body } = await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    assert.equal(res.status, 202);
    assert.equal(body.success, true);
    assert.equal(body.pending, true);
    assert.deepEqual(body.requestedPeriod, { start: '2026-08-09', end: '2026-08-12' });
    assert.equal(body.rows, undefined, 'rows must not be returned synchronously -- they arrive via GET /result once ready');
    await waitForSyncToFinish();
  });

  test('normalizes campaign rows for the requested period, retrievable via GET /result once the background sync completes', async () => {
    mockAmazonFetch();
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    const status = await waitForSyncToFinish();
    assert.equal(status.lastSyncError, null);

    const result = await getResult();
    assert.equal(result.success, true);
    assert.deepEqual(result.requestedPeriod, { start: '2026-08-09', end: '2026-08-12' });
    assert.equal(result.rows.length, 2);
    assert.equal(result.campaignCount, 2);
    const coconut = result.rows.find((r) => r.campaignId === '111111111111111');
    assert.equal(coconut.spend, 16.48);
    assert.equal(coconut.status, 'ENABLED');
  });

  test('token refresh happens as part of the background sync', async () => {
    mockAmazonFetch();
    assert.equal(getTokenRefreshStatus().status, 'NOT_YET_REFRESHED');
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    await waitForSyncToFinish();
    assert.equal(getTokenRefreshStatus().status, 'OK');
  });

  test('the exact requested date range is sent to Amazon\'s reporting endpoint', async () => {
    const calls = mockAmazonFetch();
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    await waitForSyncToFinish();

    const reportRequestCall = calls.find((c) => c.url.endsWith('/reporting/reports') && c.method === 'POST');
    assert.ok(reportRequestCall, 'expected a POST to /reporting/reports');
    const sentBody = JSON.parse(reportRequestCall.body);
    assert.equal(sentBody.startDate, '2026-08-09');
    assert.equal(sentBody.endDate, '2026-08-12');
  });

  test('waits through several PENDING/PROCESSING polls before completing, without failing early, and GET /status shows live progress', async () => {
    mockAmazonFetch({ reportStatusSequence: ['PENDING', 'PENDING', 'PROCESSING', 'PROCESSING', 'COMPLETED'] });
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });

    // Catch it mid-flight at least once -- proving polling actually
    // happens in the background rather than failing early.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const midStatus = await getStatus();
    assert.ok(midStatus.pollAttempts >= 1, `expected at least one poll to have happened by now (got ${midStatus.pollAttempts})`);
    assert.equal(midStatus.reportId, 'report-123');

    const finalStatus = await waitForSyncToFinish();
    assert.equal(finalStatus.lastSyncError, null);
    assert.equal(finalStatus.lastPolledStatus, 'COMPLETED');
  });

  test('requests the report exactly once no matter how many status polls it takes to complete', async () => {
    const calls = mockAmazonFetch({ reportStatusSequence: ['PENDING', 'PENDING', 'PROCESSING', 'PROCESSING', 'PROCESSING', 'COMPLETED'] });
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    await waitForSyncToFinish();

    const reportCreationCalls = calls.filter((c) => c.url.endsWith('/reporting/reports') && c.method === 'POST');
    assert.equal(reportCreationCalls.length, 1, 'expected exactly one report-generation request, never a new report per poll');

    const statusPollCalls = calls.filter((c) => c.url.includes('/reporting/reports/report-123'));
    assert.ok(statusPollCalls.length >= 6, `expected the same report to be polled repeatedly (got ${statusPollCalls.length} polls)`);
  });

  test('GET /api/amazon/campaigns/status reflects the last successful sync', async () => {
    mockAmazonFetch();
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    const status = await waitForSyncToFinish();

    assert.ok(status.lastCampaignSync);
    assert.deepEqual(status.lastRequestedPeriod, { start: '2026-08-09', end: '2026-08-12' });
    assert.equal(status.lastRowCount, 2);
    assert.equal(status.lastSyncError, null);
  });
});

describe('POST /api/amazon/campaigns/sync -- validation and failure handling', () => {
  test('rejects an invalid date range without calling Amazon at all', async () => {
    const calls = mockAmazonFetch();
    const { body } = await postSync({ startDate: '2026-08-12', endDate: '2026-08-09' }); // end before start
    assert.equal(body.success, false);
    assert.equal(calls.length, 0);
  });

  test('a report generation failure surfaces a clear error via status, and never includes a secret', async () => {
    globalThis.fetch = async (url, opts) => {
      const s = String(url);
      if (s.includes('/auth/o2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      if (s.includes('/sp/campaigns/list')) return { ok: true, text: async () => CAMPAIGNS_LIST_RESPONSE };
      if (s.endsWith('/reporting/reports')) return { ok: true, text: async () => JSON.stringify({ reportId: 'report-123', status: 'PENDING' }) };
      if (s.includes('/reporting/reports/report-123')) return { ok: true, text: async () => JSON.stringify({ status: 'FAILURE', failureReason: 'INTERNAL_ERROR' }) };
      return originalFetch(url, opts);
    };

    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    const status = await waitForSyncToFinish();
    assert.match(status.lastSyncError, /INTERNAL_ERROR/);
    assert.ok(!JSON.stringify(status).includes('super-secret-value'));
  });

  test('an unrecognized/undocumented Amazon status is never treated as failure or success -- polling continues safely', async () => {
    // Guards against ever assuming the wrong "completed" string: Amazon
    // returning some as-yet-undocumented transitional status must not be
    // silently treated as done, and must not be treated as a failure
    // either -- only the documented terminal statuses should end the loop.
    mockAmazonFetch({ reportStatusSequence: ['PENDING', 'SOME_NEW_TRANSITIONAL_STATUS', 'PROCESSING', 'COMPLETED'] });
    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    const status = await waitForSyncToFinish();
    assert.equal(status.lastSyncError, null);
    const result = await getResult();
    assert.equal(result.success, true);
  });

  test('gives up after the safety ceiling if the report never reaches a terminal state, without hanging forever, and clears the in-progress flag', async () => {
    globalThis.fetch = async (url, opts) => {
      const s = String(url);
      if (s.includes('/auth/o2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      if (s.includes('/sp/campaigns/list')) return { ok: true, text: async () => CAMPAIGNS_LIST_RESPONSE };
      if (s.endsWith('/reporting/reports')) return { ok: true, text: async () => JSON.stringify({ reportId: 'report-123', status: 'PENDING' }) };
      // Never completes -- exercises the safety-ceiling path (AMAZON_REPORT_MAX_POLL_MS=150 above).
      if (s.includes('/reporting/reports/report-123')) return { ok: true, text: async () => JSON.stringify({ status: 'PENDING' }) };
      return originalFetch(url, opts);
    };

    await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    const status = await waitForSyncToFinish();
    assert.equal(status.syncInProgress, false);
    assert.match(status.lastSyncError, /gave up/i);
  });
});

describe('POST /api/amazon/campaigns/sync -- prevents overlapping syncs', () => {
  test('a second sync request is rejected immediately while the first is still generating, and only one report is ever requested', async () => {
    let releaseFirstReportRequest;
    const gate = new Promise((resolve) => { releaseFirstReportRequest = resolve; });
    let reportRequestCount = 0;

    globalThis.fetch = async (url, opts) => {
      const s = String(url);
      if (s.includes('/auth/o2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      if (s.includes('/sp/campaigns/list')) return { ok: true, text: async () => CAMPAIGNS_LIST_RESPONSE };
      if (s.endsWith('/reporting/reports')) {
        reportRequestCount++;
        await gate; // holds the first sync's report-creation call open until the test releases it
        return { ok: true, text: async () => JSON.stringify({ reportId: 'report-123', status: 'PENDING' }) };
      }
      if (s.includes('/reporting/reports/report-123')) {
        return { ok: true, text: async () => JSON.stringify({ status: 'COMPLETED', url: 'https://fake-s3.example.com/report.json.gz' }) };
      }
      if (s === 'https://fake-s3.example.com/report.json.gz') {
        const buf = gzipReportPayload([{ campaignId: 111111111111111, impressions: 1, clicks: 1, cost: 1, purchases1d: 0, sales1d: 0 }]);
        return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
      }
      return originalFetch(url, opts);
    };

    // markCampaignSyncStarted() runs synchronously before the background
    // work is even dispatched, so syncInProgress is already true by the
    // time this first response comes back -- no artificial delay needed
    // to observe the guard below.
    const { body: firstBody } = await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    assert.equal(firstBody.pending, true);

    const midFlightStatus = await getStatus();
    assert.equal(midFlightStatus.syncInProgress, true);

    const { body: secondBody } = await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
    assert.equal(secondBody.success, false);
    assert.match(secondBody.error, /already in progress/i);

    releaseFirstReportRequest();
    const finalStatus = await waitForSyncToFinish();
    assert.equal(finalStatus.lastSyncError, null);

    assert.equal(reportRequestCount, 1, 'the blocked second request must never trigger its own report');
    assert.equal(finalStatus.syncInProgress, false);
  });
});

describe('Diagnostic: a report progresses through real Amazon statuses to a downloadable/completed state', () => {
  test('PENDING -> PROCESSING -> COMPLETED is fully observed via safe per-attempt logging and GET /status, and the report becomes downloadable', async () => {
    const originalLog = console.log;
    const loggedLines = [];
    console.log = (...args) => {
      loggedLines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    try {
      const calls = mockAmazonFetch({ reportStatusSequence: ['PENDING', 'PROCESSING', 'COMPLETED'] });
      await postSync({ startDate: '2026-08-09', endDate: '2026-08-12' });
      const status = await waitForSyncToFinish();
      assert.equal(status.lastSyncError, null);
      assert.equal(status.lastPolledStatus, 'COMPLETED');
      assert.ok(status.pollAttempts >= 3, `expected at least 3 polls to observe all 3 statuses (got ${status.pollAttempts})`);

      const statusPollCalls = calls.filter((c) => c.url.includes('/reporting/reports/report-123'));
      assert.equal(statusPollCalls.length, 3, 'expected exactly one poll per documented status transition');

      const result = await getResult();
      assert.equal(result.success, true);
      assert.ok(result.rows.length > 0, 'the completed report must actually be downloadable and produce rows');

      // Safe per-attempt logging: reportId, HTTP status, Amazon status, and
      // attempt number are present; the configured secrets never are.
      const pollLogLines = loggedLines.filter((line) => line.includes('Amazon campaign report poll'));
      assert.ok(pollLogLines.length >= 3, 'expected a log line for every poll attempt');
      assert.ok(pollLogLines.some((line) => line.includes('report-123') && line.includes('attempt')));
      assert.ok(!loggedLines.join('\n').includes('super-secret-value'), 'must never log the Client Secret');
      assert.ok(!loggedLines.join('\n').includes('refresh-token-value'), 'must never log the refresh token');
    } finally {
      console.log = originalLog;
    }
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
