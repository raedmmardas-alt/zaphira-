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
    // No confirmed economics to drive the two-CPA ladder below — fall back
    // to the generic stop-loss allowance so there's still something
    // concrete to say, without fabricating a product-specific figure.
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

// The zero-order, evidence-sufficient (clicks >= 5) decision ladder, driven
// by the product's own two CPA thresholds instead of the base engine's
// generic dollar bands ($8/$15/$20), which don't know this product's real
// economics. Only applies when BOTH CPA figures are confirmed and sane
// (targetCpa < breakEvenCpa, both positive) — otherwise the caller falls
// back to the generic, economics-agnostic checkpoint above.
//
//   Max CPA Target (targetCpa)   — soft review threshold, preserves target profit.
//   Break-even CPA (breakEvenCpa) — hard economic stop-loss threshold.
//
// "Approaching" a threshold is spend reaching 80% of it — close enough to
// warrant a heads-up before the threshold is actually crossed.
const APPROACH_RATIO = 0.8;

function zeroOrderEconomicsLadder(params: {
  spend: number;
  targetCpa: number;
  breakEvenCpa: number;
}): { action: DecisionActionType; checkpointLabel: string; reason: string } {
  const { spend, targetCpa, breakEvenCpa } = params;

  if (spend >= breakEvenCpa) {
    return {
      action: 'PAUSE',
      checkpointLabel: 'BREAK-EVEN EXCEEDED — STRONG PAUSE/REDUCTION RECOMMENDATION',
      reason: `$${spend.toFixed(2)} spent with 0 purchases has passed this product's break-even CPA ($${breakEvenCpa.toFixed(2)}) — this spend can no longer be recovered by an average order. Recommend pausing or a significant bid reduction, unless there is compelling historical evidence this target converts.`,
    };
  }
  if (spend >= breakEvenCpa * APPROACH_RATIO) {
    return {
      action: 'REDUCE_BID',
      checkpointLabel: 'HIGH RISK — HARD STOP APPROACHING',
      reason: `$${spend.toFixed(2)} spent with 0 purchases is approaching this product's break-even CPA ($${breakEvenCpa.toFixed(2)}) — further spend without a sale carries meaningful loss risk.`,
    };
  }
  if (spend >= targetCpa) {
    return {
      action: 'REDUCE_BID',
      checkpointLabel: 'TARGET CPA EXCEEDED — CONSIDER BID REDUCTION',
      reason: `$${spend.toFixed(2)} spent with 0 purchases has passed this product's target CPA ($${targetCpa.toFixed(2)}, preserving its target profit) — consider a bid reduction or closer review.`,
    };
  }
  if (spend >= targetCpa * APPROACH_RATIO) {
    return {
      action: 'WATCH',
      checkpointLabel: 'WATCH — REVIEW SOON',
      reason: `$${spend.toFixed(2)} spent with 0 purchases is approaching this product's target CPA ($${targetCpa.toFixed(2)}) — review soon.`,
    };
  }
  return {
    action: 'HOLD_COLLECT_DATA',
    checkpointLabel: 'HOLD / COLLECT DATA',
    reason: `$${spend.toFixed(2)} spent with 0 purchases is still well below this product's target CPA ($${targetCpa.toFixed(2)}) — continue collecting data.`,
  };
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

  // For the zero-order, evidence-sufficient case (clicks >= 5 — the whole
  // WAIT/WATCH/REDUCE_BID/NEGATIVE_PAUSE_CANDIDATE family the base engine
  // can return when orders === 0), let this product's own confirmed CPA
  // economics drive the decision instead of the base engine's generic
  // dollar bands, which don't know this product's real break-even. This is
  // a Decision Center presentation choice only — decideTargetAction and its
  // own $8/$15/$20 thresholds are untouched and still drive every other
  // page that reads target.action directly.
  const targetCpaValue = manualEconomics?.complete ? manualEconomics.maxCpaForTargetProfit : null;
  const breakEvenCpaValue = manualEconomics?.complete ? manualEconomics.breakEvenCpa : null;
  const laddersApplicable = target.orders === 0 && target.clicks >= 5 && targetCpaValue !== null && breakEvenCpaValue !== null
    && targetCpaValue > 0 && breakEvenCpaValue > targetCpaValue;

  let checkpointLabel: string;
  if (laddersApplicable) {
    const ladder = zeroOrderEconomicsLadder({ spend: target.spend, targetCpa: targetCpaValue!, breakEvenCpa: breakEvenCpaValue! });
    action = ladder.action;
    reason = ladder.reason;
    checkpointLabel = ladder.checkpointLabel;
    if (action === 'PAUSE') {
      recommendedBid = null;
    } else if (action === 'REDUCE_BID' && target.currentBid !== null) {
      // Hard-stop-approaching gets the larger, base-engine-style cut (15%,
      // bounded by settings); target-CPA-exceeded gets the smaller one
      // (10%) — same convention decideTargetAction already uses.
      const cutPct = checkpointLabel === 'HIGH RISK — HARD STOP APPROACHING'
        ? Math.min(0.15, settings.maxBidReductionPct)
        : Math.min(0.10, settings.maxBidReductionPct);
      recommendedBid = clampBid(target.currentBid * (1 - cutPct));
    } else if (action !== 'REDUCE_BID') {
      recommendedBid = target.currentBid;
    }
  } else {
    checkpointLabel = targetCheckpointLabel({
      baseAction: base.action, clicks: target.clicks, orders: target.orders, delivery: target.delivery,
      remainingAllowance: Math.max(0, Math.round((risk.maxTestingSpend - target.spend) * 100) / 100),
      avgCpc: target.clicks > 0 ? target.spend / target.clicks : null,
    });
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
  const remainingToTargetCpaReview = target.orders === 0 && targetCpaValue !== null ? Math.max(0, Math.round((targetCpaValue - target.spend) * 100) / 100) : null;
  const remainingToBreakEvenStop = target.orders === 0 && breakEvenCpaValue !== null ? Math.max(0, Math.round((breakEvenCpaValue - target.spend) * 100) / 100) : null;

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
    targetCpa: targetCpaValue,
    breakEvenCpa: breakEvenCpaValue,
    remainingToTargetCpaReview,
    remainingToBreakEvenStop,
    delivery: target.delivery,
  };
}

