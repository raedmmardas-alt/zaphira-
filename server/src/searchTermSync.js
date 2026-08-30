// Orchestrates a Sponsored Products SEARCH TERM sync: fetches performance
// data (READ-ONLY async report) plus campaign/ad-group names (READ-ONLY
// list, for display only, reusing the same functions already validated
// for campaign/targeting sync), then normalizes into rows shaped exactly
// like the existing Search Term CSV importer's SearchTermRow model
// (src/types/index.ts / src/lib/parse/reportImporters.ts
// importSearchTermReport) -- same field names, same types. This file
// introduces no second data model, and never touches campaignSync.js,
// targetingSync.js, or any of their files.
//
// Search terms are period-performance data ONLY -- Amazon exposes no
// "live status" for a customer search query (there is no companion list
// endpoint, unlike campaigns/targeting), so this never invents a current/
// live status for a search term row; it is purely what Amazon reported
// for the requested date range. Existing classification/historical-
// intelligence logic downstream (src/lib/engine/searchTerms.ts) is
// completely unmodified -- it just receives SearchTermRow[] as before.
import { listSpCampaigns } from './amazonCampaigns.js';
import { listSpAdGroups } from './amazonTargeting.js';
import { fetchSearchTermPerformanceReport } from './amazonSearchTermReporting.js';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function syncSearchTermData(startDate, endDate, deps = {}) {
  const listCampaignsFn = deps.listSpCampaigns ?? listSpCampaigns;
  const listAdGroupsFn = deps.listSpAdGroups ?? listSpAdGroups;
  const reportFn = deps.fetchSearchTermPerformanceReport ?? fetchSearchTermPerformanceReport;

  const [liveCampaigns, liveAdGroups, performanceRows] = await Promise.all([
    listCampaignsFn(),
    listAdGroupsFn(),
    reportFn(startDate, endDate, deps),
  ]);

  const campaignNameById = new Map(liveCampaigns.map((c) => [String(c.campaignId), c.name ?? '']));
  const adGroupNameById = new Map(liveAdGroups.map((g) => [String(g.adGroupId), g.name ?? '']));

  const rows = performanceRows
    .map((r) => ({
      campaign: (r.campaignId !== undefined && r.campaignId !== null ? campaignNameById.get(String(r.campaignId)) : undefined) ?? '',
      adGroup: (r.adGroupId !== undefined && r.adGroupId !== null ? adGroupNameById.get(String(r.adGroupId)) : undefined) ?? '',
      searchTerm: r.searchTerm ?? '',
      targetingText: r.keyword ?? '',
      matchType: r.matchType ?? 'unknown',
      impressions: toNum(r.impressions),
      clicks: toNum(r.clicks),
      spend: toNum(r.cost),
      orders: toNum(r.purchases1d),
      sales: toNum(r.sales1d),
      activityStart: startDate,
      activityEnd: endDate,
    }))
    // Same "never fabricate a blank row" filter as the manual CSV
    // importer's importSearchTermReport (rows.filter((r) => r.campaign &&
    // r.searchTerm)).
    .filter((r) => r.campaign && r.searchTerm);

  return { rows, performanceRowCount: performanceRows.length };
}
