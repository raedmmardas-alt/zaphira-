import type { DecisionAction, DecisionActionType, EnrichedCampaign, EnrichedSearchTerm, EnrichedTarget, RiskBreakdown, Settings } from '../../types';

const MIN_BID = 0.02;
function clampBid(bid: number): number {
  return Math.max(MIN_BID, Math.round(bid * 100) / 100);
}

// Layers the expanded, non-technical action vocabulary on top of the
// EXISTING, unmodified target action engine (decideTargetAction). This
// function never recomputes WAIT/WATCH/REDUCE_BID/SCALE/KEEP thresholds
// itself — it only translates that already-decided, already-tested output
// (plus match type and risk) into a richer, more actionable label. This
// keeps every currently-passing test on the base engine untouched.
export function deriveTargetDecisionAction(
  target: EnrichedTarget,
  risk: RiskBreakdown,
  breakEvenAcos: number | null,
  settings: Settings,
): DecisionAction {
  const base = target.action;
  let action: DecisionActionType;
  let recommendedBid: number | null = base.recommendedBid;
  let reason = base.reason;

  switch (base.action) {
    case 'PRODUCT_MAPPING_REQUIRED':
      action = 'HOLD_COLLECT_DATA';
      break;
    case 'WAIT':
      action = 'HOLD_COLLECT_DATA';
      break;
    case 'WATCH':
      action = 'KEEP';
      break;
    case 'KEEP': {
      // A single promising order (not yet the 2+ the base engine requires
      // for SCALE) with real ACoS comfortably under break-even gets a small,
      // conservative bid nudge rather than sitting idle at KEEP.
      if (
        target.orders === 1 &&
        target.acos !== null &&
        breakEvenAcos !== null &&
        target.acos <= breakEvenAcos * 0.7 &&
        target.currentBid !== null
      ) {
        action = 'INCREASE_BID';
        const bump = Math.min(0.03, settings.maxBidIncreasePct / 2);
        recommendedBid = clampBid(target.currentBid * (1 + bump));
        reason = `1 order at ${(target.acos * 100).toFixed(1)}% ACoS is comfortably under this product's break-even (${(breakEvenAcos * 100).toFixed(1)}%) — a small conservative bid increase to gather more evidence, short of a full scale (which needs 2+ orders).`;
      } else {
        action = 'KEEP';
      }
      break;
    }
    case 'REDUCE_BID':
      action = 'REDUCE_BID';
      break;
    case 'NEGATIVE_PAUSE_CANDIDATE':
      // A direct keyword/target with sustained non-converting spend is a
      // pause candidate; the equivalent recommendation for a SEARCH TERM
      // (add it as a negative under its matched target) is produced
      // separately wherever search-term rows are the input, not here.
      action = 'PAUSE';
      recommendedBid = null;
      break;
    case 'SCALE': {
      if (target.matchType.toLowerCase() === 'broad') {
        action = 'TEST_IN_PHRASE';
        reason = `${base.reason} Broad match — graduate to phrase match to tighten targeting while scaling.`;
      } else if (
        target.matchType.toLowerCase() === 'phrase' &&
        breakEvenAcos !== null &&
        target.acos !== null &&
        target.acos <= breakEvenAcos * 0.6
      ) {
        action = 'MOVE_TO_EXACT';
        reason = `${base.reason} ACoS is well under break-even on phrase match — graduate to exact match for maximum control.`;
      } else {
        action = 'SCALE';
      }
      break;
    }
    default:
      action = 'KEEP';
  }

  // Estimated impact: dollars of margin headroom currently being captured
  // (positive, opportunity) for growth actions, or dollars currently
  // exposed (negative, at risk) for risk-reduction actions. Both are
  // conservative estimates derived only from real observed figures — never
  // fabricated from an assumed rate.
  let estimatedImpact = 0;
  if (['SCALE', 'INCREASE_BID', 'TEST_IN_PHRASE', 'MOVE_TO_EXACT'].includes(action)) {
    if (breakEvenAcos !== null && target.acos !== null && target.sales > 0) {
      estimatedImpact = Math.max(0, (breakEvenAcos - target.acos) * target.sales);
    }
  } else if (['REDUCE_BID', 'PAUSE'].includes(action)) {
    estimatedImpact = -(target.spend * (risk.overallScore / 100));
  }

  return {
    scope: 'TARGET',
    key: target.key,
    productId: target.productId,
    productName: target.productName,
    campaign: target.campaign,
    adGroup: target.adGroup,
    targetingText: target.targetingText,
    matchType: target.matchType,
    action,
    currentBid: target.currentBid,
    recommendedBid,
    currentBudget: null,
    recommendedBudget: null,
    reason,
    risk,
    confidence: base.confidence,
    estimatedImpact: Math.round(estimatedImpact * 100) / 100,
    currentPerformance: {
      impressions: target.impressions,
      clicks: target.clicks,
      spend: target.spend,
      orders: target.orders,
      sales: target.sales,
      acos: target.acos,
    },
  };
}

