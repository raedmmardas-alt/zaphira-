import { describe, it, expect } from 'vitest';
import {
  importAdvertisedProductReport, importCampaignReport, importSearchTermReport, importSellerboardProductReport, importTargetingReport,
} from './reportImporters';
import type { RawParsedFile } from './fileParser';

const FILE = { name: 'campaign_report.csv', size: 1234 };

// Realistic current Amazon Sponsored Products Campaign export headers —
// this is the exact shape that was rejected with
// "REPORT FORMAT NOT RECOGNIZED — Missing required fields: spend"
// because "Total cost" (not "Spend") is Amazon's current column name.
function realAmazonCampaignFile(): RawParsedFile {
  return {
    headers: ['Date range', 'Campaign name', 'Impressions', 'Clicks', 'Total cost', 'Purchases', 'Sales'],
    rows: [
      { 'Date range': 'Aug 9-Aug 12, 2026', 'Campaign name': 'Rose - Sponsored Products', Impressions: '5000', Clicks: '52', 'Total cost': '16.00', Purchases: '4', Sales: '110.00' },
      { 'Date range': 'Aug 9-Aug 12, 2026', 'Campaign name': 'Vanilla - Sponsored Products', Impressions: '600', Clicks: '11', 'Total cost': '9.23', Purchases: '0', Sales: '0' },
    ],
  };
}

describe('Amazon "Total cost" column recognition (real-format regression)', () => {
  it('recognizes "Total cost" as the canonical spend field in a Campaign report and parses successfully', () => {
    const { meta, rows } = importCampaignReport(FILE, realAmazonCampaignFile());
    expect(meta.status).not.toBe('FORMAT_NOT_RECOGNIZED');
    expect(meta.missingRequiredFields).not.toContain('spend');
    expect(rows).toHaveLength(2);
    expect(rows[0].spend).toBe(16.0);
    expect(rows[1].spend).toBe(9.23);
  });

  it('also recognizes "Purchases" as orders and "Date range" as the activity period (report parses, only degraded by genuinely absent optional columns like status/budget)', () => {
    const { meta, rows } = importCampaignReport(FILE, realAmazonCampaignFile());
    expect(meta.status).toBe('DEGRADED');
    expect(meta.missingRequiredFields).toHaveLength(0);
    expect(rows[0].orders).toBe(4);
    expect(rows[0].sales).toBe(110.0);
    expect(rows[0].activityStart).toBe('2026-08-09');
    expect(rows[0].activityEnd).toBe('2026-08-12');
  });

  it('does not double count spend when both "Spend" and "Total cost" columns are present — only one canonical value is read', () => {
    const file: RawParsedFile = {
      headers: ['Campaign name', 'Impressions', 'Clicks', 'Spend', 'Total cost', 'Purchases', 'Sales'],
      rows: [{ 'Campaign name': 'Rose - Sponsored Products', Impressions: '100', Clicks: '10', Spend: '5.00', 'Total cost': '999.00', Purchases: '1', Sales: '20.00' }],
    };
    const { rows } = importCampaignReport(FILE, file);
    // The first matching column in header order ("Spend") wins; "Total cost" is ignored, never summed in.
    expect(rows[0].spend).toBe(5.0);
  });

  it('recognizes "Total cost" for Targeting, Search Term, and Advertised Product reports too', () => {
    const targeting = importTargetingReport(FILE, {
      headers: ['Campaign name', 'Ad group name', 'Targeting', 'Match type', 'Impressions', 'Clicks', 'Total cost', 'Purchases', 'Sales'],
      rows: [{ 'Campaign name': 'Vanilla - Sponsored Products', 'Ad group name': 'Vanilla AG', Targeting: 'body butter', 'Match type': 'exact', Impressions: '600', Clicks: '11', 'Total cost': '9.23', Purchases: '0', Sales: '0' }],
    });
    expect(targeting.meta.missingRequiredFields).not.toContain('spend');
    expect(targeting.rows[0].spend).toBe(9.23);

    const searchTerm = importSearchTermReport(FILE, {
      headers: ['Campaign name', 'Ad group name', 'Customer Search Term', 'Impressions', 'Clicks', 'Total cost', 'Purchases', 'Sales'],
      rows: [{ 'Campaign name': 'Rose - Sponsored Products', 'Ad group name': 'Rose AG', 'Customer Search Term': 'rose body butter', Impressions: '1800', Clicks: '40', 'Total cost': '12.00', Purchases: '3', Sales: '90.00' }],
    });
    expect(searchTerm.meta.missingRequiredFields).not.toContain('spend');
    expect(searchTerm.rows[0].spend).toBe(12.0);

    const advertisedProduct = importAdvertisedProductReport(FILE, {
      headers: ['Campaign name', 'Ad group name', 'Advertised ASIN', 'Impressions', 'Clicks', 'Total cost', 'Purchases', 'Sales'],
      rows: [{ 'Campaign name': 'Rose - Sponsored Products', 'Ad group name': 'Rose AG', 'Advertised ASIN': 'B0GZVBBRZP', Impressions: '5000', Clicks: '52', 'Total cost': '16.00', Purchases: '4', Sales: '110.00' }],
    });
    expect(advertisedProduct.meta.missingRequiredFields).not.toContain('spend');
    expect(advertisedProduct.rows[0].spend).toBe(16.0);
  });
});

