import type {
  ConversionEvidence, DecisionAction, DecisionActionType, DeliveryStatus, EnrichedCampaign, EnrichedSearchTerm,
  EnrichedTarget, ProductEconomicsCalcResult, RiskBreakdown, Settings, TargetActionType,
} from '../../types';

const MIN_BID = 0.02;
function clampBid(bid: number): number {
  return Math.max(MIN_BID, Math.round(bid * 100) / 100);
}

// How much real conversion evidence exists — purely about sample size and
// orders observed, never an inference about quality. NONE/WEAK must never
// be read as poor performance; they only gate which actions are allowed
// (SCALE / INCREASE_BUDGET require at least MODERATE elsewhere).
function conversionEvidenceFor(clicks: number, orders: number): ConversionEvidence {
  if (orders >= 2) return 'STRONG';
  if (orders === 1) return 'MODERATE';
  if (clicks >= 5) return 'WEAK';
  return 'NONE';
}

// Produces a short, human-readable "next milestone" for early-stage
// (pre-conversion or low-evidence) targets, so the Decision Center has
// something concrete to say before the base engine has enough evidence for
// a firm SCALE/REDUCE/PAUSE call. Every branch here is computed from real,
// already-observed figures (clicks, spend, remaining stop-loss allowance,
// delivery status) — nothing is guessed about future conversion behavior.
function targetCheckpointLabel(params: {
  baseAction: TargetActionType;
  clicks: number;
  orders: number;
  delivery: DeliveryStatus;
  remainingAllowance: number;
  avgCpc: number | null;
}): string {
  const { baseAction, clicks, orders, delivery, remainingAllowance, avgCpc } = params;

  if (baseAction === 'PRODUCT_MAPPING_REQUIRED') return 'MAP PRODUCT TO ENABLE RECOMMENDATIONS';

  // Traffic-status reassurance takes priority — a target with no/low
  // delivery is not a performance failure and must never read as one.
  if (delivery === 'NO_DELIVERY' && (baseAction === 'WAIT' || baseAction === 'WATCH')) {
    return 'NO TRAFFIC — CONSIDER BID INCREASE';
  }
  if (delivery === 'LOW_DELIVERY' && (baseAction === 'WAIT' || baseAction === 'WATCH')) {
    return 'LOW DELIVERY — DO NOT PAUSE';
  }

  if (orders === 0 && remainingAllowance <= 2 && (baseAction === 'WATCH' || baseAction === 'REDUCE_BID')) {
    return `STOP-LOSS APPROACHING — $${remainingAllowance.toFixed(2)} REMAINING`;
  }

  if (baseAction === 'WAIT') {
    const need = Math.max(1, 5 - clicks);
    return `HOLD — COLLECT ${need} MORE CLICK${need === 1 ? '' : 'S'}`;
  }

  if (baseAction === 'WATCH' && orders === 0) {
    // How many more non-converting clicks, at the currently observed CPC,
    // would exhaust the remaining test allowance — a real projection from
    // observed spend, not a guess about whether those clicks will convert.
    const estClicks = avgCpc && avgCpc > 0 ? Math.max(1, Math.round(remainingAllowance / avgCpc)) : null;
    if (estClicks !== null && estClicks <= 5) {
      return `WATCH — REDUCE BID ~10% IF NEXT ${estClicks} CLICK${estClicks === 1 ? '' : 'S'} DO NOT CONVERT`;
    }
    return `WATCH — $${remainingAllowance.toFixed(2)} REMAINING BEFORE REVIEW`;
  }

  if (baseAction === 'WATCH') return 'WATCH — MONITOR FOR MORE CONVERSION DATA';

  if (baseAction === 'REDUCE_BID') {
    return orders === 0 ? 'REDUCE BID — NO CONVERSIONS AT CURRENT SPEND LEVEL' : 'REDUCE BID — ACOS ABOVE TARGET';
  }

  if (baseAction === 'NEGATIVE_PAUSE_CANDIDATE') return `PAUSE CANDIDATE — ${clicks} CLICKS, NO CONVERSIONS`;

  if (baseAction === 'SCALE') return 'SCALE — EVIDENCE SUPPORTS INCREASED INVESTMENT';

  return 'ON TRACK — NO ACTION NEEDED';
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
  manualEconomics: ProductEconomicsCalcResult | null = null,
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
      // Kept distinct from KEEP — this is active monitoring with a next
      // checkpoint, not a "this is fine" signal. See checkpointLabel below.
      action = 'WATCH';
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

  const remainingTestAllowance = Math.max(0, Math.round((risk.maxTestingSpend - target.spend) * 100) / 100);
  const avgCpc = target.clicks > 0 ? target.spend / target.clicks : null;
  const checkpointLabel = targetCheckpointLabel({
    baseAction: base.action, clicks: target.clicks, orders: target.orders, delivery: target.delivery,
    remainingAllowance: remainingTestAllowance, avgCpc,
  });

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
    conversionEvidence: conversionEvidenceFor(target.clicks, target.orders),
    checkpointLabel,
    remainingTestAllowance,
    targetCpa: manualEconomics?.complete ? manualEconomics.maxCpaForTargetProfit : null,
    breakEvenCpa: manualEconomics?.complete ? manualEconomics.breakEvenCpa : null,
    delivery: target.delivery,
  };
}

