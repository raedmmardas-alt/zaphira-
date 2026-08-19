// Display-currency conversion — a PRESENTATION LAYER ONLY. Nothing here
// ever touches stored Amazon/Sellerboard values, PPC calculations, ACoS,
// ROAS, CTR, CVR, or any recommendation/economics logic — those all
// continue to run entirely in the report's original currency
// (Settings.currency). This module only converts an already-computed
// monetary number into a different currency for display, and only when a
// real, locally-entered exchange rate exists — it never fabricates a rate.
import { BASE_REPORT_CURRENCY } from '../../types';

export type ExchangeRates = Record<string, number>;

// Returns how many units of `displayCurrency` equal 1 unit of
// `reportCurrency`, or null if that conversion isn't known. V1 only ever
// has USD as a report currency (single marketplace), and every locally
// entered rate is expressed relative to USD — so a report currency other
// than USD has no known conversion path and intentionally returns null
// rather than guessing a cross rate.
export function getExchangeRate(displayCurrency: string, reportCurrency: string, rates: ExchangeRates): number | null {
  if (displayCurrency === reportCurrency) return 1;
  if (reportCurrency !== BASE_REPORT_CURRENCY) return null;
  const rate = rates[displayCurrency];
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
}

// Converts an amount that is already denominated in `reportCurrency` into
// `displayCurrency`. Returns null (never a fabricated number) when no rate
// is available yet — callers must show an explicit "set exchange rate"
// state in that case, never a silently-wrong value.
export function convertFromReportCurrency(
  amount: number,
  reportCurrency: string,
  displayCurrency: string,
  rates: ExchangeRates,
): number | null {
  const rate = getExchangeRate(displayCurrency, reportCurrency, rates);
  if (rate === null) return null;
  return amount * rate;
}

// Formats an amount that is already in `currency`'s own units (i.e. after
// any conversion has already happened, or when no conversion is needed).
// Uses Intl's currency formatter so each supported currency gets its own
// correct symbol/placement without a hand-maintained symbol table.
export function formatInCurrency(amount: number | null, currency: string, digits = 2): string {
  if (amount === null || !Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    // Unknown/unsupported ISO code — fall back rather than throw.
    const sign = amount < 0 ? '-' : '';
    return `${sign}${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
  }
}
