// Compact account-context strip shown at the top of the main working pages
// (Home, Optimize, Keyword Finder, Upload Data) so the seller always sees
// which marketplace/currency/reporting period their numbers reflect. The
// Marketplace dropdown and Currency/Reporting Period readouts all reuse the
// exact same underlying state the app already has (Settings.country/
// currency via updateSettings, Workspace.currentPeriod) — the same action
// the legacy Dashboard's DashboardTopBars selectors already call — rather
// than introducing a second marketplace system or any new business logic.
// Only the marketplaces in SUPPORTED_MARKETPLACES are ever offered.
import { useAppStore } from '../../state/store';
import { useWorkspace } from '../../state/useWorkspace';
import { formatPeriodEndDate } from '../../lib/engine/dataFreshness';
import { SUPPORTED_MARKETPLACES } from '../../types';

export function GlobalContextBar() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const ws = useWorkspace();

  const periodLabel = ws.currentPeriod
    ? `${formatPeriodEndDate(ws.currentPeriod.start)} – ${formatPeriodEndDate(ws.currentPeriod.end)}`
    : 'Not set yet';

  function onMarketplaceChange(country: string) {
    const marketplace = SUPPORTED_MARKETPLACES.find((m) => m.country === country);
    if (!marketplace) return;
    // Currency always follows the selected marketplace — there is no
    // independent currency choice to preserve, since each supported
    // marketplace maps to exactly one currency.
    updateSettings({ country: marketplace.country, currency: marketplace.currency });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-border-subtle bg-navy-900/[0.02] px-4 py-2 text-xs">
      <span className="flex items-center gap-1.5 text-navy-600">
        <span className="font-medium text-navy-400">Marketplace</span>
        <select
          value={settings.country}
          onChange={(e) => onMarketplaceChange(e.target.value)}
          className="rounded-md border border-transparent bg-transparent py-0.5 pl-0.5 pr-1 text-xs font-medium text-navy-800 hover:border-border-subtle focus:border-border-subtle"
        >
          {SUPPORTED_MARKETPLACES.map((m) => (
            <option key={m.country} value={m.country}>{m.label}</option>
          ))}
        </select>
      </span>
      <span className="text-navy-600"><span className="font-medium text-navy-400">Currency</span> {settings.currency}</span>
      <span className="text-navy-600"><span className="font-medium text-navy-400">Reporting Period</span> {periodLabel}</span>
    </div>
  );
}
