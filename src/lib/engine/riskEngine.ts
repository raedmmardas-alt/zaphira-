import type { DeliveryStatus, ProductEconomics, ProductEconomicsCalcResult, RiskBreakdown, RiskClassification, Settings } from '../../types';

export interface RiskInput {
  clicks: number;
  orders: number;
  spend: number;
  acos: number | null; // spend/sales for this target/campaign, null when sales=0
  delivery: DeliveryStatus;
  mappingConfident: boolean;
  productEconomics: ProductEconomics | null; // Sellerboard-derived, preferred
  manualEconomics: ProductEconomicsCalcResult | null; // manual, used when Sellerboard economics are absent
  settings: Settings;
}

const WEIGHTS = {
  spend: 0.25,
  conversion: 0.25,
  profitability: 0.25,
  delivery: 0.10,
  dataConfidence: 0.15,
};

function classify(score: number): RiskClassification {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MODERATE';
  return 'LOW';
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

// Resolves a single break-even ACoS to compare real ACoS against, preferring
// Sellerboard-derived economics (period-aggregated, most authoritative) and
// falling back to manual per-order economics when that's all that's
// available. Returns null when neither is complete — profitability risk
// must never be guessed from an assumed break-even.
function resolveBreakEven(productEconomics: ProductEconomics | null, manualEconomics: ProductEconomicsCalcResult | null): number | null {
  if (productEconomics?.breakEvenAcos !== null && productEconomics?.breakEvenAcos !== undefined) return productEconomics.breakEvenAcos;
  if (manualEconomics?.complete && manualEconomics.breakEvenAcos !== null) return manualEconomics.breakEvenAcos;
  return null;
}

// Computes the five risk dimensions plus an overall 0-100 score and
// LOW/MODERATE/HIGH/CRITICAL classification, and a maximum testing-spend
// (stop-loss) figure. Insufficient data raises dataConfidenceRisk alone —
// it never inflates conversion/profitability risk, so a low-sample target
// is never mistaken for a poor performer.
export function computeRisk(input: RiskInput): RiskBreakdown {
  const { clicks, orders, spend, acos, delivery, mappingConfident, productEconomics, manualEconomics, settings } = input;
  const reasons: string[] = [];

  if (!mappingConfident) {
    return {
      spendRisk: 100,
      conversionRisk: 100,
      profitabilityRisk: 100,
      deliveryRisk: 0,
      dataConfidenceRisk: 100,
      overallScore: 100,
      classification: 'CRITICAL',
      maxTestingSpend: 0,
      maxTestingSpendSource: 'SETTINGS_FALLBACK',
      reasons: ['Product mapping is unknown or unconfirmed — risk cannot be assessed until this is mapped.'],
    };
  }

  // --- Spend risk: how far current spend sits toward the configured stop-loss ceiling.
  const spendRisk = clamp((spend / Math.max(1, settings.stopLossSpend)) * 100);
  if (spendRisk >= 75) reasons.push(`Spend ($${spend.toFixed(2)}) is close to or past the stop-loss threshold ($${settings.stopLossSpend}).`);

  // --- Conversion risk: 0 orders with meaningful click volume is risky; sparse clicks are a data problem, not a conversion problem.
  let conversionRisk: number;
  if (clicks < 5) {
    conversionRisk = 15; // negligible evidence either way; kept low, not punitive
  } else if (orders > 0) {
    conversionRisk = 10;
  } else {
    // Scales with clicks past the evidence threshold, capped.
    conversionRisk = clamp(20 + (clicks - 5) * 4);
  }

  // --- Profitability risk: real ACoS vs the best available break-even.
  const breakEven = resolveBreakEven(productEconomics, manualEconomics);
  let profitabilityRisk: number;
  if (acos === null) {
    profitabilityRisk = orders > 0 ? 10 : 30; // orders with no computable ACoS is unusual; otherwise mild/unknown
  } else if (breakEven === null) {
    profitabilityRisk = 40; // real ACoS exists but nothing to compare it to — moderate, unknown-leaning risk
    reasons.push('No confirmed product economics (Sellerboard or manual) — profitability risk is only an approximation.');
  } else if (breakEven <= 0) {
    profitabilityRisk = 90; // product is unprofitable even before any ad spend
    reasons.push('This product\'s break-even ACoS is at or below 0% — it is not profitable even without advertising.');
  } else {
    const ratio = acos / breakEven;
    profitabilityRisk = clamp((ratio - 0.5) * 100);
    if (ratio > 1) reasons.push(`Real ACoS (${(acos * 100).toFixed(1)}%) exceeds break-even (${(breakEven * 100).toFixed(1)}%).`);
  }

  // --- Delivery risk: uncertainty about whether the target is even getting a fair test, NOT a performance judgment.
  const deliveryRisk: number = delivery === 'NO_DELIVERY' ? 35 : delivery === 'LOW_DELIVERY' ? 20 : delivery === 'DELIVERING' ? 5 : 0;
  if (delivery === 'NO_DELIVERY' || delivery === 'LOW_DELIVERY') {
    reasons.push(`${delivery === 'NO_DELIVERY' ? 'No' : 'Low'} delivery — this reflects traffic uncertainty, not confirmed poor performance.`);
  }

  // --- Data confidence risk: purely about sample size, kept independent of the dimensions above.
  const dataConfidenceRisk = clicks >= 30 ? 5 : clicks >= 10 ? 25 : clicks >= 5 ? 50 : 80;
  if (dataConfidenceRisk >= 50) reasons.push(`Only ${clicks} click(s) recorded — limited sample size.`);

  const overallScore = Math.round(clamp(
    spendRisk * WEIGHTS.spend +
    conversionRisk * WEIGHTS.conversion +
    profitabilityRisk * WEIGHTS.profitability +
    deliveryRisk * WEIGHTS.delivery +
    dataConfidenceRisk * WEIGHTS.dataConfidence,
  ));

  // --- Stop-loss: maximum $ to test with before action is warranted.
  let maxTestingSpend: number;
  let maxTestingSpendSource: RiskBreakdown['maxTestingSpendSource'];
  if (manualEconomics?.complete && manualEconomics.breakEvenCpa !== null && manualEconomics.breakEvenCpa > 0) {
    maxTestingSpend = Math.min(settings.stopLossSpend, manualEconomics.breakEvenCpa * 2);
    maxTestingSpendSource = 'PRODUCT_ECONOMICS';
  } else if (productEconomics?.breakEvenAcos !== null && productEconomics?.breakEvenAcos !== undefined && productEconomics.breakEvenAcos > 0 && orders > 0 && spend > 0) {
    const impliedCpa = spend / orders;
    maxTestingSpend = Math.min(settings.stopLossSpend, impliedCpa * 2);
    maxTestingSpendSource = 'PRODUCT_ECONOMICS';
  } else {
    maxTestingSpend = settings.stopLossSpend;
    maxTestingSpendSource = 'SETTINGS_FALLBACK';
    reasons.push('No product economics available — using the generic configured stop-loss spend rather than a product-specific figure.');
  }

  if (orders === 0 && breakEven === null && acos === null && clicks < 5) {
    reasons.push('Insufficient data — this reflects sample size, not confirmed poor performance.');
  }

  return {
    spendRisk,
    conversionRisk,
    profitabilityRisk,
    deliveryRisk,
    dataConfidenceRisk,
    overallScore,
    classification: classify(overallScore),
    maxTestingSpend: Math.max(0, Math.round(maxTestingSpend * 100) / 100),
    maxTestingSpendSource,
    reasons,
  };
}
