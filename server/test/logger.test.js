import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.AMAZON_ADS_CLIENT_ID = 'test-client-id';
process.env.AMAZON_ADS_CLIENT_SECRET = 'super-secret-value';
process.env.AMAZON_ADS_REFRESH_TOKEN = 'refresh-token-value';
process.env.AMAZON_ADS_PROFILE_ID = '1234567890123456';

const { sanitize } = await import('../src/logger.js');

describe('logger.sanitize -- secrets never included in frontend/log output', () => {
  test('redacts the configured Client Secret wherever it appears as a substring', () => {
    const out = sanitize(`Refresh failed for secret super-secret-value during auth`);
    assert.ok(!out.includes('super-secret-value'), 'client secret leaked into sanitized output');
    assert.ok(out.includes('[REDACTED]'));
  });

  test('redacts the configured refresh token wherever it appears as a substring', () => {
    const out = sanitize(`token=refresh-token-value rejected`);
    assert.ok(!out.includes('refresh-token-value'));
  });

  test('redacts object keys named like secrets regardless of their value', () => {
    const out = sanitize({ accessToken: 'anything-at-all', clientSecret: 'anything-else', Authorization: 'Bearer xyz', profileId: '123' });
    assert.equal(out.accessToken, '[REDACTED]');
    assert.equal(out.clientSecret, '[REDACTED]');
    assert.equal(out.Authorization, '[REDACTED]');
    assert.equal(out.profileId, '123'); // non-sensitive fields pass through
  });

  test('redacts nested objects and arrays', () => {
    const out = sanitize({ nested: { refreshToken: 'x' }, list: [{ accessToken: 'y' }] });
    assert.equal(out.nested.refreshToken, '[REDACTED]');
    assert.equal(out.list[0].accessToken, '[REDACTED]');
  });

  test('sanitizes Error objects to message + name only, with secrets redacted from the message', () => {
    const out = sanitize(new Error('failed with secret super-secret-value'));
    assert.equal(out.name, 'Error');
    assert.ok(!out.message.includes('super-secret-value'));
  });
});