describe('Targeting report matchType honesty (only "unknown" when the column is truly absent)', () => {
  it('reads the real match type value when the column is present, under any of the recognized header variants', () => {
    for (const header of ['Match type', 'Targeting type', 'Keyword match type', 'Match']) {
      const { rows } = importTargetingReport(FILE, {
        headers: ['Campaign name', 'Ad group name', 'Targeting', header, 'Impressions', 'Clicks', 'Total cost'],
        rows: [{ 'Campaign name': 'Rose - Sponsored Products', 'Ad group name': 'Rose AG', Targeting: 'rose body butter', [header]: 'Broad', Impressions: '400', Clicks: '9', 'Total cost': '3.60' }],
      });
      expect(rows[0].matchType).toBe('Broad');
    }
  });

  it('only falls back to the "unknown" sentinel when the report truly has no match-type column at all', () => {
    const { rows } = importTargetingReport(FILE, {
      headers: ['Campaign name', 'Ad group name', 'Targeting', 'Impressions', 'Clicks', 'Total cost'],
      rows: [{ 'Campaign name': 'Rose - Sponsored Products', 'Ad group name': 'Rose AG', Targeting: 'rose body butter', Impressions: '400', Clicks: '9', 'Total cost': '3.60' }],
    });
    expect(rows[0].matchType).toBe('unknown');
  });
});

