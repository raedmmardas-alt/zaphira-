import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { syncCampaignData } from '../src/campaignSync.js';

describe('syncCampaignData -- merges live campaign state with performance data', () => {
  test('live campaign state is authoritative for status, never inferred from performance rows', async () => {
    const deps = {
      listSpCampaigns: async () => [
        { campaignId: 111, name: 'Coconut - Sponsored Products', state: 'ENABLED', budget: { budget: 20 } },
        { campaignId: 222, name: 'Vanilla - Sponsored Products', state: 'PAUSED', budget: { budget: 15 } },
      ],
      fetchCampaignPerformanceReport: async () => [
        { campaignId: 111, impressions: 500, clicks: 20, cost: 16.48, purchases1d: 0, sales1d: 0 },
        // Note: campaign 222 (PAUSED) has NO performance row at all -- its
        // live PAUSED status must still come through, not be silently
        // dropped or reinterpreted from the absence of activity.
      ],
    };

    const result = await syncCampaignData('2026-08-09', '2026-08-12', deps);

    assert.equal(result.rows.length, 2);
    const coconut = result.rows.find((r) => r.campaignId === '111');
    const vanilla = result.rows.find((r) => r.campaignId === '222');

    assert.equal(coconut.status, 'ENABLED');
    assert.equal(coconut.spend, 16.48);
    assert.equal(coconut.impressions, 500);

    assert.equal(vanilla.status, 'PAUSED'); // live status present even with zero activity
    assert.equal(vanilla.impressions, 0);
    assert.equal(vanilla.clicks, 0);
    assert.equal(vanilla.spend, 0);
    assert.equal(vanilla.orders, 0);
    assert.equal(vanilla.sales, 0);
  });

  test('a campaign with historical-looking activity but a live PAUSED/ARCHIVED status is never reported as ENABLED', async () => {
    // This is the exact scenario the spec calls out: "Do not infer current
    // status from historical impressions/clicks." A campaign that spent
    // money and got clicks in the requested window, but has since been
    // paused/archived, must report its REAL current state.
    const deps = {
      listSpCampaigns: async () => [{ campaignId: 333, name: 'Rose - Sponsored Products', state: 'ARCHIVED', budget: {} }],
      fetchCampaignPerformanceReport: async () => [
        { campaignId: 333, impressions: 10000, clicks: 400, cost: 250, purchases1d: 12, sales1d: 480 },
      ],
    };

    const result = await syncCampaignData('2026-08-01', '2026-08-31', deps);
    assert.equal(result.rows[0].status, 'ARCHIVED');
    assert.equal(result.rows[0].spend, 250); // performance data still comes through correctly
  });

  test('normalizes into the exact CampaignRow shape (same field names as the manual CSV importer)', async () => {
    const deps = {
      listSpCampaigns: async () => [{ campaignId: 444, name: 'Mango - Sponsored Products', state: 'ENABLED', budget: { budget: 10 } }],
      fetchCampaignPerformanceReport: async () => [
        { campaignId: 444, impressions: 100, clicks: 5, cost: 3.21, purchases1d: 1, sales1d: 19.99 },
      ],
    };

    const result = await syncCampaignData('2026-08-09', '2026-08-12', deps);
    const row = result.rows[0];

    // Exactly the CampaignRow field set: campaign, campaignId, status,
    // impressions, clicks, spend, orders, sales, budget, activityStart,
    // activityEnd -- no extra/renamed fields, no second data model.
    assert.deepEqual(Object.keys(row).sort(), [
      'activityEnd', 'activityStart', 'budget', 'campaign', 'campaignId',
      'clicks', 'impressions', 'orders', 'sales', 'spend', 'status',
    ]);
    assert.equal(row.campaign, 'Mango - Sponsored Products');
    assert.equal(row.orders, 1);
    assert.equal(row.sales, 19.99);
    assert.equal(row.budget, 10);
    assert.equal(row.activityStart, '2026-08-09');
    assert.equal(row.activityEnd, '2026-08-12');
  });

  test('zero-sales campaigns report a real 0, never a fabricated non-zero value', async () => {
    const deps = {
      listSpCampaigns: async () => [{ campaignId: 555, name: 'Test Campaign', state: 'ENABLED', budget: {} }],
      fetchCampaignPerformanceReport: async () => [
        { campaignId: 555, impressions: 50, clicks: 2, cost: 1.5, purchases1d: 0, sales1d: 0 },
      ],
    };
    const result = await syncCampaignData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows[0].orders, 0);
    assert.equal(result.rows[0].sales, 0);
  });

  test('campaigns with no name are dropped, matching importCampaignReport\'s own "never fabricate a row" filter', async () => {
    const deps = {
      listSpCampaigns: async () => [{ campaignId: 666, name: '', state: 'ENABLED', budget: {} }],
      fetchCampaignPerformanceReport: async () => [],
    };
    const result = await syncCampaignData('2026-08-09', '2026-08-12', deps);
    assert.equal(result.rows.length, 0);
  });

  test('passes the requested date range straight through to the report fetcher, unmodified', async () => {
    let capturedStart = null;
    let capturedEnd = null;
    const deps = {
      listSpCampaigns: async () => [],
      fetchCampaignPerformanceReport: async (start, end) => {
        capturedStart = start;
        capturedEnd = end;
        return [];
      },
    };
    await syncCampaignData('2026-08-09', '2026-08-12', deps);
    assert.equal(capturedStart, '2026-08-09');
    assert.equal(capturedEnd, '2026-08-12');
  });
});
