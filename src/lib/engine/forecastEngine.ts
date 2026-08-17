import type { ForecastHorizon, ForecastRange, ForecastResult, ProductEconomicsCalcResult } from '../../types';

export interface ForecastInput {
  observedDays: number; // days actually covered by the current-period data
  spend: number;
  clicks: number;
  orders: number;
  sales: number;
  manualEconomics: ProductEconomicsCalcResult | null; // for profit estimate; null -> profit forecast omitted
}

const HORIZON_DAYS: Record<ForecastHorizon, number> = {
  NEXT_3_DAYS: 3,
  NEXT_7_DAYS: 7,
  NEXT_30_DAYS: 30,
};

const HORIZONS: ForecastHorizon[] = ['NEXT_3_DAYS', 'NEXT_7_DAYS', 'NEXT_30_DAYS'];

const UNCERTAINTY_BAND: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = {
  LOW: 0.35,
  MEDIUM: 0.20,
  HIGH: 0.10,
};

function range(expected: number, band: number): ForecastRange {
  return {
    low: Math.max(0, Math.round(expected * (1 - band) * 100) / 100),
    expected: Math.round(expected * 100) / 100,
    high: Math.round(expected * (1 + band) * 100) / 100,
  };
}

const DISCLAIMER = 'Estimate only — a conservative projection from a small observed sample, not a guarantee.';

// Conservative small-sample forecasting: projects the OBSERVED daily rate
// forward, widens the range when the sample is thin, and never invents a
// non-zero order/sales forecast when zero were actually observed. This is
// deliberately not naive extrapolation of noisy short-window rates into
// large confident numbers.
export function forecast(input: ForecastInput, horizon: ForecastHorizon): ForecastResult {
  const { observedDays, spend, clicks, orders, sales, manualEconomics } = input;
  const horizonDays = HORIZON_DAYS[horizon];
  const days = Math.max(1, observedDays);

  const confidence: ForecastResult['confidence'] = observedDays < 2 || clicks < 5 ? 'LOW' : clicks < 30 ? 'MEDIUM' : 'HIGH';
  const band = UNCERTAINTY_BAND[confidence];

  const dailySpend = spend / days;
  const dailyClicks = clicks / days;

  const spendRange = range(dailySpend * horizonDays, band);
  const clicksRange = range(dailyClicks * horizonDays, band);

  // Zero observed orders/sales forecasts to zero — never fabricated from
  // click volume alone. A non-zero observed rate is projected forward with
  // the same conservative band.
  let ordersRange: ForecastRange;
  let salesRange: ForecastRange;
  if (orders <= 0) {
    ordersRange = { low: 0, expected: 0, high: 0 };
    salesRange = { low: 0, expected: 0, high: 0 };
  } else {
    const dailyOrders = orders / days;
    const dailySales = sales / days;
    ordersRange = range(dailyOrders * horizonDays, band);
    salesRange = range(dailySales * horizonDays, band);
  }

  const cpa = ordersRange.expected > 0 ? spendRange.expected / ordersRange.expected : null;
  const acos = salesRange.expected > 0 ? spendRange.expected / salesRange.expected : null;

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
  };
}

export function forecastAllHorizons(input: ForecastInput): Record<ForecastHorizon, ForecastResult> {
  const result = {} as Record<ForecastHorizon, ForecastResult>;
  for (const h of HORIZONS) result[h] = forecast(input, h);
  return result;
}
