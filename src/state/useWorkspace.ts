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
  const apiTargetingSync = useAppStore((s) => s.apiTargetingSync);
  const apiSearchTermSync = useAppStore((s) => s.apiSearchTermSync);
  const apiAdvertisedProductSync = useAppStore((s) => s.apiAdvertisedProductSync);

  return useMemo(() => {
    // Campaign/Targeting/Search Term/Advertised Product Data Source
    // (Phase 2A-2D): defensively defaults to 'MANUAL' for a persisted
    // Settings object saved before these fields existed (real users'
    // existing IndexedDB data) — never throws, never silently switches an
    // existing installation's behavior. When 'API' is selected for a given
    // report type and a sync has actually completed, that type's key is
    // swapped for the API-synced meta/rows -- every other report type
    // (Sellerboard, and whichever others are still on MANUAL) is
    // completely untouched, and the manual reportMeta/reportRows slots
    // themselves are never mutated by this — switching a source back to
    // 'MANUAL' restores it exactly as it was.
    const useApiCampaigns = (settings.campaignDataSource ?? 'MANUAL') === 'API' && apiCampaignSync !== null;
    const useApiTargeting = (settings.targetingDataSource ?? 'MANUAL') === 'API' && apiTargetingSync !== null;
    const useApiSearchTerm = (settings.searchTermDataSource ?? 'MANUAL') === 'API' && apiSearchTermSync !== null;
    const useApiAdvertisedProduct = (settings.advertisedProductDataSource ?? 'MANUAL') === 'API' && apiAdvertisedProductSync !== null;
    const sourcedMeta = {
      ...reportMeta,
      ...(useApiCampaigns ? { campaign: apiCampaignSync!.meta } : {}),
      ...(useApiTargeting ? { targeting: apiTargetingSync!.meta } : {}),
      ...(useApiSearchTerm ? { searchTerm: apiSearchTermSync!.meta } : {}),
      ...(useApiAdvertisedProduct ? { advertisedProduct: apiAdvertisedProductSync!.meta } : {}),
    };
    const sourcedRows = {
      ...reportRows,
      ...(useApiCampaigns ? { campaign: apiCampaignSync!.rows } : {}),
      ...(useApiTargeting ? { targeting: apiTargetingSync!.rows } : {}),
      ...(useApiSearchTerm ? { searchTerm: apiSearchTermSync!.rows } : {}),
      ...(useApiAdvertisedProduct ? { advertisedProduct: apiAdvertisedProductSync!.rows } : {}),
    };

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
  }, [
    reportMeta, reportRows, products, savedAdGroupMappings, settings, accountNetProfitByPeriod, customDateRange,
    apiCampaignSync, apiTargetingSync, apiSearchTermSync, apiAdvertisedProductSync,
  ]);
}
