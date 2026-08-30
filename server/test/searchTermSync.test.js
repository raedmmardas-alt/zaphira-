import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { syncSearchTermData } from '../src/searchTermSync.js';

const CAMPAIGNS = [{ campaignId: 111, name: 'Coconut - Sponsored Products' }];
const AD_GROUPS = [{ adGroupId: 999, campaignId: 111, name: 'Coconut - Broad' }];

describe('syncSearchTermData -- normalizes performance-only rows (no live status concept)', () => {
  test('normalizes into the exact SearchTermRow shape (same field names as the manual CSV importer)', async () => {
    const deps = {
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchSearchTermPerformanceReport: async () => [
        { campaignId: 111, adGroupId: 999, searchTerm: 'organic coconut oil', keyword: 'coconut oil', matchType: 'BROAD', impressions: 200, clicks: 9, cost: 6.2, purchases1d: 1, sales1d: 19.99 },
      ],
    };
    const result = await syncSearchTermData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows.length, 1);
    const row = result.rows[0];

    assert.deepEqual(Object.keys(row).sort(), [
      'activityEnd', 'activityStart', 'adGroup', 'campaign', 'clicks', 'impressions',
      'matchType', 'orders', 'sales', 'searchTerm', 'spend', 'targetingText',
    ]);
    assert.equal(row.campaign, 'Coconut - Sponsored Products');
    assert.equal(row.adGroup, 'Coconut - Broad');
    assert.equal(row.searchTerm, 'organic coconut oil');
    assert.equal(row.targetingText, 'coconut oil');
    assert.equal(row.matchType, 'BROAD');
    assert.equal(row.spend, 6.2);
    assert.equal(row.sales, 19.99);
    // Search terms are period-performance data only -- no status field
    // exists on this row at all, matching SearchTermRow's own shape.
    assert.equal('status' in row, false);
  });

  test('zero-sales search terms report a real 0, never a fabricated non-zero value', async () => {
    const deps = {
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchSearchTermPerformanceReport: async () => [
        { campaignId: 111, adGroupId: 999, searchTerm: 'irrelevant query', keyword: 'coconut oil', matchType: 'BROAD', impressions: 50, clicks: 3, cost: 1.1, purchases1d: 0, sales1d: 0 },
      ],
    };
    const result = await syncSearchTermData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows[0].orders, 0);
    assert.equal(result.rows[0].sales, 0);
  });

  test('a row whose campaign/ad-group name could not be resolved is dropped, matching importSearchTermReport\'s own "never fabricate" filter', async () => {
    const deps = {
      listSpCampaigns: async () => CAMPAIGNS, // does not contain campaignId 999999
      listSpAdGroups: async () => AD_GROUPS,
      fetchSearchTermPerformanceReport: async () => [
        { campaignId: 999999, adGroupId: 999, searchTerm: 'orphaned term', keyword: 'k', matchType: 'BROAD', impressions: 1, clicks: 1, cost: 1, purchases1d: 0, sales1d: 0 },
      ],
    };
    const result = await syncSearchTermData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows.length, 0);
  });

  test('a row with a blank search term is dropped, matching importSearchTermReport\'s own filter', async () => {
    const deps = {
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchSearchTermPerformanceReport: async () => [
        { campaignId: 111, adGroupId: 999, searchTerm: '', keyword: 'k', matchType: 'BROAD', impressions: 1, clicks: 1, cost: 1, purchases1d: 0, sales1d: 0 },
      ],
    };
    const result = await syncSearchTermData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows.length, 0);
  });

  test('passes the requested date range straight through to the report fetcher, unmodified', async () => {
    let capturedStart = null;
    let capturedEnd = null;
    const deps = {
      listSpCampaigns: async () => [],
      listSpAdGroups: async () => [],
      fetchSearchTermPerformanceReport: async (start, end) => {
        capturedStart = start;
        capturedEnd = end;
        return [];
      },
    };
    await syncSearchTermData('2026-08-09', '2026-08-12', deps);
    assert.equal(capturedStart, '2026-08-09');
    assert.equal(capturedEnd, '2026-08-12');
  });
});
