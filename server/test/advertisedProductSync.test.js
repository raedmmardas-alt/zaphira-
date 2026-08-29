import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { syncAdvertisedProductData } from '../src/advertisedProductSync.js';

const CAMPAIGNS = [{ campaignId: 111, name: 'Coconut - Sponsored Products' }];
const AD_GROUPS = [{ adGroupId: 999, campaignId: 111, name: 'Coconut - Broad' }];

describe('syncAdvertisedProductData -- normalizes performance rows for product mapping', () => {
  test('normalizes into the exact AdvertisedProductRow shape (same field names as the manual CSV importer)', async () => {
    const deps = {
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchAdvertisedProductPerformanceReport: async () => [
        { campaignId: 111, adGroupId: 999, advertisedAsin: 'B0EXAMPLE123', advertisedSku: 'COCO-16OZ', impressions: 300, clicks: 15, cost: 9.5, purchases1d: 2, sales1d: 39.98 },
      ],
    };
    const result = await syncAdvertisedProductData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows.length, 1);
    const row = result.rows[0];

    assert.deepEqual(Object.keys(row).sort(), [
      'activityEnd', 'activityStart', 'adGroup', 'asin', 'campaign', 'clicks', 'impressions', 'orders', 'sales', 'sku', 'spend',
    ]);
    assert.equal(row.campaign, 'Coconut - Sponsored Products');
    assert.equal(row.adGroup, 'Coconut - Broad');
    assert.equal(row.asin, 'B0EXAMPLE123');
    assert.equal(row.sku, 'COCO-16OZ');
    assert.equal(row.spend, 9.5);
    assert.equal(row.sales, 39.98);
  });

  test('zero-sales advertised products report a real 0, never a fabricated non-zero value', async () => {
    const deps = {
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchAdvertisedProductPerformanceReport: async () => [
        { campaignId: 111, adGroupId: 999, advertisedAsin: 'B0EXAMPLE123', impressions: 40, clicks: 2, cost: 0.8, purchases1d: 0, sales1d: 0 },
      ],
    };
    const result = await syncAdvertisedProductData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows[0].orders, 0);
    assert.equal(result.rows[0].sales, 0);
  });

  test('a row without an ASIN is dropped, matching importAdvertisedProductReport\'s own filter', async () => {
    const deps = {
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchAdvertisedProductPerformanceReport: async () => [
        { campaignId: 111, adGroupId: 999, advertisedAsin: '', impressions: 1, clicks: 1, cost: 1, purchases1d: 0, sales1d: 0 },
      ],
    };
    const result = await syncAdvertisedProductData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows.length, 0);
  });

  test('a row whose campaign name could not be resolved is dropped, matching importAdvertisedProductReport\'s own filter', async () => {
    const deps = {
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchAdvertisedProductPerformanceReport: async () => [
        { campaignId: 999999, adGroupId: 999, advertisedAsin: 'B0ORPHAN', impressions: 1, clicks: 1, cost: 1, purchases1d: 0, sales1d: 0 },
      ],
    };
    const result = await syncAdvertisedProductData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows.length, 0);
  });

  test('passes the requested date range straight through to the report fetcher, unmodified', async () => {
    let capturedStart = null;
    let capturedEnd = null;
    const deps = {
      listSpCampaigns: async () => [],
      listSpAdGroups: async () => [],
      fetchAdvertisedProductPerformanceReport: async (start, end) => {
        capturedStart = start;
        capturedEnd = end;
        return [];
      },
    };
    await syncAdvertisedProductData('2026-08-09', '2026-08-12', deps);
    assert.equal(capturedStart, '2026-08-09');
    assert.equal(capturedEnd, '2026-08-12');
  });
});
