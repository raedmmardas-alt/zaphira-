import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.AMAZON_ADS_CLIENT_ID = 'test-client-id';
process.env.AMAZON_ADS_CLIENT_SECRET = 'super-secret-value';
process.env.AMAZON_ADS_REFRESH_TOKEN = 'refresh-token-value';
process.env.AMAZON_ADS_PROFILE_ID = '1234567890123456';

const originalCorsAllowedOrigin = process.env.CORS_ALLOWED_ORIGIN;

afterEach(() => {
  if (originalCorsAllowedOrigin === undefined) delete process.env.CORS_ALLOWED_ORIGIN;
  else process.env.CORS_ALLOWED_ORIGIN = originalCorsAllowedOrigin;
});

describe('isAllowedOrigin -- localhost unchanged, production origin added, nothing else allowed', () => {
  test('always allows localhost/127.0.0.1 origins at any port, regardless of environment', async () => {
    const { isAllowedOrigin } = await import('../src/app.js');
    assert.equal(isAllowedOrigin('http://localhost:5173'), true);
    assert.equal(isAllowedOrigin('http://127.0.0.1:5173'), true);
    assert.equal(isAllowedOrigin('http://localhost'), true);
    assert.equal(isAllowedOrigin('https://127.0.0.1:4001'), true);
  });

  test('allows requests with no Origin header (unchanged pre-existing behavior for non-browser callers)', async () => {
    const { isAllowedOrigin } = await import('../src/app.js');
    assert.equal(isAllowedOrigin(undefined), true);
    assert.equal(isAllowedOrigin(''), true);
  });

  test('allows the default production origin (https://zaphira.raedmirdas.com)', async () => {
    delete process.env.CORS_ALLOWED_ORIGIN;
    const { isAllowedOrigin } = await import('../src/app.js');
    assert.equal(isAllowedOrigin('https://zaphira.raedmirdas.com'), true);
  });

  test('rejects an unrelated/arbitrary origin', async () => {
    const { isAllowedOrigin } = await import('../src/app.js');
    assert.equal(isAllowedOrigin('https://evil.example.com'), false);
    assert.equal(isAllowedOrigin('http://zaphira.raedmirdas.com'), false); // http, not https -- not an exact match
    assert.equal(isAllowedOrigin('https://zaphira.raedmirdas.com.evil.com'), false); // suffix trick
  });
});
