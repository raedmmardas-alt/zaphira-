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

describe('matchType alias resolution', () => {
  it('resolves the standard and less-common real-export variants to the canonical "matchType" field', () => {
    for (const alias of ['Match type', 'MATCH TYPE', 'Targeting type', 'Keyword match type', 'Match']) {
      expect(resolveCanonicalField(alias)).toBe('matchType');
    }
  });
});

describe('adSpend alias resolution — real Sellerboard "Sponsored products (PPC)" column', () => {
  it('resolves "Sponsored products (PPC)" to the canonical "adSpend" field, case-insensitively and whitespace-tolerantly', () => {
    for (const alias of ['Sponsored products (PPC)', 'sponsored products (ppc)', 'SPONSORED PRODUCTS (PPC)', '  Sponsored   products (PPC)  ', 'Sponsored products ( PPC )']) {
      expect(resolveCanonicalField(alias)).toBe('adSpend');
    }
  });

  it('still resolves the pre-existing adSpend aliases (no regression)', () => {
    for (const alias of ['Ads spend', 'Ad spend', 'Advertising cost', 'Advertising spend']) {
      expect(resolveCanonicalField(alias)).toBe('adSpend');
    }
  });

  it('resolves the older Sellerboard "SponsoredProducts" (no spaces) and "Sponsored Products" (no PPC suffix) column variants to adSpend', () => {
    for (const alias of ['SponsoredProducts', 'sponsoredproducts', 'SPONSOREDPRODUCTS', 'Sponsored Products', 'sponsored products', '  Sponsored   Products  ']) {
      expect(resolveCanonicalField(alias)).toBe('adSpend');
    }
  });

  it('never maps the bare "Ads" column to adSpend — that total spans every ad type (Sponsored Products, Display, Brands, Brands Video), not just Sponsored Products PPC', () => {
    expect(resolveCanonicalField('Ads')).toBeNull();
  });

  it('builds a header map that prefers "Sponsored products (PPC)" and never lets the unrelated "Sponsored Display" / "Sponsored brands (HSA)" / "Sponsored Brands Video" columns resolve to adSpend', () => {
    const map = buildHeaderMap(['Ads', 'Sponsored products (PPC)', 'Sponsored Display', 'Sponsored brands (HSA)', 'Sponsored Brands Video']);
    expect(map.adSpend).toBe('Sponsored products (PPC)');
  });
});
