import type { ProductEconomics, VariantIntelligenceResult, VariantMetricRow } from '../../types';
import type { ProductPerformanceRow } from './ppcPerformanceSeries';
import { computeCtr } from './metrics';

// Compares the configured products (Coconut/Rose/Vanilla/Mango by default)
// head-to-head across traffic, CTR, conversion, CPA, profitability, risk,
// and scaling opportunity. Built entirely from real current-period figures
// already computed elsewhere (buildProductPerformanceRows, Sellerboard
// economics, the risk engine) — nothing here is fabricated or estimated.
export function buildVariantIntelligence(
  performanceRows: ProductPerformanceRow[],
  economicsById: Record<string, ProductEconomics>,
  riskScoreByProductId: Record<string, number>,
): VariantIntelligenceResult {
  const rows: VariantMetricRow[] = performanceRows.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    impressions: r.impressions,
    clicks: r.clicks,
    ctr: computeCtr(r.clicks, r.impressions),
    orders: r.orders,
    cvr: r.clicks > 0 ? r.orders / r.clicks : null,
    spend: r.spend,
    sales: r.sales,
    cpa: r.orders > 0 ? r.spend / r.orders : null,
    acos: r.acos,
    roas: r.roas,
    netProfit: economicsById[r.productId]?.netProfit ?? null,
    riskScore: riskScoreByProductId[r.productId] ?? null,
  }));

  function bestBy(pick: (r: VariantMetricRow) => number | null, minimize = false): string | null {
    const withValue = rows.filter((r) => pick(r) !== null);
    if (withValue.length === 0) return null;
    const sorted = [...withValue].sort((a, b) => (minimize ? pick(a)! - pick(b)! : pick(b)! - pick(a)!));
    return sorted[0].productId;
  }

  // Conversion rate is only real evidence when at least one order backs it —
  // a 0%-vs-0% "win" between two products with zero orders is not a
  // meaningful comparison and must never be crowned "Best CVR".
  const withOrders = rows.filter((r) => r.orders > 0);
  const bestConversion = withOrders.length > 0
    ? [...withOrders].sort((a, b) => (b.cvr ?? 0) - (a.cvr ?? 0))[0].productId
    : null;

  // "Highest Risk" is only meaningful when the gap to the runner-up is large
  // enough to represent a real difference, not noise (e.g. 27 vs 26). A
  // single scored product is always shown; with 2+, require a real gap.
  const MEANINGFUL_RISK_GAP = 10;
  function highestRiskWithMeaningfulGap(): string | null {
    const withRisk = rows.filter((r) => r.riskScore !== null);
    if (withRisk.length === 0) return null;
    const sorted = [...withRisk].sort((a, b) => b.riskScore! - a.riskScore!);
    if (sorted.length === 1) return sorted[0].productId;
    const gap = sorted[0].riskScore! - sorted[1].riskScore!;
    return gap >= MEANINGFUL_RISK_GAP ? sorted[0].productId : null;
  }

  // A defensible, non-fabricated heuristic: the strongest scaling
  // opportunity is the most profitable product among those that are BOTH
  // confirmed profitable and not already flagged as elevated risk. Returns
  // null (never guessed) when no product qualifies.
  const scalingEligible = rows.filter((r) => r.netProfit !== null && r.netProfit > 0 && (r.riskScore === null || r.riskScore < 50));
  const strongestScalingOpportunity = scalingEligible.length > 0
    ? [...scalingEligible].sort((a, b) => b.netProfit! - a.netProfit!)[0].productId
    : null;

  return {
    rows,
    strongestTraffic: bestBy((r) => r.clicks),
    bestCtr: bestBy((r) => r.ctr),
    bestConversion,
    bestCpa: bestBy((r) => r.cpa, true),
    bestProfitability: bestBy((r) => r.netProfit),
    strongestScalingOpportunity,
    highestRisk: highestRiskWithMeaningfulGap(),
  };
}
