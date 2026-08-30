import type { DateRange, EnrichedTarget, ShadowEvaluation, ShadowSnapshot } from '../../types';

function periodsOverlap(a: DateRange, b: DateRange): boolean {
  return !(a.end < b.start || a.start > b.end);
}

// Stable Shadow Mode identity: product/ASIN + campaign + ad group + target +
// match type. Using product/ASIN in addition to campaign/ad-group (rather
// than campaign/ad-group alone) means two products would still be kept
// separate even in the edge case of shared/generic campaign or ad-group
// naming — the same duplicate-keyword-across-products guarantee the rest of
// the app relies on, made explicit for the frozen baseline identity.
export function buildShadowTargetKey(t: {
  productId: string | null;
  asin: string | null;
  campaign: string;
  adGroup: string;
  targetingText: string;
  matchType: string;
}): string {
  return `${t.productId ?? 'UNMAPPED'}|${t.asin ?? ''}|${t.campaign}|${t.adGroup}|${t.targetingText}|${t.matchType}`;
}

// Freezes a single current-period target's before-state into a Shadow Mode
// snapshot row. Every current-period target is eligible — this is NOT
// restricted to targets with an active bid-change recommendation, so the
// full baseline (WAIT/WATCH/KEEP/SCALE/REDUCE_BID/NEGATIVE_PAUSE_CANDIDATE,
// any delivery state, blocked/low-confidence rows) can be captured.
export function buildShadowSnapshotFromTarget(target: EnrichedTarget, savedAt: string, reportPeriod: DateRange | null): ShadowSnapshot {
  return {
    id: crypto.randomUUID(),
    savedAt,
    reportPeriod,
    targetKey: buildShadowTargetKey(target),
    targetingText: target.targetingText,
    matchType: target.matchType,
    productId: target.productId,
    productName: target.productName,
    asin: target.asin,
    campaign: target.campaign,
    adGroup: target.adGroup,
    currentBid: target.currentBid,
    recommendedAction: target.action.action,
    recommendedBid: target.action.recommendedBid,
    risk: target.action.risk,
    confidence: target.action.confidence,
    delivery: target.delivery,
    beforeMetrics: {
      impressions: target.impressions,
      clicks: target.clicks,
      spend: target.spend,
      orders: target.orders,
      sales: target.sales,
      acos: target.acos,
      cvr: target.cvr,
    },
    appliedManually: false,
    appliedAt: null,
    status: 'PENDING',
    statusUpdatedAt: null,
  };
}

export interface ShadowBatchSummary {
  savedAt: string;
  reportPeriod: DateRange | null;
  numTargets: number;
  numApplied: number;
  // Only counts rows that are BOTH applied manually AND resolved into an
  // actual directional bucket (POSITIVE/MIXED/NEGATIVE). Non-applied rows
  // are never counted (failure mode #11) — this is 0 until something is
  // marked APPLIED MANUALLY, by construction.
  numEvaluated: number;
}

export function summarizeShadowBatch(
  savedAt: string,
  reportPeriod: DateRange | null,
  rows: { snapshot: ShadowSnapshot; evaluation: ShadowEvaluation }[],
): ShadowBatchSummary {
  const numApplied = rows.filter((r) => r.snapshot.appliedManually).length;
  const numEvaluated = rows.filter((r) => r.snapshot.appliedManually && ['POSITIVE', 'MIXED', 'NEGATIVE'].includes(r.evaluation.outcome)).length;
  return { savedAt, reportPeriod, numTargets: rows.length, numApplied, numEvaluated };
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

  const afterMetrics = { impressions: after.impressions, clicks: after.clicks, spend: after.spend, orders: after.orders, sales: after.sales, acos: after.acos, cvr: after.cvr };

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