// Campaign-level actions are scoped to BUDGET only (INCREASE_BUDGET /
// REDUCE_BUDGET / KEEP / HOLD_COLLECT_DATA) — bid and match-type actions
// belong to individual targets, not the campaign as a whole.
export function deriveCampaignDecisionAction(
  campaign: EnrichedCampaign,
  risk: RiskBreakdown,
  breakEvenAcos: number | null,
): DecisionAction {
  let action: DecisionActionType;
  let recommendedBudget: number | null = null;
  let reason: string;
  let estimatedImpact = 0;

  const budgetKnown = campaign.budget !== null && campaign.budget > 0;
  const utilization = budgetKnown ? campaign.spend / campaign.budget! : null;
  const nearCap = utilization !== null && utilization >= 0.85;
  const efficient = campaign.acos !== null && breakEvenAcos !== null && campaign.acos <= breakEvenAcos;

  if (!campaign.productId) {
    action = 'HOLD_COLLECT_DATA';
    reason = 'Product mapping required before a budget recommendation can be made.';
  } else if (campaign.spend <= 0) {
    action = 'HOLD_COLLECT_DATA';
    reason = 'No current-period spend recorded yet.';
  } else if (nearCap && efficient) {
    action = 'INCREASE_BUDGET';
    recommendedBudget = Math.round(campaign.budget! * 1.2 * 100) / 100;
    reason = `Spend is using ${(utilization! * 100).toFixed(0)}% of budget at an efficient ACoS (${(campaign.acos! * 100).toFixed(1)}% vs ${(breakEvenAcos! * 100).toFixed(1)}% break-even) — budget is likely capping otherwise-profitable growth.`;
    estimatedImpact = Math.max(0, (breakEvenAcos! - campaign.acos!) * campaign.sales);
  } else if (nearCap && campaign.acos !== null && breakEvenAcos !== null && campaign.acos > breakEvenAcos) {
    action = 'REDUCE_BUDGET';
    recommendedBudget = Math.round(campaign.budget! * 0.85 * 100) / 100;
    reason = `Spend is using ${(utilization! * 100).toFixed(0)}% of budget at an ACoS (${(campaign.acos! * 100).toFixed(1)}%) above break-even (${(breakEvenAcos! * 100).toFixed(1)}%) — reducing budget limits further unprofitable spend while target-level fixes are made.`;
    estimatedImpact = -(campaign.spend * (risk.overallScore / 100));
  } else if (campaign.acos === null) {
    action = 'HOLD_COLLECT_DATA';
    reason = 'Spend recorded but no ad-attributed sales yet — insufficient data, not confirmed poor performance.';
  } else if (efficient) {
    action = 'KEEP';
    reason = `ACoS (${(campaign.acos * 100).toFixed(1)}%) is within break-even (${(breakEvenAcos! * 100).toFixed(1)}%) and budget is not the constraint.`;
  } else {
    action = 'KEEP';
    reason = `ACoS (${(campaign.acos * 100).toFixed(1)}%) is above break-even, but budget is not capping spend — review target-level bids rather than the campaign budget.`;
  }

  return {
    scope: 'CAMPAIGN',
    key: campaign.campaign,
    productId: campaign.productId,
    productName: campaign.productName,
    campaign: campaign.campaign,
    adGroup: null,
    targetingText: null,
    matchType: null,
    action,
    currentBid: null,
    recommendedBid: null,
    currentBudget: campaign.budget,
    recommendedBudget,
    reason,
    risk,
    confidence: campaign.confidence,
    estimatedImpact: Math.round(estimatedImpact * 100) / 100,
    currentPerformance: {
      impressions: campaign.impressions,
      clicks: campaign.clicks,
      spend: campaign.spend,
      orders: campaign.orders,
      sales: campaign.sales,
      acos: campaign.acos,
    },
  };
}

export interface SearchTermNegativeCandidate {
  searchTerm: string;
  matchedTarget: string;
  campaign: string;
  adGroup: string;
  productName: string | null;
  clicks: number;
  spend: number;
  reason: string;
}

// ADD_NEGATIVE candidates. Deliberately restricted to CURRENT-period search
// terms only — historical search-term rows are intelligence only and must
// never drive an active recommendation (failure mode #7/#12).
export function findSearchTermNegativeCandidates(searchTerms: EnrichedSearchTerm[], settings: Settings): SearchTermNegativeCandidate[] {
  return searchTerms
    .filter((st) => st.isCurrentPeriod && st.clicks >= 5 && st.orders === 0 && st.spend > settings.stopLossSpend * 0.5)
    .map((st) => ({
      searchTerm: st.searchTerm,
      matchedTarget: st.targetingText,
      campaign: st.campaign,
      adGroup: st.adGroup,
      productName: st.productName,
      clicks: st.clicks,
      spend: st.spend,
      reason: `${st.clicks} clicks and $${st.spend.toFixed(2)} spend with 0 orders this period — add as a negative under "${st.targetingText}".`,
    }))
    .sort((a, b) => b.spend - a.spend);
}
