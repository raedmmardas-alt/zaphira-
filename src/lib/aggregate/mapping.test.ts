import { describe, it, expect } from 'vitest';
import { resolveProductMapping, buildAdvertisedProductIndex, type MappingIndexes } from './mapping';
import type { Product, SavedAdGroupMapping } from '../../types';

const products: Product[] = [
  { id: 'rose', name: 'Rose', asin: 'B0GZVBBRZP', sku: 'ROSE-001', sellingPrice: null, aliases: ['rose'], campaignAliases: [], adGroupAliases: [] },
  { id: 'coconut', name: 'Coconut', asin: 'B0GZVGXXS2', sku: 'COCO-001', sellingPrice: null, aliases: ['coconut'], campaignAliases: [], adGroupAliases: [] },
];

const savedMappings: SavedAdGroupMapping[] = [
  { id: 'm1', campaignName: 'Auto_20260101_123456', adGroupName: 'Auto AG', productId: 'coconut', createdAt: '2026-01-01' },
];

function idx(overrides: Partial<MappingIndexes> = {}): MappingIndexes {
  return {
    products,
    advertisedProductIndex: buildAdvertisedProductIndex([]),
    savedMappings,
    ...overrides,
  };
}

describe('resolveProductMapping priority', () => {
  it('maps by ASIN first, even if SKU/name would suggest a different product', () => {
    const r = resolveProductMapping({ asin: 'B0GZVBBRZP', sku: 'COCO-001', campaign: 'Coconut Campaign' }, idx());
    expect(r.source).toBe('ASIN');
    expect(r.productId).toBe('rose');
    expect(r.confident).toBe(true);
  });

  it('falls back to SKU when ASIN is absent', () => {
    const r = resolveProductMapping({ sku: 'COCO-001', campaign: 'Unrelated Campaign' }, idx());
    expect(r.source).toBe('SKU');
    expect(r.productId).toBe('coconut');
  });

  it('falls back to the Advertised Product report mapping when ASIN/SKU are absent', () => {
    const advIdx = buildAdvertisedProductIndex([
      { campaign: 'Generic Campaign', adGroup: 'Generic AG', asin: 'B0GZVGXXS2', impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0 },
    ]);
    const r = resolveProductMapping({ campaign: 'Generic Campaign', adGroup: 'Generic AG' }, idx({ advertisedProductIndex: advIdx }));
    expect(r.source).toBe('ADVERTISED_PRODUCT_REPORT');
    expect(r.productId).toBe('coconut');
  });

  it('falls back to a saved ad-group mapping next', () => {
    const r = resolveProductMapping({ campaign: 'Auto_20260101_123456', adGroup: 'Auto AG' }, idx());
    expect(r.source).toBe('SAVED_AD_GROUP_MAPPING');
    expect(r.productId).toBe('coconut');
  });

  it('falls back to an explicit alias next', () => {
    const r = resolveProductMapping({ campaign: 'Weird Campaign Name', adGroup: 'rose scented set' }, idx());
    expect(r.source).toBe('EXPLICIT_ALIAS');
    expect(r.productId).toBe('rose');
  });

  it('uses name inference last, and flags it as NOT confident (never silently guess)', () => {
    const rose: Product = { id: 'r2', name: 'Rosewood', asin: 'X', sku: '', sellingPrice: null, aliases: [], campaignAliases: [], adGroupAliases: [] };
    const r = resolveProductMapping({ campaign: 'Rosewood Auto Campaign', adGroup: 'AG1' }, idx({ products: [rose] }));
    expect(r.source).toBe('NAME_INFERENCE');
    expect(r.confident).toBe(false);
  });

  it('returns UNMAPPED with confident=false when nothing matches (PRODUCT MAPPING REQUIRED)', () => {
    const r = resolveProductMapping({ campaign: 'Auto_20990101_999999', adGroup: 'AG_generic' }, idx({ savedMappings: [] }));
    expect(r.source).toBe('UNMAPPED');
    expect(r.productId).toBeNull();
    expect(r.confident).toBe(false);
  });

  it('does NOT false-positive match an alias as a bare substring inside an unrelated word (e.g. "rose" inside "Rosewood")', () => {
    // "Rosewood Everyday Promo" must not confidently attribute to the Rose product
    // just because "rose" is a substring of "Rosewood" — this would silently
    // misattribute an unrelated campaign's spend/sales to Rose's economics.
    const r = resolveProductMapping({ campaign: 'Rosewood Everyday Promo', adGroup: 'Generic AG' }, idx({ savedMappings: [] }));
    expect(r.source).toBe('UNMAPPED');
    expect(r.productId).toBeNull();
  });

  it('does not false-positive match "mango" inside "Flamingo" or similar unrelated substrings', () => {
    const mango: Product = { id: 'mango', name: 'Mango', asin: 'X', sku: '', sellingPrice: null, aliases: ['mango'], campaignAliases: [], adGroupAliases: [] };
    const r = resolveProductMapping({ campaign: 'Flamingo Summer Sale', adGroup: 'Generic AG' }, idx({ products: [mango], savedMappings: [] }));
    expect(r.source).toBe('UNMAPPED');
  });

  it('still matches an alias correctly at real word boundaries (punctuation, hyphens, start/end of string)', () => {
    expect(resolveProductMapping({ campaign: 'Rose-Scented Gift Set', adGroup: '' }, idx({ savedMappings: [] })).productId).toBe('rose');
    expect(resolveProductMapping({ campaign: 'Best Rose', adGroup: '' }, idx({ savedMappings: [] })).productId).toBe('rose');
    expect(resolveProductMapping({ campaign: 'rose', adGroup: '' }, idx({ savedMappings: [] })).productId).toBe('rose');
  });
});
