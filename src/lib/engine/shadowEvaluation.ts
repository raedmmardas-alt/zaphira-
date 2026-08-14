import type { DateRange, EnrichedTarget, ShadowEvaluation, ShadowSnapshot } from '../../types';

function periodsOverlap(a: DateRange, b: DateRange): boolean {
  return !(a.end < b.start || a.start > b.end);
}

// Compares a Shadow Mode snapshot against current-period data. Only
// APPLIED-MANUALLY snapshots may ever be evaluated for directional outcome —
// non-applied snapshots are observational-only and must never count as
// positive/negative/mixed (failure mode #11).
export function evaluateShadowSnapshot(
  snapshot: ShadowSnapshot,
  currentTargetsByKey: Map<string, EnrichedTarget>,
  currentPeriod: DateRange | null,
): ShadowEvaluation {
  if (!snapshot.appliedManually) {
    return { snapshotId: snapshot.id, outcome: 'INSUFFICIENT_DATA', afterMetrics: null, notes: 'Not applied manually — observational only, excluded from directional accuracy.' };
  }

  if (!currentPeriod || !snapshot.reportPeriod) {
    return { snapshotId: snapshot.id, outcome: 'NON_COMPARABLE_PERIOD', afterMetrics: null, notes: 'Current period is not established — cannot compare.' };
  }

  if (periodsOverlap(currentPeriod, snapshot.reportPeriod)) {
    return { snapshotId: snapshot.id, outcome: 'NON_COMPARABLE_PERIOD', afterMetrics: null, notes: 'Current data overlaps the snapshot period — needs a genuinely later report to compare.' };
  }

  if (currentPeriod.start <= snapshot.reportPeriod.end) {
    return { snapshotId: snapshot.id, outcome: 'NON_COMPARABLE_PERIOD', afterMetrics: null, notes: 'Current data is not later than the snapshot period.' };
  }

  const after = currentTargetsByKey.get(snapshot.targetKey);
  if (!after) {
    return { snapshotId: snapshot.id, outcome: 'INSUFFICIENT_DATA', afterMetrics: null, notes: 'Target no longer appears in current-period data.' };
  }

  const afterMetrics = { impressions: after.impressions, clicks: after.clicks, spend: after.spend, orders: after.orders, sales: after.sales, acos: after.acos };

  const before = snapshot.beforeMetrics;
  if (before.clicks < 5 && afterMetrics.clicks < 5) {
    return { snapshotId: snapshot.id, outcome: 'INSUFFICIENT_DATA', afterMetrics, notes: 'Too little click volume before and after to draw a conclusion.' };
  }

  const acosImproved = before.acos !== null && afterMetrics.acos !== null ? afterMetrics.acos < before.acos : null;
  const ordersImproved = afterMetrics.orders >= before.orders;
  const spendControlled = afterMetrics.spend <= before.spend * 1.25;

  let outcome: ShadowEvaluation['outcome'];
  let notes: string;

  if (acosImproved === null) {
    if (before.orders === 0 && afterMetrics.orders === 0) {
      outcome = 'INSUFFICIENT_DATA';
      notes = 'No ad sales before or after — cannot compute directional ACoS change.';
    } else {
      outcome = ordersImproved ? 'POSITIVE' : 'MIXED';
      notes = 'ACoS could not be compared directly; judged on order trend.';
    }
  } else if (acosImproved && ordersImproved) {
    outcome = 'POSITIVE';
    notes = `ACoS improved (${(before.acos! * 100).toFixed(1)}% → ${(afterMetrics.acos! * 100).toFixed(1)}%) and orders held or grew.`;
  } else if (!acosImproved && !ordersImproved && !spendControlled) {
    outcome = 'NEGATIVE';
    notes = `ACoS worsened (${(before.acos! * 100).toFixed(1)}% → ${(afterMetrics.acos! * 100).toFixed(1)}%) with orders down and spend up.`;
  } else {
    outcome = 'MIXED';
    notes = 'Some metrics improved and some did not — no clean directional read.';
  }

  return { snapshotId: snapshot.id, outcome, afterMetrics, notes: `${notes} Observational validation only — not proof of causal lift.` };
}
