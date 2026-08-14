import type { EnrichedTarget, ProductEconomics } from '../../types';

export interface NextDollarCandidate {
  target: EnrichedTarget;
  score: number;
  recommendedIncrementalBudget: number;
  reason: string;
  evidence: string[];
  expectedRisk: EnrichedTarget['action']['risk'];
}

export interface NextDollarResult {
  hold: boolean;
  holdReason: string | null;
  candidates: NextDollarCandidate[]; // ranked, best first
}

const CONFIDENCE_WEIGHT: Record<string, number> = { HIGH: 1, MEDIUM: 0.55, LOW: 0.15 };
const RISK_PENALTY: Record<string, number> = { LOW: 0, MEDIUM: 0.3, HIGH: 0.7, BLOCKED: 1 };

// Ranks candidates for incremental PPC investment. Only SCALE-eligible,
// low/medium-risk, mapped targets with confirmed profitable economics are
// considered — this deliberately does NOT rank by raw sales volume.
export function rankNextDollarCandidates(
  targets: EnrichedTarget[],
  economicsById: Record<string, ProductEconomics>,
  maxDailyPpcBudget: number,
): NextDollarResult {
  const eligible = targets.filter((t) => t.action.action === 'SCALE' && t.isCurrentPeriod && t.productId);

  if (eligible.length === 0) {
    return {
      hold: true,
      holdReason: 'No current-period target currently meets the evidence bar for incremental investment (2+ purchases, ACoS at or below this product\'s break-even, confirmed economics). Holding the next $10 is the conservative choice.',
      candidates: [],
    };
  }

  const scored: NextDollarCandidate[] = eligible.map((t) => {
    const econ = t.productId ? economicsById[t.productId] : null;
    const breakEven = econ?.breakEvenAcos ?? null;
    const headroom = breakEven !== null && t.acos !== null ? Math.max(0, (breakEven - t.acos) / breakEven) : 0;
    const confidenceWeight = CONFIDENCE_WEIGHT[t.action.confidence] ?? 0;
    const riskPenalty = RISK_PENALTY[t.action.risk] ?? 1;
    const evidenceStrength = Math.min(1, t.orders / 10);
    const spendRoom = Math.max(0, 1 - t.spend / Math.max(1, maxDailyPpcBudget));

    const score = headroom * 0.4 + confidenceWeight * 0.25 + evidenceStrength * 0.2 + spendRoom * 0.1 - riskPenalty * 0.25;

    const recommendedIncrementalBudget = Math.min(10, Math.max(1, Math.round(maxDailyPpcBudget * 0.1 * (1 + headroom))));

    const evidence = [
      `${t.orders} order(s) at ${t.acos !== null ? (t.acos * 100).toFixed(1) + '% ACoS' : 'unknown ACoS'}`,
      breakEven !== null ? `Break-even ACoS: ${(breakEven * 100).toFixed(1)}%` : 'No break-even data',
      `Confidence: ${t.action.confidence}, Risk: ${t.action.risk}`,
      `Delivery: ${t.delivery}`,
    ];

    return {
      target: t,
      score,
      recommendedIncrementalBudget,
      reason: `${t.productName ?? 'Unmapped product'} — "${t.targetingText}" (${t.matchType}) shows profitable, evidenced conversion headroom below break-even.`,
      evidence,
      expectedRisk: t.action.risk,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const positiveScored = scored.filter((c) => c.score > 0);
  if (positiveScored.length === 0) {
    return {
      hold: true,
      holdReason: 'Scale-eligible targets exist but none score positively once risk and evidence are weighed — holding the next $10 is the conservative choice.',
      candidates: scored,
    };
  }

  return { hold: false, holdReason: null, candidates: positiveScored };
}
