// Compact account-context strip shown at the top of the main working pages
// (Home, Optimize, Keyword Finder, Upload Data) so the seller always sees
// which marketplace/currency/reporting period their numbers reflect.
//
// Marketplace and Currency both reuse the exact same underlying state the
// app already has (Settings.country/currency via updateSettings — the same
// action DashboardTopBars already calls) rather than a second marketplace
// system. Display Currency is a separate, independent setting
// (Settings.displayCurrency/exchangeRates) that only affects how monetary
// values are FORMATTED — it never changes Settings.currency (the currency
// the underlying report data is actually in) and never feeds into any
// calculation.
import { useState } from 'react';
import { useAppStore } from '../../state/store';
import { useWorkspace } from '../../state/useWorkspace';
import { useDisplayCurrency } from '../../state/useDisplayCurrency';
import { formatPeriodEndDate } from '../../lib/engine/dataFreshness';
import { SUPPORTED_MARKETPLACES, SUPPORTED_DISPLAY_CURRENCIES } from '../../types';

function ExchangeRateControl() {
  const { reportCurrency, displayCurrency, needsRate, rate, setExchangeRate } = useDisplayCurrency();
  const [draft, setDraft] = useState('');

  if (displayCurrency === reportCurrency) return null;

  if (needsRate) {
    return (
      <span className="flex items-center gap-1.5 text-navy-600">
        <span className="text-negative-600">Set exchange rate</span>
        <span className="text-navy-400">1 {reportCurrency} =</span>
        <input
          type="number"
          step="0.0001"
          min="0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="0.00"
          className="w-20 rounded-md border border-border-subtle px-1.5 py-0.5 text-xs"
        />
        <span className="text-navy-400">{displayCurrency}</span>
        <button
          onClick={() => {
            const v = Number(draft);
            if (Number.isFinite(v) && v > 0) { setExchangeRate(displayCurrency, v); setDraft(''); }
          }}
          disabled={!Number.isFinite(Number(draft)) || Number(draft) <= 0}
          className="rounded-md bg-brand-600 px-2 py-0.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save
        </button>
      </span>
    );
  }

  return (
    <span className="text-navy-400" title={`Locally-entered rate, not live. 1 ${reportCurrency} = ${rate} ${displayCurrency}.`}>
      (1 {reportCurrency} = {rate} {displayCurrency})
    </span>
  );
}

export function GlobalContextBar() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const ws = useWorkspace();
  const { displayCurrency } = useDisplayCurrency();

  const periodLabel = ws.currentPeriod
    ? `${formatPeriodEndDate(ws.currentPeriod.start)} – ${formatPeriodEndDate(ws.currentPeriod.end)}`
    : 'Not set yet';

  function onMarketplaceChange(country: string) {
    const marketplace = SUPPORTED_MARKETPLACES.find((m) => m.country === country);
    if (!marketplace) return;
    // Currency (the report currency) always follows the selected
    // marketplace — there is no independent choice for it, since each
    // supported marketplace maps to exactly one report currency.
    updateSettings({ country: marketplace.country, currency: marketplace.currency });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-border-subtle bg-navy-900/[0.02] px-4 py-2 text-xs">
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
      <span className="flex items-center gap-1.5 text-navy-600">
        <span className="font-medium text-navy-400">Display Currency</span>
        <select
          value={displayCurrency}
          onChange={(e) => updateSettings({ displayCurrency: e.target.value })}
          className="rounded-md border border-transparent bg-transparent py-0.5 pl-0.5 pr-1 text-xs font-medium text-navy-800 hover:border-border-subtle focus:border-border-subtle"
        >
          {SUPPORTED_DISPLAY_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </span>
      <ExchangeRateControl />
    </div>
  );
}
