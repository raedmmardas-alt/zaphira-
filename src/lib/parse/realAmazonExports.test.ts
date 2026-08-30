import { describe, it, expect } from 'vitest';
import {
  importAdvertisedProductReport, importCampaignReport, importSearchTermReport, importTargetingReport,
} from './reportImporters';
import type { RawParsedFile } from './fileParser';

// Regression fixtures built from real current Amazon Sponsored Products
// export headers. Each of these was previously rejected with
// "REPORT FORMAT NOT RECOGNIZED" against a required field that Amazon's
// current terminology no longer spells the way this app expected.
const FILE = { name: 'real_amazon_export.csv', size: 2048 };

describe('real Amazon Campaign report format', () => {
  const file: RawParsedFile = {
    headers: ['Date range', 'Campaign name', 'Impressions', 'Clicks', 'Total cost', 'Purchases', 'Sales'],
    rows: [
      { 'Date range': 'Aug 9-Aug 12, 2026', 'Campaign name': 'Rose - Sponsored Products', Impressions: '5000', Clicks: '52', 'Total cost': '16.00', Purchases: '4', Sales: '110.00' },
    ],
  };

  it('parses successfully with spend from "Total cost"', () => {
    const { meta, rows } = importCampaignReport(FILE, file);
    expect(meta.status).not.toBe('FORMAT_NOT_RECOGNIZED');
    expect(meta.missingRequiredFields).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe(16.0);
    expect(rows[0].orders).toBe(4);
    expect(rows[0].sales).toBe(110.0);
    expect(rows[0].activityStart).toBe('2026-08-09');
    expect(rows[0].activityEnd).toBe('2026-08-12');
  });
});

describe('real Amazon Targeting report format', () => {
  const file: RawParsedFile = {
    headers: ['Date range', 'Campaign name', 'Ad group name', 'Targeting', 'Impressions', 'Clicks', 'Total cost', 'Purchases', 'Sales'],
    rows: [
      { 'Date range': 'Aug 9-Aug 12, 2026', 'Campaign name': 'Vanilla - Sponsored Products', 'Ad group name': 'Vanilla AG', Targeting: 'body butter', Impressions: '600', Clicks: '11', 'Total cost': '9.23', Purchases: '0', Sales: '0' },
    ],
  };

  it('parses successfully with spend from "Total cost" and targetingText from "Targeting"', () => {
    const { meta, rows } = importTargetingReport(FILE, file);
    expect(meta.status).not.toBe('FORMAT_NOT_RECOGNIZED');
    expect(meta.missingRequiredFields).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe(9.23);
    expect(rows[0].targetingText).toBe('body butter');
    expect(rows[0].orders).toBe(0);
  });
});

describe('real Amazon Search Term report format', () => {
  const file: RawParsedFile = {
    headers: ['Date range', 'Campaign name', 'Ad group name', 'Search term', 'Impressions', 'Clicks', 'Total cost', 'Purchases', 'Sales'],
    rows: [
      { 'Date range': 'Aug 9-Aug 12, 2026', 'Campaign name': 'Rose - Sponsored Products', 'Ad group name': 'Rose AG', 'Search term': 'rose body butter', Impressions: '1800', Clicks: '40', 'Total cost': '12.00', Purchases: '3', Sales: '90.00' },
    ],
  };

  it('parses successfully — "Search term" resolves to the searchTerm field, not "Missing required fields: searchTerm"', () => {
    const { meta, rows } = importSearchTermReport(FILE, file);
    expect(meta.status).not.toBe('FORMAT_NOT_RECOGNIZED');
    expect(meta.missingRequiredFields).not.toContain('searchTerm');
    expect(meta.missingRequiredFields).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].searchTerm).toBe('rose body butter');
    expect(rows[0].spend).toBe(12.0);
    expect(rows[0].orders).toBe(3);
  });

  it('is case/spacing-normalized ("SEARCH TERM", "  Search Term  " all resolve the same way)', () => {
    for (const header of ['SEARCH TERM', '  Search Term  ', 'search term']) {
      const variant: RawParsedFile = {
        headers: ['Campaign name', 'Ad group name', header, 'Impressions', 'Clicks', 'Total cost'],
        rows: [{ 'Campaign name': 'C', 'Ad group name': 'AG', [header]: 'some term', Impressions: '10', Clicks: '1', 'Total cost': '1.00' }],
      };
      const { meta, rows } = importSearchTermReport(FILE, variant);
      expect(meta.missingRequiredFields).not.toContain('searchTerm');
      expect(rows[0].searchTerm).toBe('some term');
    }
  });

  it('does not duplicate "search term" onto another canonical field (it must resolve to searchTerm only, not also "keyword")', () => {
    const { meta } = importSearchTermReport(FILE, file);
    // Only one column should ever be consumed for the search term value.
    expect(meta.detectedColumns.filter((c) => c.toLowerCase() === 'search term')).toHaveLength(1);
  });
});

