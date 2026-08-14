import type { Confidence, ProductEconomics, Risk, Settings, TargetAction, TargetActionType } from '../../types';

export interface TargetActionInput {
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  acos: number | null;
  currentBid: number | null;
  mappingConfident: boolean;
  productId: string | null;
  productEconomics: ProductEconomics | null; // null = no Sellerboard economics available for this product
  settings: Settings;
}

const MIN_BID = 0.02;

function clampBid(bid: number): number {
  return Math.max(MIN_BID, Math.round(bid * 100) / 100);
}

function bidGuardrails(currentBid: number | null, recommendedBid: number | null, settings: Settings) {
  if (currentBid === null || recommendedBid === null) {
    return { safeRangeMin: null, safeRangeMax: null };
  }
  const min = clampBid(recommendedBid * (1 - settings.maxBidReductionPct));
  const max = clampBid(recommendedBid * (1 + settings.maxBidIncreasePct));
  return { safeRangeMin: Math.min(min, max), safeRangeMax: Math.max(min, max) };
}

function buildAction(
  action: TargetActionType,
  input: TargetActionInput,
  reason: string,
  risk: Risk,
  confidence: Confidence,
  bidMultiplier: number | null = null,
): TargetAction {
  const { currentBid, settings, spend } = input;
  const recommendedBid = currentBid !== null && bidMultiplier !== null ? clampBid(currentBid * bidMultiplier) : currentBid;
  const { safeRangeMin, safeRangeMax } = bidGuardrails(currentBid, recommendedBid, settings);
  const stopLoss = Math.max(0, settings.stopLossSpend - spend);
  return {
    action,
    currentBid,
    recommendedBid,
    safeRangeMin,
    safeRangeMax,
    stopLoss,
    reason,
    risk,
    confidence,
  };
}

// Conservative, evidence-gated action recommendation. Never automatically
// applied to Amazon — this only produces a suggestion with explicit reasoning.
export function decideTargetAction(input: TargetActionInput): TargetAction {
  const { clicks, orders, spend, acos, mappingConfident, productId, productEconomics, settings } = input;

  if (!productId || !mappingConfident) {
    return buildAction(
      'PRODUCT_MAPPING_REQUIRED',
      input,
      'Product mapping is unknown or low-confidence. Map this campaign/ad group to a product before any bid or economics decision can be made.',
      'BLOCKED',
      'LOW',
    );
  }

  const breakEven = productEconomics?.breakEvenAcos ?? null;
  const genericTarget = settings.targetAcosDefault;
  // Product-specific economics take priority over the generic target when stricter.
  const effectiveTarget = breakEven !== null ? Math.min(genericTarget, breakEven) : genericTarget;
  const scaleCeiling = effectiveTarget * (30 / 45);
  const watchCeiling = effectiveTarget; // ~45%-equivalent boundary
  const reduceCeiling = effectiveTarget * (60 / 45);
  const hardReduceCeiling = effectiveTarget * (80 / 45);

  const maxIncrease = 1 + Math.min(0.05, settings.maxBidIncreasePct);
  const softReduce = 1 - Math.min(0.10, settings.maxBidReductionPct);
  const hardReduce = 1 - Math.min(0.15, settings.maxBidReductionPct);

  if (clicks < 5) {
    return buildAction('WAIT', input, `Only ${clicks} click(s) recorded — insufficient evidence to act.`, 'LOW', 'LOW');
  }

  if (orders === 0) {
    if (spend < 8) {
      return buildAction('WAIT', input, `${clicks} clicks, 0 purchases, $${spend.toFixed(2)} spent — still within the wait window.`, 'LOW', 'LOW');
    }
    if (spend <= 15) {
      return buildAction('WATCH', input, `0 purchases with $${spend.toFixed(2)} spent — watch closely before acting.`, 'MEDIUM', 'MEDIUM');
    }
    if (spend <= 20) {
      return buildAction('REDUCE_BID', input, `0 purchases with $${spend.toFixed(2)} spent — reduce bid to limit further unproductive spend.`, 'MEDIUM', 'MEDIUM', softReduce);
    }
    if (clicks >= 20) {
      return buildAction('NEGATIVE_PAUSE_CANDIDATE', input, `0 purchases, ${clicks} clicks, $${spend.toFixed(2)} spent — strong evidence this target is not converting.`, 'HIGH', 'HIGH');
    }
    return buildAction('REDUCE_BID', input, `0 purchases with $${spend.toFixed(2)} spent but click volume is not yet high enough for a negative/pause call — reduce bid.`, 'MEDIUM', 'MEDIUM', softReduce);
  }

  if (acos === null) {
    return buildAction('WATCH', input, 'Purchases recorded but ACoS cannot be computed (no attributed sales value) — watch for more data.', 'MEDIUM', 'LOW');
  }

  if (orders >= 2 && acos <= scaleCeiling) {
    // Note: scaleCeiling is always derived as a fraction of breakEven (via
    // effectiveTarget = min(genericTarget, breakEven)), so clearing it can
    // never coincide with acos exceeding breakEven — that guard is
    // structurally redundant here and is instead enforced by scaleCeiling
    // itself never exceeding break-even.
    if (!productEconomics) {
      return buildAction('KEEP', input, `${orders} purchases at ${(acos * 100).toFixed(1)}% ACoS looks scalable, but no product economics are available to confirm profitability — scale blocked pending Sellerboard data.`, 'MEDIUM', 'LOW');
    }
    return buildAction('SCALE', input, `${orders} purchases at ${(acos * 100).toFixed(1)}% ACoS is within scale range and below this product's break-even ACoS.`, 'LOW', 'HIGH', maxIncrease);
  }

  if (acos <= watchCeiling) {
    return buildAction('KEEP', input, `ACoS ${(acos * 100).toFixed(1)}% is within the acceptable range for this product — maintain current bid.`, 'LOW', orders >= 2 ? 'HIGH' : 'MEDIUM');
  }

  if (acos <= reduceCeiling) {
    return buildAction('WATCH', input, `ACoS ${(acos * 100).toFixed(1)}% is elevated relative to this product's effective target (${(effectiveTarget * 100).toFixed(1)}%) — watch before acting.`, 'MEDIUM', 'MEDIUM');
  }

  if (acos <= hardReduceCeiling) {
    if (clicks >= 10) {
      return buildAction('REDUCE_BID', input, `ACoS ${(acos * 100).toFixed(1)}% is well above target with sufficient click evidence — reduce bid.`, 'HIGH', 'MEDIUM', softReduce);
    }
    return buildAction('WATCH', input, `ACoS ${(acos * 100).toFixed(1)}% is elevated but click evidence (${clicks}) is not yet sufficient for a bid change.`, 'MEDIUM', 'LOW');
  }

  if (clicks >= 10) {
    return buildAction('REDUCE_BID', input, `ACoS ${(acos * 100).toFixed(1)}% is severely above target — reduce bid up to 15%.`, 'HIGH', 'MEDIUM', hardReduce);
  }
  return buildAction('WATCH', input, `ACoS ${(acos * 100).toFixed(1)}% is severely above target but click evidence (${clicks}) is limited — watch before a larger bid cut.`, 'HIGH', 'LOW');
}
