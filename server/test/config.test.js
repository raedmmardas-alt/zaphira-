import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.AMAZON_ADS_CLIENT_ID = 'test-client-id';
process.env.AMAZON_ADS_CLIENT_SECRET = 'super-secret-value';
process.env.AMAZON_ADS_REFRESH_TOKEN = 'refresh-token-value';
process.env.AMAZON_ADS_PROFILE_ID = '1234567890123456';

const { isConfigured, missingConfigKeys, maskLast4, config } = await import('../src/config.js');

describe('config', () => {
  test('isConfigured is true once all required keys are set', () => {
    assert.equal(isConfigured(), true);
    assert.deepEqual(missingConfigKeys(), []);
  });

  test('maskLast4 shows only the last 4 characters', () => {
    assert.equal(maskLast4('1234567890123456'), '************3456');
    assert.equal(maskLast4('abcd'), '****');
    assert.equal(maskLast4(''), null);
    assert.equal(maskLast4(null), null);
  });

  test('region defaults to NA when unset', () => {
    assert.equal(config.region, 'NA');
  });
});

describe('config -- missing keys detection', () => {
  test('missingConfigKeys reports exactly the unset required keys', async () => {
    // Exercise the pure detection logic directly, without mutating the
    // already-imported singleton's env (module state is per-process/per-file
    // in node:test, so this checks the function's own logic against a
    // deliberately incomplete env in isolation).
    const originalSecret = process.env.AMAZON_ADS_CLIENT_SECRET;
    delete process.env.AMAZON_ADS_CLIENT_SECRET;
    assert.deepEqual(missingConfigKeys(), ['AMAZON_ADS_CLIENT_SECRET']);
    assert.equal(isConfigured(), false);
    process.env.AMAZON_ADS_CLIENT_SECRET = originalSecret;
  });
});