// Campaign-level equivalent of targetCheckpointLabel — same "real observed
// figures only" rule, just working from the campaign action already decided
// (INCREASE_BUDGET / REDUCE_BUDGET / KEEP / HOLD_COLLECT_DATA) instead of
// the target's TargetActionType.
function campaignCheckpointLabel(params: {
  action: DecisionActionType;
  clicks: number;
  orders: number;
  delivery: DeliveryStatus;
  remainingAllowance: number;
}): string {
  const { action, clicks, orders, delivery, remainingAllowance } = params;

  if (action === 'HOLD_COLLECT_DATA' && delivery === 'NO_DELIVERY') return 'NO TRAFFIC — CONSIDER BID INCREASE';
  if (action === 'HOLD_COLLECT_DATA' && delivery === 'LOW_DELIVERY') return 'LOW DELIVERY — DO NOT PAUSE';

  if (action === 'HOLD_COLLECT_DATA') {
    if (clicks === 0) {
      return 'HOLD — COLLECT MORE TRAFFIC';
    }
    if (orders === 0 && remainingAllowance <= 2) {
      return `STOP-LOSS APPROACHING — $${remainingAllowance.toFixed(2)} REMAINING`;
    }
    return `WATCH — $${remainingAllowance.toFixed(2)} REMAINING BEFORE REVIEW`;
  }

  if (action === 'INCREASE_BUDGET') return 'INCREASE BUDGET — EFFICIENT AND BUDGET-CAPPED';
  if (action === 'REDUCE_BUDGET') return 'REDUCE BUDGET — ABOVE BREAK-EVEN AND BUDGET-CAPPED';

  return 'ON TRACK — NO ACTION NEEDED';
}

// Campaign-level actions are scoped to BUDGET only (INCREASE_BUDGET /
// REDUCE_BUDGET / KEEP / HOLD_COLLECT_DATA) — bid and match-type actions
// belong to individual targets, not the campaign as a whole.
export function deriveCampaignDecisionAction(
  campaign: EnrichedCampaign,
  risk: RiskBreakdown,
  breakEvenAcos: number | null,
  delivery: DeliveryStatus = 'DELIVERING',
  manualEconomics: ProductEconomicsCalcResult | null = null,
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

  const remainingTestAllowance = Math.max(0, Math.round((risk.maxTestingSpend - campaign.spend) * 100) / 100);

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
    conversionEvidence: conversionEvidenceFor(campaign.clicks, campaign.orders),
    checkpointLabel: campaignCheckpointLabel({ action, clicks: campaign.clicks, orders: campaign.orders, delivery, remainingAllowance: remainingTestAllowance }),
    remainingTestAllowance,
    targetCpa: manualEconomics?.complete ? manualEconomics.maxCpaForTargetProfit : null,
    breakEvenCpa: manualEconomics?.complete ? manualEconomics.breakEvenCpa : null,
    delivery,
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
