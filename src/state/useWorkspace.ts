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

  return useMemo(() => {
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
    const effectiveMeta = customDateRange ? buildCustomRangeReportMeta(reportMeta, customDateRange) : reportMeta;
    const effectiveRows = customDateRange ? filterReportRowsToRange(reportRows, customDateRange) : reportRows;
    return buildWorkspace(effectiveMeta, effectiveRows, products, savedAdGroupMappings, settings, accountNetProfitByPeriod);
  }, [reportMeta, reportRows, products, savedAdGroupMappings, settings, accountNetProfitByPeriod, customDateRange]);
}
