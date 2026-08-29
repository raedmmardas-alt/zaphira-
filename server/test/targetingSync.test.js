import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { syncTargetingData } from '../src/targetingSync.js';

const CAMPAIGNS = [{ campaignId: 111, name: 'Coconut - Sponsored Products' }];
const AD_GROUPS = [{ adGroupId: 999, campaignId: 111, name: 'Coconut - Broad' }];

describe('syncTargetingData -- merges live keyword/target state with performance data', () => {
  test('normalizes a live keyword target into the exact TargetingRow shape (same field names as the manual CSV importer)', async () => {
    const deps = {
      listSpTargeting: async () => [
        { id: '222', campaignId: '111', adGroupId: '999', targetingText: 'coconut oil organic', matchType: 'EXACT', state: 'ENABLED', bid: 0.85 },
      ],
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchTargetingPerformanceReport: async () => [
        { keywordId: '222', impressions: 400, clicks: 18, cost: 12.4, purchases1d: 2, sales1d: 39.98 },
      ],
    };

    const result = await syncTargetingData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows.length, 1);
    const row = result.rows[0];

    assert.deepEqual(Object.keys(row).sort(), [
      'activityEnd', 'activityStart', 'adGroup', 'bid', 'campaign', 'clicks',
      'impressions', 'matchType', 'orders', 'sales', 'spend', 'status', 'targetingId', 'targetingText',
    ]);
    assert.equal(row.campaign, 'Coconut - Sponsored Products');
    assert.equal(row.adGroup, 'Coconut - Broad');
    assert.equal(row.targetingText, 'coconut oil organic');
    assert.equal(row.matchType, 'EXACT');
    assert.equal(row.targetingId, '222');
    assert.equal(row.bid, 0.85);
    assert.equal(row.status, 'ENABLED');
    assert.equal(row.spend, 12.4);
    assert.equal(row.orders, 2);
    assert.equal(row.sales, 39.98);
    assert.equal(row.activityStart, '2026-08-09');
    assert.equal(row.activityEnd, '2026-08-12');
  });

  test('bid parsing: a flat numeric bid, a nested {bid:{bid}} shape, and a missing bid all resolve correctly', async () => {
    const deps = {
      listSpTargeting: async () => [
        { id: '1', campaignId: '111', adGroupId: '999', targetingText: 'flat bid', matchType: 'BROAD', state: 'ENABLED', bid: 1.5 },
        { id: '2', campaignId: '111', adGroupId: '999', targetingText: 'no bid', matchType: 'BROAD', state: 'ENABLED', bid: undefined },
      ],
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchTargetingPerformanceReport: async () => [],
    };
    const result = await syncTargetingData('2026-08-09', '2026-08-12', deps);
    const flat = result.rows.find((r) => r.targetingText === 'flat bid');
    const missing = result.rows.find((r) => r.targetingText === 'no bid');
    assert.equal(flat.bid, 1.5);
    assert.equal(missing.bid, null); // never fabricated as 0 or omitted silently
  });

  test('a target with historical-looking activity but a live PAUSED status is never reported as ENABLED (status is never inferred from activity)', async () => {
    const deps = {
      listSpTargeting: async () => [
        { id: '5', campaignId: '111', adGroupId: '999', targetingText: 'discontinued keyword', matchType: 'PHRASE', state: 'PAUSED', bid: 0.5 },
      ],
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchTargetingPerformanceReport: async () => [
        { keywordId: '5', impressions: 5000, clicks: 300, cost: 210, purchases1d: 20, sales1d: 480 },
      ],
    };
    const result = await syncTargetingData('2026-08-01', '2026-08-31', deps);
    assert.equal(result.rows[0].status, 'PAUSED');
    assert.equal(result.rows[0].spend, 210); // performance data still comes through correctly
  });

  test('a live keyword with zero performance rows still gets a row, with zeroed metrics and its real live status', async () => {
    const deps = {
      listSpTargeting: async () => [
        { id: '7', campaignId: '111', adGroupId: '999', targetingText: 'new keyword', matchType: 'EXACT', state: 'ENABLED', bid: 0.4 },
      ],
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchTargetingPerformanceReport: async () => [], // no performance row at all
    };
    const result = await syncTargetingData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows[0].status, 'ENABLED');
    assert.equal(result.rows[0].impressions, 0);
    assert.equal(result.rows[0].spend, 0);
    assert.equal(result.rows[0].orders, 0);
    assert.equal(result.rows[0].sales, 0);
  });

  test('a product/category targeting clause (no plain-text keyword) gets a readable targetingText and a distinct matchType', async () => {
    const deps = {
      listSpTargeting: async () => [
        { id: '9', campaignId: '111', adGroupId: '999', targetingText: 'ASIN_SAME_AS=B0EXAMPLE123', matchType: 'TARGETING_EXPRESSION', state: 'ENABLED', bid: 0.6 },
      ],
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchTargetingPerformanceReport: async () => [
        { keywordId: '9', impressions: 100, clicks: 4, cost: 2.1, purchases1d: 0, sales1d: 0 },
      ],
    };
    const result = await syncTargetingData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows[0].matchType, 'TARGETING_EXPRESSION');
    assert.equal(result.rows[0].targetingText, 'ASIN_SAME_AS=B0EXAMPLE123');
    assert.equal(result.rows[0].sales, 0); // zero-sales reported as a real 0, never fabricated
  });

  test('a target whose campaign/ad-group name could not be resolved is dropped, matching importTargetingReport\'s own "never fabricate" filter', async () => {
    const deps = {
      listSpTargeting: async () => [
        { id: '11', campaignId: '999999', adGroupId: '999', targetingText: 'orphaned target', matchType: 'BROAD', state: 'ENABLED', bid: 0.3 },
      ],
      listSpCampaigns: async () => CAMPAIGNS, // does not contain campaignId 999999
      listSpAdGroups: async () => AD_GROUPS,
      fetchTargetingPerformanceReport: async () => [],
    };
    const result = await syncTargetingData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows.length, 0);
  });

  test('a target with blank targeting text is dropped, matching importTargetingReport\'s own filter', async () => {
    const deps = {
      listSpTargeting: async () => [
        { id: '13', campaignId: '111', adGroupId: '999', targetingText: '', matchType: 'BROAD', state: 'ENABLED', bid: 0.3 },
      ],
      listSpCampaigns: async () => CAMPAIGNS,
      listSpAdGroups: async () => AD_GROUPS,
      fetchTargetingPerformanceReport: async () => [],
    };
    const result = await syncTargetingData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows.length, 0);
  });

  test('passes the requested date range straight through to the report fetcher, unmodified', async () => {
    let capturedStart = null;
    let capturedEnd = null;
    const deps = {
      listSpTargeting: async () => [],
      listSpCampaigns: async () => [],
      listSpAdGroups: async () => [],
      fetchTargetingPerformanceReport: async (start, end) => {
        capturedStart = start;
        capturedEnd = end;
        return [];
      },
    };
    await syncTargetingData('2026-08-09', '2026-08-12', deps);
    assert.equal(capturedStart, '2026-08-09');
    assert.equal(capturedEnd, '2026-08-12');
  });
});
