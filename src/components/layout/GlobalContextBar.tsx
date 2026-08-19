// Compact, read-only account-context strip shown at the top of the main
// working pages (Home, Optimize, Keyword Finder, Upload Data) so the seller
// always sees which marketplace/currency/reporting period their numbers
// reflect. Deliberately read-only and tiny — the editable version of this
// same information (Country/Currency/Date Range selectors) already exists
// as DashboardTopBars on the legacy Dashboard page; this reuses the exact
// same underlying state (Settings.country/currency, Workspace.currentPeriod)
// rather than introducing a second source of truth or any new business
// logic.
import { useAppStore } from '../../state/store';
import { useWorkspace } from '../../state/useWorkspace';
import { formatPeriodEndDate } from '../../lib/engine/dataFreshness';

const COUNTRY_LABELS: Record<string, string> = { US: 'United States' };

export function GlobalContextBar() {
  const settings = useAppStore((s) => s.settings);
  const ws = useWorkspace();

  const marketplaceLabel = COUNTRY_LABELS[settings.country] ?? settings.country;
  const periodLabel = ws.currentPeriod
    ? `${formatPeriodEndDate(ws.currentPeriod.start)} – ${formatPeriodEndDate(ws.currentPeriod.end)}`
    : 'Not set yet';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-border-subtle bg-navy-900/[0.02] px-4 py-2 text-xs">
      <span className="text-navy-600"><span className="font-medium text-navy-400">Marketplace</span> {marketplaceLabel}</span>
      <span className="text-navy-600"><span className="font-medium text-navy-400">Currency</span> {settings.currency}</span>
      <span className="text-navy-600"><span className="font-medium text-navy-400">Reporting Period</span> {periodLabel}</span>
    </div>
  );
}
