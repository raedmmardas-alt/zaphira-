import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';

// A profile ID larger than Number.MAX_SAFE_INTEGER (9007199254740991) --
// real Amazon Ads profile IDs are frequently this large. Kept as a string
// throughout the test on purpose; see the comment on mockAmazonFetch below
// for why the mock's raw JSON is hand-written rather than built from a JS
// object with a same-sized numeric literal.
const BIG_PROFILE_ID = '98765432109876543';
const OTHER_BIG_PROFILE_ID = '11111111111111111';

process.env.AMAZON_ADS_CLIENT_ID = 'test-client-id';
process.env.AMAZON_ADS_CLIENT_SECRET = 'super-secret-value';
process.env.AMAZON_ADS_REFRESH_TOKEN = 'refresh-token-value';
process.env.AMAZON_ADS_PROFILE_ID = BIG_PROFILE_ID;

const { createApp } = await import('../src/app.js');
const { __resetForTests } = await import('../src/amazonAuth.js');

const originalFetch = globalThis.fetch;
let server;
let baseUrl;

// Only intercepts calls TO Amazon's own hosts (made server-side by
// amazonAuth.js/amazonClient.js). Anything else -- in particular, this
// test file's own calls to the local test server -- falls through to the
// real fetch, so the mock never shadows the HTTP client under test.
//
// `profilesRawJson` is a raw JSON string (not a JS object) so a test can
// hand-craft a profileId as a bare, oversized numeric literal exactly as
// Amazon's real API would send it -- constructing a JS object with a
// >2^53 numeric literal would already have lost precision before this
// mock ever ran, defeating the point of testing amazonClient.js's
// precision-preserving parser (see server/src/safeJson.js).
function mockAmazonFetch(profilesRawJson) {
  globalThis.fetch = async (url, opts) => {
    const s = String(url);
    if (s.includes('/auth/o2/token')) {
      return { ok: true, json: async () => ({ access_token: 'test-access-token', expires_in: 3600 }) };
    }
    if (s.includes('/v2/profiles')) {
      return { ok: true, text: async () => profilesRawJson };
    }
    return originalFetch(url, opts);
  };
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

describe('GET /health', () => {
  test('reports read-only', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.readOnly, true);
  });
});

describe('GET /api/amazon/status -- secrets never included in the response', () => {
  test('response body never contains the Client Secret or refresh token, in any form', async () => {
    const res = await fetch(`${baseUrl}/api/amazon/status`);
    const text = await res.text();
    assert.ok(!text.includes('super-secret-value'));
    assert.ok(!text.includes('refresh-token-value'));
    assert.ok(!text.toLowerCase().includes('clientsecret'));
  });
});

describe('POST /api/amazon/test-connection -- US profile selection', () => {
  test('succeeds when the configured profile is a US marketplace profile, even with an oversized profileId', async () => {
    mockAmazonFetch(
      `[{"profileId":${BIG_PROFILE_ID},"countryCode":"US","accountInfo":{"name":"Zaphira US"}},` +
      `{"profileId":${OTHER_BIG_PROFILE_ID},"countryCode":"CA","accountInfo":{"name":"Zaphira CA"}}]`,
    );

    const res = await fetch(`${baseUrl}/api/amazon/test-connection`, { method: 'POST' });
    const body = await res.json();

    assert.equal(body.success, true);
    assert.equal(body.marketplace, 'US');
    assert.equal(body.status, 'CONNECTED');
    assert.ok(body.profileIdMasked.endsWith(BIG_PROFILE_ID.slice(-4)));
    assert.ok(!JSON.stringify(body).includes('super-secret-value'));
  });
});

describe('POST /api/amazon/test-connection -- incorrect marketplace rejection', () => {
  test('rejects a non-US profile instead of silently using it', async () => {
    mockAmazonFetch(`[{"profileId":${BIG_PROFILE_ID},"countryCode":"CA","accountInfo":{"name":"Zaphira CA (wrong)"}}]`);

    const res = await fetch(`${baseUrl}/api/amazon/test-connection`, { method: 'POST' });
    const body = await res.json();

    assert.equal(body.success, false);
    assert.equal(body.status, 'ERROR');
    assert.match(body.error, /not a United States marketplace profile/);
    assert.match(body.error, /CA/);
  });

  test('rejects when the configured profile ID is not found in the account at all', async () => {
    mockAmazonFetch(`[{"profileId":${OTHER_BIG_PROFILE_ID},"countryCode":"US","accountInfo":{"name":"Some other account"}}]`);

    const res = await fetch(`${baseUrl}/api/amazon/test-connection`, { method: 'POST' });
    const body = await res.json();

    assert.equal(body.success, false);
    assert.match(body.error, /was not found/);
  });
});

describe('Amazon write operations are unavailable', () => {
  test('no route exists for creating/updating/deleting campaigns, bids, budgets, or keywords', async () => {
    const writeShapedRequests = [
      { method: 'POST', path: '/api/amazon/campaigns' },
      { method: 'PUT', path: '/api/amazon/campaigns/123' },
      { method: 'DELETE', path: '/api/amazon/campaigns/123' },
      { method: 'POST', path: '/api/amazon/bids' },
      { method: 'PUT', path: '/api/amazon/budgets/123' },
      { method: 'POST', path: '/api/amazon/keywords' },
      { method: 'DELETE', path: '/api/amazon/keywords/123' },
      { method: 'POST', path: '/api/amazon/negative-targeting' },
      { method: 'PATCH', path: '/api/amazon/adgroups/123' },
    ];

    for (const { method, path } of writeShapedRequests) {
      const res = await fetch(`${baseUrl}${path}`, { method });
      assert.equal(res.status, 404, `${method} ${path} should not exist (got ${res.status})`);
    }
  });
});
