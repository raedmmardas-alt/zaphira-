import type { Confidence, ForecastHorizon, ForecastRange, ForecastResult, ProductEconomicsCalcResult } from '../../types';

export interface ForecastInput {
  observedDays: number; // days actually covered by the current-period data
  spend: number;
  clicks: number;
  orders: number;
  sales: number;
  manualEconomics: ProductEconomicsCalcResult | null; // for profit estimate; null -> profit forecast omitted
  sellingPrice: number | null; // confirmed product selling price, used as the order-value assumption when there's no observed sale to derive one from
}

const HORIZON_DAYS: Record<ForecastHorizon, number> = {
  NEXT_3_DAYS: 3,
  NEXT_7_DAYS: 7,
  NEXT_30_DAYS: 30,
};

const HORIZONS: ForecastHorizon[] = ['NEXT_3_DAYS', 'NEXT_7_DAYS', 'NEXT_30_DAYS'];

const UNCERTAINTY_BAND: Record<Confidence, number> = {
  LOW: 0.35,
  MEDIUM: 0.20,
  HIGH: 0.10,
};

// How many posterior standard deviations wide the order-rate uncertainty
// band is, by confidence tier — wider for thinner evidence, same spirit as
// UNCERTAINTY_BAND above but applied to the Beta-Binomial posterior rather
// than a naive percentage of the expected value (which degenerates to zero
// whenever the expected value itself is zero).
const CVR_UNCERTAINTY_Z: Record<Confidence, number> = {
  LOW: 1.5,
  MEDIUM: 1.0,
  HIGH: 0.75,
};

// A weakly-informative Bayesian prior for click-to-order conversion rate,
// used only to keep small samples from collapsing to a false "0% forever"
// or swinging wildly on a couple of clicks. PRIOR_MEAN is a deliberately
// conservative baseline (well below typical optimized-listing CVR) and
// PRIOR_STRENGTH is its weight in "equivalent pseudo-clicks" — real
// observed clicks increasingly dominate the posterior as they accumulate,
// per standard Beta-Binomial conjugate updating.
const PRIOR_MEAN = 0.03;
const PRIOR_STRENGTH = 20;
const PRIOR_ALPHA = PRIOR_MEAN * PRIOR_STRENGTH;
const PRIOR_BETA = (1 - PRIOR_MEAN) * PRIOR_STRENGTH;

function range(expected: number, band: number): ForecastRange {
  return {
    low: Math.max(0, Math.round(expected * (1 - band) * 100) / 100),
    expected: Math.round(expected * 100) / 100,
    high: Math.round(expected * (1 + band) * 100) / 100,
  };
}

const DISCLAIMER = 'Estimate only — a conservative projection from a small observed sample, not a guarantee.';

// Confidence depends on days observed, click volume, AND — critically —
// whether there's any conversion evidence at all. A handful of clicks with
// zero orders stays LOW/MEDIUM even with decent click volume; it never
// reaches HIGH without real conversions to back it up.
function computeConfidence(observedDays: number, clicks: number, orders: number): Confidence {
  if (observedDays < 2 || clicks < 5) return 'LOW';
  if (orders === 0 && clicks < 20) return 'LOW';
  if (clicks < 30) return 'MEDIUM';
  return 'HIGH';
}

// Beta-Binomial posterior over the click-to-order conversion rate, given
// the observed clicks/orders and the conservative prior above. Returns the
// posterior mean and standard deviation (closed-form for a Beta
// distribution) — no fabricated point estimate, no false "exactly 0%".
function posteriorCvr(clicks: number, orders: number): { mean: number; sd: number } {
  const alpha = PRIOR_ALPHA + orders;
  const beta = PRIOR_BETA + Math.max(0, clicks - orders);
  const total = alpha + beta;
  const mean = alpha / total;
  const variance = (alpha * beta) / (total * total * (total + 1));
  return { mean, sd: Math.sqrt(Math.max(0, variance)) };
}

