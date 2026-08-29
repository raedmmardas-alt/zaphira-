import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonPreservingIdFields } from '../src/safeJson.js';

describe('parseJsonPreservingIdFields', () => {
  test('preserves a profileId larger than Number.MAX_SAFE_INTEGER as an exact string', () => {
    const raw = '{"profileId":98765432109876543,"countryCode":"US"}';
    const parsed = parseJsonPreservingIdFields(raw, ['profileId']);
    assert.equal(parsed.profileId, '98765432109876543');
    assert.equal(typeof parsed.profileId, 'string');
  });

  test('plain JSON.parse would have silently rounded the same value (proves the bug this guards against)', () => {
    const raw = '{"profileId":98765432109876543}';
    const naive = JSON.parse(raw);
    assert.notEqual(String(naive.profileId), '98765432109876543', 'expected native JSON.parse to lose precision on this input');
  });

  test('works inside an array of profiles, protecting every matching field', () => {
    const raw = '[{"profileId":11111111111111111,"countryCode":"US"},{"profileId":22222222222222222,"countryCode":"CA"}]';
    const parsed = parseJsonPreservingIdFields(raw, ['profileId']);
    assert.equal(parsed[0].profileId, '11111111111111111');
    assert.equal(parsed[1].profileId, '22222222222222222');
  });

  test('leaves small, safe integers as normal numbers untouched when the field is not in the protected list', () => {
    const raw = '{"profileId":123,"impressions":456}';
    const parsed = parseJsonPreservingIdFields(raw, ['profileId']);
    assert.equal(parsed.profileId, '123'); // protected field -> always a string
    assert.equal(parsed.impressions, 456); // unprotected field -> normal number
    assert.equal(typeof parsed.impressions, 'number');
  });

  test('does not corrupt unrelated string values that happen to contain similar-looking text', () => {
    const raw = '{"profileId":5555555555555555,"accountInfo":{"name":"profileId:12345 test"}}';
    const parsed = parseJsonPreservingIdFields(raw, ['profileId']);
    assert.equal(parsed.profileId, '5555555555555555');
    assert.equal(parsed.accountInfo.name, 'profileId:12345 test');
  });
});
