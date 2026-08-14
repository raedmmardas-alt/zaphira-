import { useMemo } from 'react';
import { useAppStore } from './store';
import { buildWorkspace } from './deriveWorkspace';

export function useWorkspace() {
  const reportMeta = useAppStore((s) => s.reportMeta);
  const reportRows = useAppStore((s) => s.reportRows);
  const products = useAppStore((s) => s.products);
  const savedAdGroupMappings = useAppStore((s) => s.savedAdGroupMappings);
  const settings = useAppStore((s) => s.settings);
  const accountNetProfitByPeriod = useAppStore((s) => s.accountNetProfitByPeriod);

  return useMemo(
    () => buildWorkspace(reportMeta, reportRows, products, savedAdGroupMappings, settings, accountNetProfitByPeriod),
    [reportMeta, reportRows, products, savedAdGroupMappings, settings, accountNetProfitByPeriod],
  );
}
