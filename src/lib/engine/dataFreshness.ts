// V1 data-freshness guardrail. Freshness is always calculated from the
// CONFIRMED REPORTING PERIOD END DATE (ws.currentPeriod.end) — never from
// when a file happened to be uploaded. A report uploaded today whose
// reporting period ends several days ago is still that many days stale;
// the upload timestamp plays no part in this calculation.
//
// Reuses the existing daysBetween()/today() date helpers from
// lib/parse/dateUtils.ts (the same ones the period-alignment engine already
// uses) rather than introducing new date-diff logic. today() reads the
// browser's current LOCAL date (getFullYear/getMonth/getDate), matching
// "use the application's current local date."
import type { ISODate } from '../../types';
import { daysBetween, today } from '../parse/dateUtils';
import type { BadgeTone } from '../../components/ui/Badge';

export type FreshnessStatus = 'FRESH' | 'UPDATE_RECOMMENDED' | 'STALE';

export interface DataFreshness {
  status: FreshnessStatus;
  daysOld: number;
  periodEnd: ISODate;
}

export function classifyFreshnessDays(daysOld: number): FreshnessStatus {
  if (daysOld <= 1) return 'FRESH';
  if (daysOld <= 3) return 'UPDATE_RECOMMENDED';
  return 'STALE';
}

// currentDate defaults to the real current local date; tests pass an
// explicit date so the classification stays deterministic.
export function computeDataFreshness(periodEnd: ISODate, currentDate: ISODate = today()): DataFreshness {
  // A period end in the future (e.g. a manually-confirmed range that hasn't
  // fully elapsed yet) is never "negative days old" — floor at 0 (FRESH)
  // rather than producing a nonsensical negative age.
  const daysOld = Math.max(0, daysBetween(periodEnd, currentDate));
  return { status: classifyFreshnessDays(daysOld), daysOld, periodEnd };
}

export const FRESHNESS_STATUS_LABEL: Record<FreshnessStatus, string> = {
  FRESH: 'Fresh',
  UPDATE_RECOMMENDED: 'Update recommended',
  STALE: 'Stale data — upload new reports before making PPC changes',
};

export function freshnessStatusTone(status: FreshnessStatus): BadgeTone {
  switch (status) {
    case 'FRESH': return 'positive';
    case 'UPDATE_RECOMMENDED': return 'watch';
    case 'STALE': return 'negative';
    default: return 'neutral';
  }
}

// Matches the short "Aug 17" style already used on Upload Data, so the same
// period end date reads identically everywhere it's shown.
export function formatPeriodEndDate(iso: ISODate): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
