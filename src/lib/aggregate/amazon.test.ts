import { describe, it, expect } from 'vitest';
import { classifyPeriod, buildBaseTargets, buildEnrichedCampaigns } from './amazon';
import { buildAdvertisedProductIndex, type MappingIndexes } from './mapping';
import type { CampaignRow, Product, TargetingRow } from '../../types';

const products: Product[] = [
  { id: 'rose', name: 'Rose', asin: 'B0GZVBBRZP', sku: '', sellingPrice: null, aliases: ['rose'], campaignAliases: [], adGroupAliases: [] },
  { id: 'coconut', name: 'Coconut', asin: 'B0GZVGXXS2', sku: '', sellingPrice: null, aliases: ['coconut'], campaignAliases: [], adGroupAliases: [] },
  { id: 'vanilla', name: 'Vanilla', asin: 'B0H28WG6BB', sku: '', sellingPrice: null, aliases: ['vanilla'], campaignAliases: [], adGroupAliases: [] },
  { id: 'mango', name: 'Mango', asin: 'B0GZVP9HRB', sku: '', sellingPrice: null, aliases: ['mango'], campaignAliases: [], adGroupAliases: [] },
];

const idx: MappingIndexes = { products, advertisedProductIndex: buildAdvertisedProductIndex([]), savedMappings: [] };

describe('classifyPeriod', () => {
  const currentPeriod = { start: '2026-08-09', end: '2026-08-12' };

  it('returns null (unknown) when there is no current period established', () => {
    expect(classifyPeriod({ start: '2026-08-09', end: '2026-08-12' }, null, null)).toBeNull();
  });

  it('returns null (unknown) when the row has no date evidence at all', () => {
    expect(classifyPeriod(null, null, currentPeriod)).toBeNull();
  });

  it('classifies a row matching the current period as current', () => {
    expect(classifyPeriod({ start: '2026-08-09', end: '2026-08-12' }, null, currentPeriod)).toBe(true);
  });

  it('does NOT treat a materially wider historical range as current, even though it overlaps the tail (failure mode #7)', () => {
    // This is the spec's own example: Search Term Jul 13-Aug 12 vs Campaign/Targeting Aug 9-12.
    expect(classifyPeriod({ start: '2026-07-13', end: '2026-08-12' }, null, currentPeriod)).toBe(false);
  });

  it('classifies a row entirely before the current period as historical', () => {
    expect(classifyPeriod({ start: '2026-06-01', end: '2026-06-05' }, null, currentPeriod)).toBe(false);
  });
});

describe('duplicate keyword/product differentiation', () => {
  it('keeps identical keyword text distinct across products via campaign/ad-group context', () => {
    const rows: TargetingRow[] = [
      { campaign: 'Rose - Sponsored Products', adGroup: 'Rose AG', targetingText: 'body butter', matchType: 'exact', bid: 0.4, impressions: 100, clicks: 5, spend: 2, orders: 0, sales: 0 },
      { campaign: 'Coconut - Sponsored Products', adGroup: 'Coconut AG', targetingText: 'body butter', matchType: 'exact', bid: 0.5, impressions: 200, clicks: 8, spend: 4, orders: 0, sales: 0 },
    ];
    const targets = buildBaseTargets(rows, idx, null, null);
    expect(targets).toHaveLength(2);
    expect(new Set(targets.map((t) => t.key)).size).toBe(2); // distinct keys despite identical keyword text
    expect(targets.find((t) => t.campaign.startsWith('Rose'))?.productName).toBe('Rose');
    expect(targets.find((t) => t.campaign.startsWith('Coconut'))?.productName).toBe('Coconut');
  });

  it('keeps "body butter" distinct across all four products (Rose, Coconut, Mango, Vanilla)', () => {
    const rows: TargetingRow[] = ['Rose', 'Coconut', 'Mango', 'Vanilla'].map((name) => ({
      campaign: `${name} - Sponsored Products`,
      adGroup: `${name} AG`,
      targetingText: 'body butter',
      matchType: 'exact',
      bid: 0.4,
      impressions: 100,
      clicks: 5,
      spend: 2,
      orders: 0,
      sales: 0,
    }));
    const targets = buildBaseTargets(rows, idx, null, null);
    expect(targets).toHaveLength(4);
    expect(new Set(targets.map((t) => t.key)).size).toBe(4);
    const byProduct = new Map(targets.map((t) => [t.productName, t]));
    expect(byProduct.get('Rose')?.campaign).toBe('Rose - Sponsored Products');
    expect(byProduct.get('Coconut')?.campaign).toBe('Coconut - Sponsored Products');
    expect(byProduct.get('Mango')?.campaign).toBe('Mango - Sponsored Products');
    expect(byProduct.get('Vanilla')?.campaign).toBe('Vanilla - Sponsored Products');
  });
});

