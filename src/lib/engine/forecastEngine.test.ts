import { describe, it, expect } from 'vitest';
import { forecast, forecastAllHorizons } from './forecastEngine';
import type { ForecastInput } from './forecastEngine';
import type { ProductEconomicsCalcResult } from '../../types';

function baseInput(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return { observedDays: 4, spend: 20, clicks: 40, orders: 4, sales: 120, manualEconomics: null, sellingPrice: 19.99, ...overrides };
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

  it('never claims zero orders proves a 0% future conversion rate — a small-sample zero-order forecast is low but non-zero, not flat zero', () => {
    const r = forecast(baseInput({ orders: 0, sales: 0, clicks: 200 }), 'NEXT_30_DAYS');
    expect(r.orders.expected).toBeGreaterThan(0);
    expect(r.orders.high).toBeGreaterThan(r.orders.expected);
    expect(r.orders.low).toBeGreaterThanOrEqual(0);
    // Sales/CPA/ACoS must be DERIVED from that same order distribution.
    expect(r.sales.expected).toBeGreaterThan(0);
    expect(r.cpa).not.toBeNull();
    expect(r.acos).not.toBeNull();
  });

  it('still keeps the smoothed conversion-rate estimate conservative — not close to the naive 0% or a fabricated high rate', () => {
    const r = forecast(baseInput({ orders: 0, sales: 0, clicks: 200 }), 'NEXT_30_DAYS');
    const impliedCvr = r.orders.expected / r.clicks.expected;
    expect(impliedCvr).toBeGreaterThan(0);
    expect(impliedCvr).toBeLessThan(0.02); // well under a 2% CVR — conservative, not optimistic
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

  describe('insufficient delivery (zero clicks)', () => {
    it('flags insufficientDelivery instead of pretending a $0 forecast is meaningful, for a product with real impressions but zero clicks', () => {
      const r = forecast(baseInput({ clicks: 0, orders: 0, sales: 0, spend: 0 }), 'NEXT_30_DAYS');
      expect(r.insufficientDelivery).toBe(true);
      expect(r.spend).toEqual({ low: 0, expected: 0, high: 0 });
      expect(r.orders).toEqual({ low: 0, expected: 0, high: 0 });
      expect(r.confidence).toBe('LOW');
      expect(r.assumption.toLowerCase()).toContain('no clicks');
    });

    it('does not flag insufficientDelivery once there is at least one real click', () => {
      const r = forecast(baseInput({ clicks: 1, orders: 0, sales: 0 }), 'NEXT_30_DAYS');
      expect(r.insufficientDelivery).toBe(false);
    });
  });

  describe('confidence incorporates conversion evidence, not just click volume', () => {
    it('keeps confidence LOW/MEDIUM (never HIGH) for a moderate click sample with zero orders — 8 clicks, 0 orders should not read as strongly confident', () => {
      const r = forecast(baseInput({ clicks: 8, orders: 0, sales: 0, observedDays: 4 }), 'NEXT_30_DAYS');
      expect(r.confidence).not.toBe('HIGH');
    });

    it('reaches HIGH confidence only with a large click sample AND real conversions', () => {
      const r = forecast(baseInput({ clicks: 200, orders: 20, sales: 600, observedDays: 10 }), 'NEXT_7_DAYS');
      expect(r.confidence).toBe('HIGH');
    });
  });

  describe('assumption line', () => {
    it('always includes a short assumption line explaining the forecast basis', () => {
      const withOrders = forecast(baseInput({ orders: 4, sales: 120 }), 'NEXT_7_DAYS');
      expect(withOrders.assumption.length).toBeGreaterThan(0);
      const zeroOrders = forecast(baseInput({ orders: 0, sales: 0 }), 'NEXT_7_DAYS');
      expect(zeroOrders.assumption.length).toBeGreaterThan(0);
      expect(zeroOrders.assumption.toLowerCase()).toContain('no orders observed');
    });

    it('names the confirmed selling price as the order-value assumption when there are no real sales to derive one from', () => {
      const r = forecast(baseInput({ orders: 0, sales: 0, sellingPrice: 19.99 }), 'NEXT_7_DAYS');
      expect(r.assumption).toContain('19.99');
    });
  });

  describe('real-data validation scenario (Coconut: 8 clicks, 0 orders, 4 observed days)', () => {
    const coconut = () => forecast({ observedDays: 4, spend: 4.5, clicks: 8, orders: 0, sales: 0, manualEconomics: completeEconomics, sellingPrice: 19.99 }, 'NEXT_30_DAYS');

    it('produces a low-but-non-zero order range, never the old flat 0-0 with a wide click range', () => {
      const r = coconut();
      expect(r.clicks.expected).toBeCloseTo(60, 0); // 8 clicks / 4 days * 30
      expect(r.orders.expected).toBeGreaterThan(0);
      expect(r.orders.high).toBeGreaterThan(r.orders.expected);
    });

    it('does not receive HIGH confidence from only 8 clicks and 0 orders', () => {
      expect(coconut().confidence).not.toBe('HIGH');
    });

    it('derives a defined CPA and ACoS from the resulting order distribution', () => {
      const r = coconut();
      expect(r.cpa).not.toBeNull();
      expect(r.acos).not.toBeNull();
    });
  });
});
