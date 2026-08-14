import type { ReactNode } from 'react';

export type BadgeTone = 'positive' | 'negative' | 'watch' | 'wait' | 'neutral' | 'brand';

const TONE_CLASSES: Record<BadgeTone, string> = {
  positive: 'bg-positive-50 text-positive-600 border-positive-600/20',
  negative: 'bg-negative-50 text-negative-600 border-negative-600/20',
  watch: 'bg-watch-50 text-watch-600 border-watch-600/20',
  wait: 'bg-wait-50 text-wait-600 border-wait-600/20',
  neutral: 'bg-navy-900/5 text-navy-700 border-navy-900/10',
  brand: 'bg-brand-600/10 text-brand-700 border-brand-600/20',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

export function riskTone(risk: string): BadgeTone {
  switch (risk) {
    case 'LOW': return 'positive';
    case 'MEDIUM': return 'watch';
    case 'HIGH': return 'negative';
    case 'BLOCKED': return 'neutral';
    default: return 'neutral';
  }
}

export function confidenceTone(confidence: string): BadgeTone {
  switch (confidence) {
    case 'HIGH': return 'positive';
    case 'MEDIUM': return 'watch';
    case 'LOW': return 'wait';
    default: return 'neutral';
  }
}

export function deliveryTone(delivery: string): BadgeTone {
  switch (delivery) {
    case 'HIGH_DELIVERY': return 'positive';
    case 'DELIVERING': return 'brand';
    case 'LOW_DELIVERY': return 'watch';
    case 'NO_DELIVERY': return 'wait';
    default: return 'neutral';
  }
}

export function actionTone(action: string): BadgeTone {
  switch (action) {
    case 'SCALE': return 'positive';
    case 'KEEP': return 'brand';
    case 'WATCH': return 'watch';
    case 'WAIT': return 'wait';
    case 'REDUCE_BID': return 'negative';
    case 'NEGATIVE_PAUSE_CANDIDATE': return 'negative';
    case 'PRODUCT_MAPPING_REQUIRED': return 'neutral';
    default: return 'neutral';
  }
}