describe('low-confidence (name-inferred) mappings never drive economics decisions (never silently guess)', () => {
  it('does not attribute a product to a campaign from a weak name-only match', () => {
    // "Rose" only appears via generic name inference (no ASIN/SKU/alias/saved mapping) — must stay unmapped.
    const rows: CampaignRow[] = [
      { campaign: 'Rosewood Everyday Promo', impressions: 100, clicks: 5, spend: 2, orders: 0, sales: 0 },
    ];
    const roseOnly: Product[] = [{ id: 'rose', name: 'Rose', asin: 'X', sku: '', sellingPrice: null, aliases: [], campaignAliases: [], adGroupAliases: [] }];
    const campaigns = buildEnrichedCampaigns(rows, { products: roseOnly, advertisedProductIndex: buildAdvertisedProductIndex([]), savedMappings: [] }, null, null);
    // "Rosewood" contains "Rose" as a substring, so name inference technically fires, but low confidence must block attribution.
    expect(campaigns[0].productId).toBeNull();
    expect(campaigns[0].productName).toBeNull();
  });

  it('does not attribute a product to a target from a weak name-only match', () => {
    const rows: TargetingRow[] = [
      { campaign: 'Rosewood Everyday Promo', adGroup: 'Generic AG', targetingText: 'gift set', matchType: 'broad', bid: 0.3, impressions: 50, clicks: 2, spend: 1, orders: 0, sales: 0 },
    ];
    const roseOnly: Product[] = [{ id: 'rose', name: 'Rose', asin: 'X', sku: '', sellingPrice: null, aliases: [], campaignAliases: [], adGroupAliases: [] }];
    const targets = buildBaseTargets(rows, { products: roseOnly, advertisedProductIndex: buildAdvertisedProductIndex([]), savedMappings: [] }, null, null);
    expect(targets[0].productId).toBeNull();
    expect(targets[0].productName).toBeNull();
    expect(targets[0].mappingConfident).toBe(false);
  });
});

describe('campaign status confidence never claims live status from ENABLED alone', () => {
  it('does not treat a row-level "enabled" status as proof of current activity without date evidence', () => {
    const rows: CampaignRow[] = [
      { campaign: 'Some Campaign', status: 'enabled', impressions: 100, clicks: 5, spend: 2, orders: 0, sales: 0 },
    ];
    const campaigns = buildEnrichedCampaigns(rows, idx, null, null);
    expect(campaigns[0].statusConfidence).toBe('CURRENT_STATUS_UNKNOWN');
    expect(campaigns[0].isCurrentPeriod).toBe(false);
  });

  it('confirms current-period activity only from actual date evidence, not from status text', () => {
    const currentPeriod = { start: '2026-08-09', end: '2026-08-12' };
    const rows: CampaignRow[] = [
      { campaign: 'Some Campaign', status: 'enabled', impressions: 100, clicks: 5, spend: 2, orders: 0, sales: 0, activityStart: '2026-08-09', activityEnd: '2026-08-12' },
    ];
    const campaigns = buildEnrichedCampaigns(rows, idx, currentPeriod, currentPeriod);
    expect(campaigns[0].statusConfidence).toBe('CURRENT_ACTIVITY_CONFIRMED');
  });
});
