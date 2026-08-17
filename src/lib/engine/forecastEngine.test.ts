import { describe, it, expect } from 'vitest';
import { forecast, forecastAllHorizons } from './forecastEngine';
import type { ForecastInput } from './forecastEngine';
import type { ProductEconomicsCalcResult } from '../../types';

function baseInput(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return { observedDays: 4, spend: 20, clicks: 40, orders: 4, sales: 120, manualEconomics: null, ...overrides };
}

const completeEconomics: ProductEconomicsCalcResult = {
  productId: 'rose', complete: true, missingFields: [], contributionBeforeAdvertising: 10, breakEvenCpa: 10,
  breakEvenAcos: 0.5, maxCpaForTargetProfit: null, targetAcos: null,
};

describe('forecast', () => {
  it('projects the observed daily rate forward for the requested horizon', () => {
    const r = forecast(baseInput(), 'NEXT_7_DAYS');
    // dailySpend = 20/4 = 5/day -> 7 days = 35
    expect(r.spend.expected).toBeCloseTo(35);
    // dailyClicks = 10/day -> 70
    expect(r.clicks.expected).toBeCloseTo(70);
    expect(r.horizonDays).toBe(7);
  });

  it('never fabricates a non-zero order/sales forecast when zero orders were observed', () => {
    const r = forecast(baseInput({ orders: 0, sales: 0, clicks: 200 }), 'NEXT_30_DAYS');
    expect(r.orders).toEqual({ low: 0, expected: 0, high: 0 });
    expect(r.sales).toEqual({ low: 0, expected: 0, high: 0 });
    expect(r.cpa).toBeNull();
    expect(r.acos).toBeNull();
  });

  it('marks confidence LOW for a thin sample (few clicks or few observed days)', () => {
    expect(forecast(baseInput({ clicks: 2, observedDays: 4 }), 'NEXT_7_DAYS').confidence).toBe('LOW');
    expect(forecast(baseInput({ clicks: 40, observedDays: 1 }), 'NEXT_7_DAYS').confidence).toBe('LOW');
  });

  it('marks confidence HIGH only with a large observed sample and enough days', () => {
    const r = forecast(baseInput({ clicks: 200, observedDays: 10 }), 'NEXT_7_DAYS');
    expect(r.confidence).toBe('HIGH');
  });

  it('widens the range (low/high spread) for lower-confidence forecasts', () => {
    const low = forecast(baseInput({ clicks: 2, observedDays: 2 }), 'NEXT_7_DAYS');
    const high = forecast(baseInput({ clicks: 200, observedDays: 10 }), 'NEXT_7_DAYS');
    const lowSpread = low.spend.high - low.spend.low;
    const highSpread = high.spend.high - high.spend.low;
    expect(lowSpread).toBeGreaterThan(highSpread);
  });

  it('never shows a negative low bound (clicks/spend/orders/sales cannot go below zero)', () => {
    const r = forecast(baseInput({ clicks: 1, spend: 0.5, orders: 0, sales: 0, observedDays: 1 }), 'NEXT_3_DAYS');
    expect(r.spend.low).toBeGreaterThanOrEqual(0);
    expect(r.clicks.low).toBeGreaterThanOrEqual(0);
  });

  it('omits the profit estimate entirely when product economics are incomplete', () => {
    const r = forecast(baseInput({ manualEconomics: null }), 'NEXT_7_DAYS');
    expect(r.estimatedProfit).toBeNull();
  });

  it('computes a profit estimate range from complete manual economics', () => {
    const r = forecast(baseInput({ manualEconomics: completeEconomics }), 'NEXT_7_DAYS');
    expect(r.estimatedProfit).not.toBeNull();
    // expected profit = sales.expected * 0.5 - spend.expected
    expect(r.estimatedProfit!.expected).toBeCloseTo(r.sales.expected * 0.5 - r.spend.expected, 1);
  });

  it('always labels itself as an estimate with a disclaimer, never a guarantee', () => {
    const r = forecast(baseInput(), 'NEXT_3_DAYS');
    expect(r.isEstimate).toBe(true);
    expect(r.disclaimer.toLowerCase()).toContain('estimate');
  });

  it('forecastAllHorizons returns all three horizons', () => {
    const all = forecastAllHorizons(baseInput());
    expect(Object.keys(all).sort()).toEqual(['NEXT_30_DAYS', 'NEXT_3_DAYS', 'NEXT_7_DAYS'].sort());
    expect(all.NEXT_3_DAYS.horizonDays).toBe(3);
    expect(all.NEXT_30_DAYS.horizonDays).toBe(30);
  });
});
