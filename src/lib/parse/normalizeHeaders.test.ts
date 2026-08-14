import { describe, it, expect } from 'vitest';
import { buildHeaderMap, resolveCanonicalField } from './normalizeHeaders';

describe('spend alias resolution', () => {
  it('resolves "Total cost" (current Amazon Sponsored Products terminology) to the canonical "spend" field', () => {
    expect(resolveCanonicalField('Total cost')).toBe('spend');
    expect(resolveCanonicalField('total cost')).toBe('spend');
  });

  it('still resolves the pre-existing spend aliases (no alias regression)', () => {
    for (const alias of ['Spend', 'Cost', 'Amount spent', 'Spend (USD)']) {
      expect(resolveCanonicalField(alias)).toBe('spend');
    }
  });

  it('builds a header map that keeps only the first matching spend column, never overwriting it with a second alias', () => {
    const map = buildHeaderMap(['Campaign name', 'Spend', 'Total cost']);
    expect(map.spend).toBe('Spend');
  });
});
