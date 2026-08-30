// Orchestrates a Sponsored Products TARGETING sync: fetches live keyword +
// product/category targeting state (READ-ONLY list), campaign/ad-group
// names (READ-ONLY list, for display only), and performance data
// (READ-ONLY async report) in parallel, then merges them into rows shaped
// exactly like the existing Targeting CSV importer's TargetingRow model
// (src/types/index.ts / src/lib/parse/reportImporters.ts
// importTargetingReport) -- same field names, same types. This file
// introduces no second data model, and never touches campaignSync.js or
// any of its files.
//
// Amazon's current live state (ENABLED/PAUSED/ARCHIVED) is always
// authoritative for `status` -- it is never inferred from whether the
// keyword/target had impressions/clicks in the requested date range. A
// live keyword/target with zero performance rows still gets a row here,
// with zeroed metrics and its real live status.
import { listSpTargeting, listSpAdGroups } from './amazonTargeting.js';
import { listSpCampaigns } from './amazonCampaigns.js';
import { fetchTargetingPerformanceReport } from './amazonTargetingReporting.js';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function syncTargetingData(startDate, endDate, deps = {}) {
  const listTargetingFn = deps.listSpTargeting ?? listSpTargeting;
  const listCampaignsFn = deps.listSpCampaigns ?? listSpCampaigns;
  const listAdGroupsFn = deps.listSpAdGroups ?? listSpAdGroups;
  const reportFn = deps.fetchTargetingPerformanceReport ?? fetchTargetingPerformanceReport;

  const [liveTargeting, liveCampaigns, liveAdGroups, performanceRows] = await Promise.all([
    listTargetingFn(),
    listCampaignsFn(),
    listAdGroupsFn(),
    reportFn(startDate, endDate, deps),
  ]);

  const campaignNameById = new Map(liveCampaigns.map((c) => [String(c.campaignId), c.name ?? '']));
  const adGroupNameById = new Map(liveAdGroups.map((g) => [String(g.adGroupId), g.name ?? '']));

  const perfById = new Map();
  for (const r of performanceRows) {
    if (r && r.keywordId !== undefined && r.keywordId !== null) {
      perfById.set(String(r.keywordId), r);
    }
  }

  const rows = liveTargeting
    .map((t) => {
      const perf = perfById.get(t.id) ?? {};
      return {
        campaign: (t.campaignId !== undefined ? campaignNameById.get(t.campaignId) : undefined) ?? '',
        adGroup: (t.adGroupId !== undefined ? adGroupNameById.get(t.adGroupId) : undefined) ?? '',
        targetingText: t.targetingText ?? '',
        matchType: t.matchType ?? 'unknown',
        targetingId: t.id,
        bid: typeof t.bid === 'number' ? t.bid : null,
        // Amazon's live state -- authoritative, never derived from `perf`.
        status: t.state,
        impressions: toNum(perf.impressions),
        clicks: toNum(perf.clicks),
        spend: toNum(perf.cost),
        orders: toNum(perf.purchases1d),
        sales: toNum(perf.sales1d),
        activityStart: startDate,
        activityEnd: endDate,
      };
    })
    // Same "never fabricate a blank target" filter as the manual CSV
    // importer's importTargetingReport (rows.filter((r) => r.campaign &&
    // r.targetingText)) -- a target whose campaign/ad-group name couldn't
    // be resolved, or whose text is genuinely blank, is dropped rather
    // than shown with a fabricated label.
    .filter((r) => r.campaign && r.targetingText);

  return { rows, targetingCount: liveTargeting.length, performanceRowCount: performanceRows.length };
}