// Campaign cards SUMMARIZE — the actionable, evidence-driven recommendation
// (including the zero-order CPA ladder above) lives on the keyword/target
// card underneath. This deliberately does NOT mirror targetCheckpointLabel
// or the CPA ladder: showing the same "WATCH — $X remaining" style message
// at both the campaign and target level created misleading duplicate
// priority in the ranked list (the same underlying situation counted
// twice). A campaign card only earns its own distinct message for a
// genuinely campaign-level fact — traffic status or a budget decision —
// everything else just points down to the target cards.
function campaignCheckpointLabel(params: {
  action: DecisionActionType;
  delivery: DeliveryStatus;
}): string {
  const { action, delivery } = params;

  if (action === 'HOLD_COLLECT_DATA' && delivery === 'NO_DELIVERY') return 'NO TRAFFIC — CONSIDER BID INCREASE';
  if (action === 'HOLD_COLLECT_DATA' && delivery === 'LOW_DELIVERY') return 'LOW DELIVERY — DO NOT PAUSE';
  if (action === 'INCREASE_BUDGET') return 'INCREASE BUDGET — EFFICIENT AND BUDGET-CAPPED';
  if (action === 'REDUCE_BUDGET') return 'REDUCE BUDGET — ABOVE BREAK-EVEN AND BUDGET-CAPPED';

  return 'CAMPAIGN SUMMARY — SEE KEYWORD/TARGET RECOMMENDATIONS BELOW';
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
    checkpointLabel: campaignCheckpointLabel({ action, delivery }),
    remainingTestAllowance,
    targetCpa: manualEconomics?.complete ? manualEconomics.maxCpaForTargetProfit : null,
    breakEvenCpa: manualEconomics?.complete ? manualEconomics.breakEvenCpa : null,
    // The two-CPA "remaining to review/stop" framing is a per-keyword bid
    // concept — campaign cards summarize, so these stay null here even when
    // economics are confirmed. See the target-level fields for the real
    // recommendation.
    remainingToTargetCpaReview: null,
    remainingToBreakEvenStop: null,
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
