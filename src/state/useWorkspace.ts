import { useMemo } from 'react';
import { useAppStore } from './store';
import { buildWorkspace } from './deriveWorkspace';
import { filterReportRowsToRange, buildCustomRangeReportMeta } from '../lib/aggregate/customRangeFilter';

export function useWorkspace() {
  const reportMeta = useAppStore((s) => s.reportMeta);
  const reportRows = useAppStore((s) => s.reportRows);
  const products = useAppStore((s) => s.products);
  const savedAdGroupMappings = useAppStore((s) => s.savedAdGroupMappings);
  const settings = useAppStore((s) => s.settings);
  const accountNetProfitByPeriod = useAppStore((s) => s.accountNetProfitByPeriod);
  const customDateRange = useAppStore((s) => s.customDateRange);
  const apiCampaignSync = useAppStore((s) => s.apiCampaignSync);

  return useMemo(() => {
    // Campaign Data Source (Phase 2A): defensively defaults to 'MANUAL' for
    // a persisted Settings object saved before this field existed (real
    // users' existing IndexedDB data) — never throws, never silently
    // switches an existing installation's behavior. When 'API' is selected
    // and a sync has actually completed, the campaign key is swapped for
    // the API-synced meta/rows -- every other report type (Targeting,
    // Search Term, Advertised Product, Sellerboard) is completely
    // untouched, and the manual reportMeta.campaign/reportRows.campaign
    // slot itself is never mutated by this — switching the source back to
    // 'MANUAL' restores it exactly as it was.
    const useApiCampaigns = (settings.campaignDataSource ?? 'MANUAL') === 'API' && apiCampaignSync !== null;
    const sourcedMeta = useApiCampaigns ? { ...reportMeta, campaign: apiCampaignSync!.meta } : reportMeta;
    const sourcedRows = useApiCampaigns ? { ...reportRows, campaign: apiCampaignSync!.rows } : reportRows;

    // A custom range is only ever set once assessCustomRangeSupport (see
    // the Reporting Period picker in GlobalContextBar) has already
    // confirmed every loaded report type's rows can be safely attributed
    // to it — so this never needs to re-check; it just narrows the row
    // arrays and overrides the period-driving types' requestedPeriod
    // before calling the SAME, unmodified buildWorkspace every other view
    // already uses. Reconciliation, KPIs, targets, campaigns, and search
    // terms all naturally scope to the custom range as a result, using
    // 100% existing formulas against a smaller dataset — buildWorkspace
    // itself is never touched.
    const effectiveMeta = customDateRange ? buildCustomRangeReportMeta(sourcedMeta, customDateRange) : sourcedMeta;
    const effectiveRows = customDateRange ? filterReportRowsToRange(sourcedRows, customDateRange) : sourcedRows;
    return buildWorkspace(effectiveMeta, effectiveRows, products, savedAdGroupMappings, settings, accountNetProfitByPeriod);
  }, [reportMeta, reportRows, products, savedAdGroupMappings, settings, accountNetProfitByPeriod, customDateRange, apiCampaignSync]);
}
