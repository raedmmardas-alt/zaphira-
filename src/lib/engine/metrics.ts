// Shared metric formulas. Centralized so the "zero-sales ACoS" rule (failure
// mode #6) can never be reimplemented inconsistently across screens.

export function computeAcos(spend: number, sales: number): number | null {
  if (!sales || sales <= 0) return null; // never show 0% when there were no ad sales
  return spend / sales;
}

export function computeCtr(clicks: number, impressions: number): number | null {
  if (!impressions || impressions <= 0) return null;
  return clicks / impressions;
}

export function computeCvr(orders: number, clicks: number): number | null {
  if (!clicks || clicks <= 0) return null;
  return orders / clicks;
}

export function computeCpc(spend: number, clicks: number): number | null {
  if (!clicks || clicks <= 0) return null;
  return spend / clicks;
}

// ROAS = Sales / Spend. Unlike ACoS (spend/sales, undefined when sales=0),
// zero sales against real spend is a well-defined, correct ROAS of exactly
// 0 — only an undefined (zero) spend denominator makes ROAS unavailable.
export function computeRoas(sales: number, spend: number): number | null {
  if (!spend || spend <= 0) return null;
  return sales / spend;
}

export function formatMultiplier(v: number | null, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}x`;
}

export function formatPercent(v: number | null, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function formatCurrency(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString();
}
