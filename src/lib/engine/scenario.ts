export interface ScenarioInput {
  additionalSpend: number;
  cpc: number | null; // derived from campaign/keyword history
  conversionRate: number | null; // historical CVR (orders/clicks)
  contributionMarginPerOrder: number | null; // avg contribution before ads per order for the product
}

export interface ScenarioResult {
  isEstimate: true;
  additionalClicksAvailable: number | null;
  breakEvenOrdersNeeded: number | null;
  breakEvenConversionRateNeeded: number | null;
  currentConversionRate: number | null;
  feasible: 'LIKELY' | 'UNCERTAIN' | 'UNLIKELY' | 'UNKNOWN';
  explanation: string;
}

// "If I spend another $X on this SKU, what conversion performance is
// required to break even?" — a labeled estimate only, never a guarantee.
export function computeBreakEvenScenario(input: ScenarioInput): ScenarioResult {
  const { additionalSpend, cpc, conversionRate, contributionMarginPerOrder } = input;

  if (!cpc || cpc <= 0 || !contributionMarginPerOrder || contributionMarginPerOrder <= 0) {
    return {
      isEstimate: true,
      additionalClicksAvailable: null,
      breakEvenOrdersNeeded: null,
      breakEvenConversionRateNeeded: null,
      currentConversionRate: conversionRate,
      feasible: 'UNKNOWN',
      explanation: 'Not enough historical CPC or contribution-margin data to estimate this scenario.',
    };
  }

  const additionalClicksAvailable = additionalSpend / cpc;
  const breakEvenOrdersNeeded = additionalSpend / contributionMarginPerOrder;
  const breakEvenConversionRateNeeded = additionalClicksAvailable > 0 ? breakEvenOrdersNeeded / additionalClicksAvailable : null;

  let feasible: ScenarioResult['feasible'] = 'UNKNOWN';
  if (breakEvenConversionRateNeeded !== null && conversionRate !== null) {
    if (breakEvenConversionRateNeeded <= conversionRate * 0.8) feasible = 'LIKELY';
    else if (breakEvenConversionRateNeeded <= conversionRate * 1.2) feasible = 'UNCERTAIN';
    else feasible = 'UNLIKELY';
  }

  return {
    isEstimate: true,
    additionalClicksAvailable,
    breakEvenOrdersNeeded,
    breakEvenConversionRateNeeded,
    currentConversionRate: conversionRate,
    feasible,
    explanation: `Estimate only: at $${cpc.toFixed(2)} CPC, $${additionalSpend.toFixed(2)} buys roughly ${additionalClicksAvailable.toFixed(1)} clicks. Breaking even needs about ${breakEvenOrdersNeeded.toFixed(2)} order(s), i.e. a ${(breakEvenConversionRateNeeded! * 100).toFixed(1)}% conversion rate on those clicks.`,
  };
}