describe('Sellerboard Product report "Sponsored products (PPC)" column (real-export regression)', () => {
  // The real Sellerboard Product Profitability export has FIVE separate ad
  // columns: "Ads" (total across every ad type), "Sponsored products
  // (PPC)", "Sponsored Display", "Sponsored brands (HSA)", and "Sponsored
  // Brands Video". Only "Sponsored products (PPC)" corresponds to what
  // Amazon's own (Sponsored-Products-only) Campaign report spend
  // represents — this is the exact shape that previously parsed adSpend as
  // 0 for every row (no alias matched "Sponsored products (PPC)"),
  // producing a false "Sellerboard PPC spend supplied to reconciliation =
  // 0.00" and a false DATA MISMATCH REVIEW REQUIRED against real spend.
  const realHeaders = [
    'Marketplace', 'ASIN', 'SKU', 'Ads', 'Sponsored products (PPC)', 'Sponsored Display', 'Sponsored brands (HSA)', 'Sponsored Brands Video',
  ];
  const realFile = { name: 'sellerboard_product_2026-08-14_to_2026-08-17.csv', size: 4321 };

  it('parses the exact real per-product "Sponsored products (PPC)" values (Rose -2.42, Coconut -18.25, Mango 0, Vanilla -3.21)', () => {
    const raw: RawParsedFile = {
      headers: realHeaders,
      rows: [
        { Marketplace: 'US', ASIN: 'B0GZVBBRZP', SKU: 'ROSE-001', Ads: '-4.10', 'Sponsored products (PPC)': '-2.42', 'Sponsored Display': '-1.68', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
        { Marketplace: 'US', ASIN: 'B0GZVGXXS2', SKU: 'COCO-001', Ads: '-18.25', 'Sponsored products (PPC)': '-18.25', 'Sponsored Display': '0', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
        { Marketplace: 'US', ASIN: 'B0GZVP9HRB', SKU: 'MANGO-001', Ads: '0', 'Sponsored products (PPC)': '0', 'Sponsored Display': '0', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
        { Marketplace: 'US', ASIN: 'B0H28WG6BB', SKU: 'VAN-001', Ads: '-3.21', 'Sponsored products (PPC)': '-3.21', 'Sponsored Display': '0', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
      ],
    };
    const { meta, rows } = importSellerboardProductReport(realFile, raw);

    const bySku = Object.fromEntries(rows.map((r) => [r.sku, r.adSpend]));
    expect(bySku['ROSE-001']).toBe(-2.42);
    expect(bySku['COCO-001']).toBe(-18.25);
    expect(bySku['MANGO-001']).toBe(0);
    expect(bySku['VAN-001']).toBe(-3.21);

    // Requirement #9: adSpend must no longer be reported as missing when
    // "Sponsored products (PPC)" exists in the file.
    expect(meta.missingOptionalFields).not.toContain('adSpend');

    // The raw signed value is preserved as-is — sign normalization for
    // reconciliation/accounting happens later, at aggregation, not here.
    const total = rows.reduce((a, r) => a + r.adSpend, 0);
    expect(total).toBeCloseTo(-23.88);
    expect(Math.abs(total)).toBeCloseTo(23.88);
  });

  it('never reads the bare "Ads" column as adSpend, even though it is present in the same file', () => {
    const raw: RawParsedFile = {
      headers: realHeaders,
      rows: [
        { Marketplace: 'US', ASIN: 'B0GZVGXXS2', SKU: 'COCO-001', Ads: '-99.99', 'Sponsored products (PPC)': '-18.25', 'Sponsored Display': '0', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
      ],
    };
    const { rows } = importSellerboardProductReport(realFile, raw);
    // If "Ads" (a total across all ad types) had been used instead, this
    // would be -99.99, not the Sponsored-Products-only figure.
    expect(rows[0].adSpend).toBe(-18.25);
  });

  it('parses the exact "Product/ASIN/SKU/Ads/Sponsored products (PPC)/..." header/value set for Rose, Coconut, Mango, Vanilla and totals -23.88', () => {
    const raw: RawParsedFile = {
      headers: ['Product', 'ASIN', 'SKU', 'Ads', 'Sponsored products (PPC)', 'Sponsored Display', 'Sponsored brands (HSA)', 'Sponsored Brands Video'],
      rows: [
        { Product: 'Rose', ASIN: 'B0GZVBBRZP', SKU: 'ROSE-001', Ads: '-2.42', 'Sponsored products (PPC)': '-2.42', 'Sponsored Display': '0', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
        { Product: 'Coconut', ASIN: 'B0GZVGXXS2', SKU: 'COCO-001', Ads: '-18.25', 'Sponsored products (PPC)': '-18.25', 'Sponsored Display': '0', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
        { Product: 'Mango', ASIN: 'B0GZVP9HRB', SKU: 'MANGO-001', Ads: '0', 'Sponsored products (PPC)': '0', 'Sponsored Display': '0', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
        { Product: 'Vanilla', ASIN: 'B0H28WG6BB', SKU: 'VAN-001', Ads: '-3.21', 'Sponsored products (PPC)': '-3.21', 'Sponsored Display': '0', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
      ],
    };
    const { meta, rows } = importSellerboardProductReport(realFile, raw);

    expect(meta.missingOptionalFields).not.toContain('adSpend');
    const total = rows.reduce((a, r) => a + r.adSpend, 0);
    expect(total).toBeCloseTo(-23.88);
  });

  it('also recognizes the older "SponsoredProducts" (no spaces, no PPC suffix) column name used by some Sellerboard export versions', () => {
    const raw: RawParsedFile = {
      headers: ['Marketplace', 'ASIN', 'SKU', 'Ads', 'SponsoredProducts', 'Sponsored Display'],
      rows: [
        { Marketplace: 'US', ASIN: 'B0GZVBBRZP', SKU: 'ROSE-001', Ads: '-2.42', SponsoredProducts: '-2.42', 'Sponsored Display': '0' },
        { Marketplace: 'US', ASIN: 'B0GZVGXXS2', SKU: 'COCO-001', Ads: '-18.25', SponsoredProducts: '-18.25', 'Sponsored Display': '0' },
        { Marketplace: 'US', ASIN: 'B0GZVP9HRB', SKU: 'MANGO-001', Ads: '0', SponsoredProducts: '0', 'Sponsored Display': '0' },
        { Marketplace: 'US', ASIN: 'B0H28WG6BB', SKU: 'VAN-001', Ads: '-3.21', SponsoredProducts: '-3.21', 'Sponsored Display': '0' },
      ],
    };
    const { meta, rows } = importSellerboardProductReport(realFile, raw);

    expect(meta.missingOptionalFields).not.toContain('adSpend');
    const total = rows.reduce((a, r) => a + r.adSpend, 0);
    expect(total).toBeCloseTo(-23.88);
  });
});
