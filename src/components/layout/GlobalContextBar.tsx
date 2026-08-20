// Compact account-context strip shown at the top of the main working pages
// (Home, Optimize, Keyword Finder, Upload Data) so the seller always sees
// which store/reporting period/currency their numbers reflect.
//
// Marketplace switches which report data is active via the store's
// setActiveMarketplace action (real per-marketplace data isolation — see
// state/store.ts's ReportSnapshot model), never mixing marketplaces.
// Reporting Period lets the seller switch between every saved period for
// the current marketplace, or apply a custom sub-range (only ever applied
// when the underlying rows genuinely support it — never fabricated).
// Display Currency is a separate, independent setting
// (Settings.displayCurrency/exchangeRates) that only affects how monetary
// values are FORMATTED — it never changes Settings.currency (the currency
// the underlying report data is actually in) and never feeds into any
// calculation.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../state/store';
import { useWorkspace } from '../../state/useWorkspace';
import { useDisplayCurrency } from '../../state/useDisplayCurrency';
import { formatPeriodEndDate } from '../../lib/engine/dataFreshness';
import { assessCustomRangeSupport } from '../../lib/aggregate/customRangeFilter';
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

function ReportingPeriodControl() {
  const settings = useAppStore((s) => s.settings);
  const reportRows = useAppStore((s) => s.reportRows);
  const reportSnapshots = useAppStore((s) => s.reportSnapshots);
  const customDateRange = useAppStore((s) => s.customDateRange);
  const setActivePeriod = useAppStore((s) => s.setActivePeriod);
  const setCustomDateRange = useAppStore((s) => s.setCustomDateRange);
  const ws = useWorkspace();

  const [open, setOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const savedPeriods = reportSnapshots
    .filter((s) => s.marketplace === settings.country && s.period !== null)
    .sort((a, b) => b.period!.start.localeCompare(a.period!.start));

  const periodLabel = customDateRange
    ? `${formatPeriodEndDate(customDateRange.start)} – ${formatPeriodEndDate(customDateRange.end)} (custom)`
    : ws.currentPeriod
      ? `${formatPeriodEndDate(ws.currentPeriod.start)} – ${formatPeriodEndDate(ws.currentPeriod.end)}`
      : 'Not set yet';

  function selectSaved(id: string) {
    setActivePeriod(id);
    setOpen(false);
    setCustomizing(false);
  }

  function applyCustomRange() {
    if (!from || !to || from > to) return;
    const range = { start: from, end: to };
    const assessment = assessCustomRangeSupport(reportRows, range);
    if (!assessment.supported) {
      setCustomError(assessment.reason);
      return;
    }
    setCustomDateRange(range);
    setCustomError(null);
    setOpen(false);
    setCustomizing(false);
  }

  return (
    <span className="relative flex items-center gap-1.5 text-navy-600">
      <span className="font-medium text-navy-400">Reporting Period</span>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md px-1.5 py-0.5 text-xs font-medium text-navy-800 hover:bg-navy-900/5"
      >
        {periodLabel} ▾
      </button>
      {customDateRange && (
        <button
          onClick={() => setCustomDateRange(null)}
          title="Clear custom range, return to the full saved period"
          className="text-navy-400 hover:text-negative-600"
        >
          ✕
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-72 rounded-lg border border-border-subtle bg-surface p-2 text-left shadow-lg">
          {savedPeriods.length === 0 && (
            <p className="px-2 py-1 text-xs text-navy-400">No saved reporting periods yet for this marketplace.</p>
          )}
          {savedPeriods.map((s) => (
            <button
              key={s.id}
              onClick={() => selectSaved(s.id)}
              className={`block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-navy-900/5 ${!customDateRange && ws.currentPeriod?.start === s.period!.start && ws.currentPeriod.end === s.period!.end ? 'font-semibold text-brand-700' : 'text-navy-700'}`}
            >
              {formatPeriodEndDate(s.period!.start)} – {formatPeriodEndDate(s.period!.end)}
            </button>
          ))}
          <div className="mt-1 border-t border-border-subtle pt-1">
            {!customizing ? (
              <button onClick={() => setCustomizing(true)} className="block w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-brand-700 hover:bg-navy-900/5">
                Custom Range…
              </button>
            ) : (
              <div className="space-y-1.5 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-md border border-border-subtle px-1.5 py-1 text-xs" />
                  <span className="text-navy-400">to</span>
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-md border border-border-subtle px-1.5 py-1 text-xs" />
                </div>
                {customError && <p className="text-[11px] text-negative-600">{customError}</p>}
                <div className="flex items-center gap-2">
                  <button onClick={applyCustomRange} disabled={!from || !to || from > to} className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">Apply</button>
                  <button onClick={() => { setCustomizing(false); setCustomError(null); }} className="text-xs text-navy-500 hover:underline">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

export function GlobalContextBar() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setActiveMarketplace = useAppStore((s) => s.setActiveMarketplace);
  const reportMeta = useAppStore((s) => s.reportMeta);
  const { displayCurrency } = useDisplayCurrency();

  const activeMarketplace = SUPPORTED_MARKETPLACES.find((m) => m.country === settings.country) ?? SUPPORTED_MARKETPLACES[0];
  const hasNoData = Object.keys(reportMeta).length === 0;

  return (
    <div className="mb-4 rounded-lg border border-border-subtle bg-navy-900/[0.02] px-4 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="flex items-center gap-1.5 text-navy-600">
          <span className="font-medium text-navy-400">Marketplace</span>
          <select
            value={settings.country}
            onChange={(e) => setActiveMarketplace(e.target.value)}
            className="rounded-md border border-transparent bg-transparent py-0.5 pl-0.5 pr-1 text-xs font-medium text-navy-800 hover:border-border-subtle focus:border-border-subtle"
          >
            {SUPPORTED_MARKETPLACES.map((m) => (
              <option key={m.country} value={m.country}>{m.label}</option>
            ))}
          </select>
        </span>
        <span className="text-navy-600"><span className="font-medium text-navy-400">Currency</span> {settings.currency}</span>
        <ReportingPeriodControl />
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
      {hasNoData && (
        <p className="mt-1.5 text-xs text-negative-600">
          No {activeMarketplace.shortLabel} data uploaded. <Link to="/upload-data" className="font-medium underline hover:text-negative-700">Upload Data →</Link>
        </p>
      )}
    </div>
  );
}
