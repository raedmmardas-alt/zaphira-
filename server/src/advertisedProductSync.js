// Orchestrates a Sponsored Products ADVERTISED PRODUCT sync: fetches
// performance data (READ-ONLY async report) plus campaign/ad-group names
// (READ-ONLY list, reusing the same functions already validated for
// campaign/targeting sync), then normalizes into rows shaped exactly like
// the existing Advertised Product CSV importer's AdvertisedProductRow
// model (src/types/index.ts / src/lib/parse/reportImporters.ts
// importAdvertisedProductReport) -- same field names, same types. This
// file introduces no second data model, and never touches campaignSync.js,
// targetingSync.js, searchTermSync.js, or any of their files. Feeding
// this into the SAME AdvertisedProductRow model means it strengthens
// product mapping (src/lib/aggregate/mapping.ts's
// buildAdvertisedProductIndex) exactly as the manual report already does
// -- no separate mapping logic.
import { listSpCampaigns } from './amazonCampaigns.js';
import { listSpAdGroups } from './amazonTargeting.js';
import { fetchAdvertisedProductPerformanceReport } from './amazonAdvertisedProductReporting.js';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function syncAdvertisedProductData(startDate, endDate, deps = {}) {
  const listCampaignsFn = deps.listSpCampaigns ?? listSpCampaigns;
  const listAdGroupsFn = deps.listSpAdGroups ?? listSpAdGroups;
  const reportFn = deps.fetchAdvertisedProductPerformanceReport ?? fetchAdvertisedProductPerformanceReport;

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
      asin: r.advertisedAsin ?? '',
      sku: r.advertisedSku ?? undefined,
      impressions: toNum(r.impressions),
      clicks: toNum(r.clicks),
      spend: toNum(r.cost),
      orders: toNum(r.purchases1d),
      sales: toNum(r.sales1d),
      activityStart: startDate,
      activityEnd: endDate,
    }))
    // Same "never fabricate a blank row" filter as the manual CSV
    // importer's importAdvertisedProductReport (rows.filter((r) =>
    // r.campaign && r.asin)).
    .filter((r) => r.campaign && r.asin);

  return { rows, performanceRowCount: performanceRows.length };
}
