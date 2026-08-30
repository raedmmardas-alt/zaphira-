// Orchestrates a Sponsored Products campaign sync: fetches live campaign
// state (READ-ONLY list) and performance data (READ-ONLY async report) in
// parallel, then merges them into rows shaped exactly like the existing
// Campaign CSV importer's CampaignRow model (src/types/index.ts /
// src/lib/parse/reportImporters.ts importCampaignReport) -- same field
// names, same types. This file introduces no second data model.
//
// Amazon's current live campaign state (ENABLED/PAUSED/ARCHIVED) is always
// authoritative for `status` -- it is never inferred from whether the
// campaign had impressions/clicks in the requested date range. A campaign
// with zero performance rows still gets a row here, with zeroed metrics
// and its real live status.
import { listSpCampaigns } from './amazonCampaigns.js';
import { fetchCampaignPerformanceReport } from './amazonReporting.js';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function syncCampaignData(startDate, endDate, deps = {}) {
  const listFn = deps.listSpCampaigns ?? listSpCampaigns;
  const reportFn = deps.fetchCampaignPerformanceReport ?? fetchCampaignPerformanceReport;

  const [liveCampaigns, performanceRows] = await Promise.all([
    listFn(),
    reportFn(startDate, endDate, deps),
  ]);

  const perfById = new Map();
  for (const r of performanceRows) {
    if (r && r.campaignId !== undefined && r.campaignId !== null) {
      perfById.set(String(r.campaignId), r);
    }
  }

  const rows = liveCampaigns
    .map((c) => {
      const perf = perfById.get(String(c.campaignId)) ?? {};
      return {
        campaign: c.name ?? '',
        campaignId: String(c.campaignId),
        // Amazon's live state -- authoritative, never derived from `perf`.
        status: c.state ?? undefined,
        impressions: toNum(perf.impressions),
        clicks: toNum(perf.clicks),
        spend: toNum(perf.cost),
        orders: toNum(perf.purchases1d),
        sales: toNum(perf.sales1d),
        budget: c.budget && typeof c.budget.budget === 'number' ? c.budget.budget : undefined,
        activityStart: startDate,
        activityEnd: endDate,
      };
    })
    .filter((r) => r.campaign);

  return { rows, campaignCount: liveCampaigns.length, performanceRowCount: performanceRows.length };
}