describe('real Amazon Advertised Product report format', () => {
  const file: RawParsedFile = {
    headers: [
      'Date range', 'Campaign name', 'Ad group name', 'Advertised product', 'Advertised product SKU',
      'Impressions', 'Clicks', 'Total cost', 'Purchases', 'Sales',
    ],
    rows: [
      {
        'Date range': 'Aug 9-Aug 12, 2026', 'Campaign name': 'Rose - Sponsored Products', 'Ad group name': 'Rose AG',
        'Advertised product': 'B0GZVBBRZP', 'Advertised product SKU': 'ROSE-001',
        Impressions: '5000', Clicks: '52', 'Total cost': '16.00', Purchases: '4', Sales: '110.00',
      },
    ],
  };

  it('parses successfully — "Advertised product" resolves to asin, not "Missing required fields: asin"', () => {
    const { meta, rows } = importAdvertisedProductReport(FILE, file);
    expect(meta.status).not.toBe('FORMAT_NOT_RECOGNIZED');
    expect(meta.missingRequiredFields).not.toContain('asin');
    expect(meta.missingRequiredFields).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].asin).toBe('B0GZVBBRZP');
    expect(rows[0].spend).toBe(16.0);
  });

  it('maps "Advertised product SKU" to sku, never to asin (no confusion between the two identifier columns)', () => {
    const { rows } = importAdvertisedProductReport(FILE, file);
    expect(rows[0].sku).toBe('ROSE-001');
    expect(rows[0].asin).toBe('B0GZVBBRZP');
    expect(rows[0].asin).not.toBe(rows[0].sku);
  });

  it('does not let "Advertised product parent ID/marketplace/category" collide with the asin or sku columns', () => {
    const fileWithExtraColumns: RawParsedFile = {
      headers: [
        'Campaign name', 'Ad group name', 'Advertised product', 'Advertised product SKU',
        'Advertised product parent ID', 'Advertised product marketplace', 'Advertised product category',
        'Impressions', 'Clicks', 'Total cost',
      ],
      rows: [{
        'Campaign name': 'Rose - Sponsored Products', 'Ad group name': 'Rose AG',
        'Advertised product': 'B0GZVBBRZP', 'Advertised product SKU': 'ROSE-001',
        'Advertised product parent ID': 'PARENT123', 'Advertised product marketplace': 'US', 'Advertised product category': 'Beauty',
        Impressions: '5000', Clicks: '52', 'Total cost': '16.00',
      }],
    };
    const { rows } = importAdvertisedProductReport(FILE, fileWithExtraColumns);
    expect(rows[0].asin).toBe('B0GZVBBRZP'); // not "PARENT123", "US", or "Beauty"
    expect(rows[0].sku).toBe('ROSE-001');
  });

  it('parses the exact real-export header set — "Advertised product ID" (not "Advertised product") resolves to asin', () => {
    // Verified against an actual current Amazon Advertised Product CSV export.
    const realExport: RawParsedFile = {
      headers: [
        'Budget currency', 'Date range', 'Campaign ID', 'Campaign name', 'Ad group ID', 'Ad group name',
        'Advertised product ID', 'Advertised product name', 'Advertised product parent ID', 'Advertised product brand',
        'Advertised product category', 'Advertised product subcategory', 'Advertised product group', 'Advertised product SKU',
        'Advertised product marketplace', 'Impressions', 'Clicks', 'CTR', 'Total cost', 'Purchases', 'Sales',
      ],
      rows: [{
        'Budget currency': 'USD', 'Date range': 'Aug 9-Aug 12, 2026', 'Campaign ID': 'C123', 'Campaign name': 'Coconut - Sponsored Products',
        'Ad group ID': 'AG456', 'Ad group name': 'Coconut AG',
        'Advertised product ID': 'B0GZVGXXS2', 'Advertised product name': 'Coconut Body Butter', 'Advertised product parent ID': 'PARENT789',
        'Advertised product brand': 'Zaphira', 'Advertised product category': 'Beauty', 'Advertised product subcategory': 'Body Care',
        'Advertised product group': 'Body Butters', 'Advertised product SKU': 'COCO-001', 'Advertised product marketplace': 'US',
        Impressions: '3000', Clicks: '25', CTR: '0.83%', 'Total cost': '18.00', Purchases: '0', Sales: '0',
      }],
    };

    const { meta, rows } = importAdvertisedProductReport(FILE, realExport);
    expect(meta.status).not.toBe('FORMAT_NOT_RECOGNIZED');
    expect(meta.missingRequiredFields).not.toContain('asin');
    expect(meta.missingRequiredFields).toHaveLength(0);
    expect(rows).toHaveLength(1);

    // The required assertion: "Advertised product ID" -> asin, exact value.
    expect(rows[0].asin).toBe('B0GZVGXXS2');

    // Preserve SKU, and make sure none of the other "Advertised product ..."
    // columns (name/parent ID/marketplace/brand/category/subcategory/group)
    // ever leak into the asin or sku fields.
    expect(rows[0].sku).toBe('COCO-001');
    expect(rows[0].asin).not.toBe('PARENT789');
    expect(rows[0].asin).not.toBe('US');
    expect(rows[0].asin).not.toBe('Coconut Body Butter');

    // Preceding fixes remain intact on this same real header set.
    expect(rows[0].spend).toBe(18.0);
    expect(rows[0].activityStart).toBe('2026-08-09');
    expect(rows[0].activityEnd).toBe('2026-08-12');
  });
});
