import { describe, it, expect } from 'vitest';
import { classifyDelivery } from './delivery';
import { DEFAULT_SETTINGS } from '../../types';

const thresholds = DEFAULT_SETTINGS.deliveryThresholds; // low<=10 impr & 0 clicks, high>=300 impr or >=15 clicks

describe('classifyDelivery', () => {
  it('classifies zero impressions as NO_DELIVERY', () => {
    expect(classifyDelivery(0, 0, thresholds)).toBe('NO_DELIVERY');
  });

  it('classifies 1-10 impressions with zero clicks as LOW_DELIVERY', () => {
    expect(classifyDelivery(5, 0, thresholds)).toBe('LOW_DELIVERY');
    expect(classifyDelivery(10, 0, thresholds)).toBe('LOW_DELIVERY');
  });

  it('does not classify as LOW_DELIVERY once there is a click, even under the impression cap', () => {
    expect(classifyDelivery(8, 1, thresholds)).toBe('DELIVERING');
  });

  it('classifies high-volume traffic as HIGH_DELIVERY', () => {
    expect(classifyDelivery(500, 5, thresholds)).toBe('HIGH_DELIVERY');
    expect(classifyDelivery(50, 20, thresholds)).toBe('HIGH_DELIVERY');
  });

  it('classifies moderate traffic below the high-delivery bar as DELIVERING', () => {
    expect(classifyDelivery(100, 5, thresholds)).toBe('DELIVERING');
  });

  it('respects configurable thresholds', () => {
    const custom = { lowDeliveryMaxImpressions: 20, highDeliveryMinImpressions: 50, highDeliveryMinClicks: 5 };
    expect(classifyDelivery(15, 0, custom)).toBe('LOW_DELIVERY');
    expect(classifyDelivery(60, 0, custom)).toBe('HIGH_DELIVERY');
  });
});
