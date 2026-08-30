import { useAppStore } from './store';
import { convertFromReportCurrency, formatInCurrency } from '../lib/engine/currency';

// Presentation-only display-currency conversion for monetary values.
// Defensive against a persisted Settings object saved before displayCurrency/
// exchangeRates existed (real users' existing IndexedDB data) — falls back
// to "no conversion" rather than throwing, without touching store.ts's
// hydrate/persistence behavior at all.
export function useDisplayCurrency() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const reportCurrency = settings.currency ?? 'USD';
  const displayCurrency = settings.displayCurrency ?? reportCurrency;
  const rates = settings.exchangeRates ?? {};
  const needsRate = displayCurrency !== reportCurrency && rates[displayCurrency] === undefined;
  const rate = rates[displayCurrency] ?? null;

  // Formats an amount already denominated in the report currency
  // (Settings.currency) as the seller's chosen display currency. Never
  // converts anything that isn't a monetary amount, and never fabricates a
  // number when the rate is missing — returns "—" in that case, same as
  // every other "can't calculate this yet" state in the app.
  function formatAmount(amount: number | null, digits = 2): string {
    if (amount === null || !Number.isFinite(amount)) return '—';
    if (displayCurrency === reportCurrency) return formatInCurrency(amount, reportCurrency, digits);
    const converted = convertFromReportCurrency(amount, reportCurrency, displayCurrency, rates);
    if (converted === null) return '—';
    return formatInCurrency(converted, displayCurrency, digits);
  }

  function setExchangeRate(currency: string, unitsPerUsd: number) {
    updateSettings({ exchangeRates: { ...rates, [currency]: unitsPerUsd } });
  }

  return { reportCurrency, displayCurrency, needsRate, rate, formatAmount, setExchangeRate };
}
