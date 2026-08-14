import type { DeliveryStatus, DeliveryThresholds } from '../../types';

// Delivery is purely about traffic volume, never profitability. A keyword can
// be HIGH_DELIVERY and still be a poor converter — that's a separate signal
// handled by the target action engine.
export function classifyDelivery(impressions: number, clicks: number, thresholds: DeliveryThresholds): DeliveryStatus {
  if (impressions <= 0) return 'NO_DELIVERY';
  if (impressions <= thresholds.lowDeliveryMaxImpressions && clicks === 0) return 'LOW_DELIVERY';
  if (impressions >= thresholds.highDeliveryMinImpressions || clicks >= thresholds.highDeliveryMinClicks) return 'HIGH_DELIVERY';
  return 'DELIVERING';
}

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  NO_DELIVERY: 'No Delivery',
  LOW_DELIVERY: 'Low Delivery',
  DELIVERING: 'Delivering',
  HIGH_DELIVERY: 'High Delivery',
};
