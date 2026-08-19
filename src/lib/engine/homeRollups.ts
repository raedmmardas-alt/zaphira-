// Home-page presentation rollups. These functions do NOT compute any new
// PPC/economics figures — they only read and summarize values already
// produced by the existing, unmodified engines (deriveTargetDecisionAction,
// deriveCampaignDecisionAction, rankNextDollarCandidates,
// deriveDashboardReconciliationStatus). Kept separate from those engines so
// it's obvious at a glance that nothing here is a new recommendation rule.
import type { BadgeTone } from '../../components/ui/Badge';
import type { DecisionAction, ProductStrategyResult } from '../../types';
import type { NextDollarResult } from './nextDollar';
import type { DashboardReconciliationStatus } from '../aggregate/reconciliation';
import { SIMPLE_ACTION_LABEL } from './simplifiedAction';

export type OverallStatus = 'GOOD' | 'WATCH' | 'ACTION_NEEDED';

// Rolls up the single reconciliation status plus the already-ranked
// action list (both computed elsewhere) into one headline status. A genuine
// data mismatch always wins (it means the numbers on screen can't be
// trusted yet); otherwise it's driven purely by the highest risk
// classification / action type already assigned to a real (non-zero
// activity) target or campaign.
export function deriveOverallStatus(reconciliationStatus: DashboardReconciliationStatus, rankedActions: DecisionAction[]): OverallStatus {
  if (reconciliationStatus === 'DATA_MISMATCH_REVIEW_REQUIRED') return 'ACTION_NEEDED';

  if (rankedActions.some((a) => a.risk.classification === 'HIGH' || a.risk.classification === 'CRITICAL')) return 'ACTION_NEEDED';

  if (rankedActions.some((a) => {
    const simple = SIMPLE_ACTION_LABEL[a.action];
    return a.risk.classification === 'MODERATE' || simple === 'REDUCE' || simple === 'PAUSE';
  })) return 'WATCH';

  return 'GOOD';
}

export interface BudgetGuidance {
  recommendation: 'Increase' | 'Hold' | 'Reduce';
  today: number;
  current: number;
  reason: string;
}

// Rolls the per-campaign INCREASE_BUDGET / REDUCE_BUDGET decisions (each
// already computed, dollar-for-dollar, by deriveCampaignDecisionAction) up
// into one account-level daily-budget suggestion. "Today" is simply
// current + the sum of those already-computed per-campaign deltas — a
// rollup/sum of existing figures, never a new formula. Reduce signals take
// priority over increase signals when both exist, as the more conservative
// read. Falls back to the exact insufficient-evidence wording the product
// spec requires when there's no current-period campaign spend at all yet.
export function deriveBudgetGuidance(campaignDecisions: DecisionAction[], nextDollar: NextDollarResult, currentDailyBudget: number): BudgetGuidance {
  const campaignScoped = campaignDecisions.filter((c) => c.scope === 'CAMPAIGN');
  const reduces = campaignScoped.filter((c) => c.action === 'REDUCE_BUDGET' && c.recommendedBudget !== null && c.currentBudget !== null);
  const increases = campaignScoped.filter((c) => c.action === 'INCREASE_BUDGET' && c.recommendedBudget !== null && c.currentBudget !== null);

  if (reduces.length > 0) {
    const totalCut = reduces.reduce((sum, c) => sum + (c.currentBudget! - c.recommendedBudget!), 0);
    return {
      recommendation: 'Reduce',
      today: Math.max(0, Math.round((currentDailyBudget - totalCut) * 100) / 100),
      current: currentDailyBudget,
      reason: reduces[0].reason,
    };
  }

  if (increases.length > 0) {
    const totalAdd = increases.reduce((sum, c) => sum + (c.recommendedBudget! - c.currentBudget!), 0);
    return {
      recommendation: 'Increase',
      today: Math.round((currentDailyBudget + totalAdd) * 100) / 100,
      current: currentDailyBudget,
      reason: increases[0].reason,
    };
  }

  const hasSpendEvidence = campaignScoped.some((c) => c.currentPerformance.spend > 0);
  if (!hasSpendEvidence) {
    return { recommendation: 'Hold', today: currentDailyBudget, current: currentDailyBudget, reason: 'Hold current budget — more conversion data needed.' };
  }

  return {
    recommendation: 'Hold',
    today: currentDailyBudget,
    current: currentDailyBudget,
    reason: nextDollar.hold && nextDollar.holdReason
      ? nextDollar.holdReason
      : 'No campaign currently shows a strong signal to change the daily budget — current level looks appropriately sized.',
  };
}

export type ProductOverviewStatus = 'Winning' | 'Testing' | 'Watch' | 'Needs Attention' | 'Not Enough Data';

// Maps the existing, unmodified classifyProductStrategy() output onto the
// seller-facing status vocabulary. "Testing" vs "Not Enough Data" is the
// only distinction added here, and it's read straight off already-available
// current-period spend — INSUFFICIENT_DATA with real spend means evidence is
// actively being collected; INSUFFICIENT_DATA with none means there's
// nothing running yet.
export function deriveProductOverviewStatus(strategy: ProductStrategyResult['strategy'] | undefined, currentPeriodSpend: number): ProductOverviewStatus {
  switch (strategy) {
    case 'GROW_CAREFULLY': return 'Winning';
    case 'MONITOR': return 'Watch';
    case 'FIX_ECONOMICS': return 'Needs Attention';
    case 'REDUCE_WASTE': return 'Needs Attention';
    default: return currentPeriodSpend > 0 ? 'Testing' : 'Not Enough Data';
  }
}

export function productOverviewStatusTone(status: ProductOverviewStatus): BadgeTone {
  switch (status) {
    case 'Winning': return 'positive';
    case 'Testing': return 'brand';
    case 'Watch': return 'watch';
    case 'Needs Attention': return 'negative';
    case 'Not Enough Data': return 'wait';
    default: return 'neutral';
  }
}

export function overallStatusLabel(status: OverallStatus): string {
  switch (status) {
    case 'GOOD': return 'GOOD';
    case 'WATCH': return 'WATCH';
    case 'ACTION_NEEDED': return 'ACTION NEEDED';
    default: return status;
  }
}

export function overallStatusTone(status: OverallStatus): BadgeTone {
  switch (status) {
    case 'GOOD': return 'positive';
    case 'WATCH': return 'watch';
    case 'ACTION_NEEDED': return 'negative';
    default: return 'neutral';
  }
}
