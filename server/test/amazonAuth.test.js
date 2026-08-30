import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.AMAZON_ADS_CLIENT_ID = 'test-client-id';
process.env.AMAZON_ADS_CLIENT_SECRET = 'super-secret-value';
process.env.AMAZON_ADS_REFRESH_TOKEN = 'refresh-token-value';
process.env.AMAZON_ADS_PROFILE_ID = '1234567890123456';

const { getAccessToken, getTokenRefreshStatus, AmazonAuthError, __resetForTests } = await import('../src/amazonAuth.js');

const originalFetch = globalThis.fetch;

function mockFetchOnce(impl) {
  globalThis.fetch = impl;
}

describe('amazonAuth -- LWA token refresh', () => {
  beforeEach(() => {
    __resetForTests();
    globalThis.fetch = originalFetch;
  });

  test('token refresh success: posts grant_type=refresh_token and returns the access token', async () => {
    let capturedUrl = null;
    let capturedBody = null;
    mockFetchOnce(async (url, opts) => {
      capturedUrl = url;
      capturedBody = opts.body.toString();
      return {
        ok: true,
        json: async () => ({ access_token: 'fresh-access-token', expires_in: 3600 }),
      };
    });

    const token = await getAccessToken();

    assert.equal(token, 'fresh-access-token');
    assert.equal(capturedUrl, 'https://api.amazon.com/auth/o2/token');
    assert.ok(capturedBody.includes('grant_type=refresh_token'));
    assert.ok(capturedBody.includes('refresh_token=refresh-token-value'));
    assert.equal(getTokenRefreshStatus().status, 'OK');
  });

  test('a second call within the token lifetime reuses the cached token (no second network call)', async () => {
    let callCount = 0;
    mockFetchOnce(async () => {
      callCount++;
      return { ok: true, json: async () => ({ access_token: 'cached-token', expires_in: 3600 }) };
    });

    const first = await getAccessToken();
    const second = await getAccessToken();

    assert.equal(first, 'cached-token');
    assert.equal(second, 'cached-token');
    assert.equal(callCount, 1);
  });

  test('token refresh failure: Amazon rejects the refresh token', async () => {
    mockFetchOnce(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'The refresh token is invalid.' }),
    }));

    await assert.rejects(() => getAccessToken(), AmazonAuthError);
    const status = getTokenRefreshStatus();
    assert.equal(status.status, 'FAILED');
    assert.ok(!status.error.includes('super-secret-value'));
    assert.ok(!status.error.includes('refresh-token-value'));
  });

  test('token refresh failure: network error never throws a raw secret-bearing error', async () => {
    mockFetchOnce(async () => { throw new Error('ECONNREFUSED'); });

    await assert.rejects(() => getAccessToken(), (err) => {
      assert.ok(err instanceof AmazonAuthError);
      assert.ok(!err.message.includes('super-secret-value'));
      return true;
    });
  });

  test('the request body used to obtain the token is never exposed in the resolved value or thrown error', async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }));
    const token = await getAccessToken();
    assert.equal(typeof token, 'string');
    assert.ok(!token.includes('super-secret-value'));
  });
});