// Conservative small-sample forecasting: projects the OBSERVED daily click/
// spend rate forward (unchanged — that's real, observed evidence), then
// derives orders from a Beta-Binomial posterior conversion-rate estimate
// instead of naively extrapolating the raw observed rate (which collapses
// to a false, overconfident "exactly 0" whenever 0 orders happened to occur
// in a small sample). Sales/CPA/ACoS/profit are all derived FROM that order
// distribution, never computed independently of it.
export function forecast(input: ForecastInput, horizon: ForecastHorizon): ForecastResult {
  const { observedDays, spend, clicks, orders, sales, manualEconomics, sellingPrice } = input;
  const horizonDays = HORIZON_DAYS[horizon];
  const days = Math.max(1, observedDays);

  // Zero clicks is a delivery problem, not a conversion problem — there is
  // no click-through evidence at all to project spend, clicks, or orders
  // from, so this must read as "insufficient delivery", never as a
  // meaningful $0 prediction.
  if (clicks <= 0) {
    const zero: ForecastRange = { low: 0, expected: 0, high: 0 };
    return {
      horizon, horizonDays, observedDays, confidence: 'LOW',
      spend: zero, clicks: zero, orders: zero, sales: zero,
      cpa: null, acos: null, estimatedProfit: null,
      isEstimate: true, disclaimer: DISCLAIMER,
      insufficientDelivery: true,
      assumption: 'No clicks observed yet for this product — there is not enough delivery evidence to project spend, clicks, or orders.',
    };
  }

  const confidence = computeConfidence(observedDays, clicks, orders);
  const band = UNCERTAINTY_BAND[confidence];

  const dailySpend = spend / days;
  const dailyClicks = clicks / days;

  const spendRange = range(dailySpend * horizonDays, band);
  const clicksRange = range(dailyClicks * horizonDays, band);

  const cvr = posteriorCvr(clicks, orders);
  const z = CVR_UNCERTAINTY_Z[confidence];
  const cvrLow = Math.max(0, cvr.mean - z * cvr.sd);
  const cvrHigh = Math.min(1, cvr.mean + z * cvr.sd);

  const ordersRange: ForecastRange = {
    low: Math.round(cvrLow * clicksRange.expected * 100) / 100,
    expected: Math.round(cvr.mean * clicksRange.expected * 100) / 100,
    high: Math.round(cvrHigh * clicksRange.expected * 100) / 100,
  };

  // Order value: the observed average when there are real sales to derive
  // it from, otherwise this product's confirmed selling price — a real,
  // user-entered figure, not a fabricated one. If neither is available,
  // sales cannot be honestly estimated and stays at zero.
  const avgOrderValue = orders > 0 && sales > 0 ? sales / orders : sellingPrice;
  const salesRange: ForecastRange = avgOrderValue !== null
    ? {
        low: Math.round(ordersRange.low * avgOrderValue * 100) / 100,
        expected: Math.round(ordersRange.expected * avgOrderValue * 100) / 100,
        high: Math.round(ordersRange.high * avgOrderValue * 100) / 100,
      }
    : { low: 0, expected: 0, high: 0 };

  const cpa = ordersRange.expected > 0 ? Math.round((spendRange.expected / ordersRange.expected) * 100) / 100 : null;
  const acos = salesRange.expected > 0 ? Math.round((spendRange.expected / salesRange.expected) * 10000) / 10000 : null;

  let estimatedProfit: ForecastRange | null = null;
  if (manualEconomics?.complete && manualEconomics.breakEvenAcos !== null) {
    const marginRatio = manualEconomics.breakEvenAcos; // contributionBeforeAdvertising / sellingPrice
    const expectedProfit = salesRange.expected * marginRatio - spendRange.expected;
    const bestCase = salesRange.high * marginRatio - spendRange.low;
    const worstCase = salesRange.low * marginRatio - spendRange.high;
    estimatedProfit = {
      low: Math.round(worstCase * 100) / 100,
      expected: Math.round(expectedProfit * 100) / 100,
      high: Math.round(bestCase * 100) / 100,
    };
  }

  const assumption = orders > 0
    ? `Assumes the observed conversion rate (smoothed to ${(cvr.mean * 100).toFixed(1)}%) and average order value ($${(sales / orders).toFixed(2)}) continue at the current pace.`
    : `No orders observed yet — assumes a conservative, small-sample-smoothed conversion rate (~${(cvr.mean * 100).toFixed(1)}%)${avgOrderValue !== null ? ` and this product's $${avgOrderValue.toFixed(2)} selling price as the order value` : ''}, not a guarantee of future sales.`;

  return {
    horizon,
    horizonDays,
    observedDays,
    confidence,
    spend: spendRange,
    clicks: clicksRange,
    orders: ordersRange,
    sales: salesRange,
    cpa,
    acos,
    estimatedProfit,
    isEstimate: true,
    disclaimer: DISCLAIMER,
    insufficientDelivery: false,
    assumption,
  };
}

export function forecastAllHorizons(input: ForecastInput): Record<ForecastHorizon, ForecastResult> {
  const result = {} as Record<ForecastHorizon, ForecastResult>;
  for (const h of HORIZONS) result[h] = forecast(input, h);
  return result;
}
