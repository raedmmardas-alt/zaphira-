import type { ProductEconomics, ProductStrategyResult } from '../../types';

// Product strategy classification. MUST be called only after final,
// normalized metrics (aggregated Sellerboard economics) are available —
// never against raw/stale per-row values (failure mode #4).
export function classifyProductStrategy(economics: ProductEconomics | null): ProductStrategyResult {
  const productId = economics?.productId ?? null;

  if (!economics || economics.totalSales <= 0) {
    return { productId, strategy: 'INSUFFICIENT_DATA', reason: 'No sales/economics data available for this product in the current period.' };
  }

  const { breakEvenAcos, realAcos, netProfit } = economics;

  if (breakEvenAcos === null || realAcos === null) {
    return { productId, strategy: 'INSUFFICIENT_DATA', reason: 'Break-even or real ACoS could not be computed from the available data.' };
  }

  if (netProfit < 0) {
    return { productId, strategy: 'REDUCE_WASTE', reason: `Product is net-unprofitable this period ($${netProfit.toFixed(2)}) — reduce unproductive PPC spend.` };
  }

  if (realAcos <= breakEvenAcos * 0.85) {
    return { productId, strategy: 'GROW_CAREFULLY', reason: `Real ACoS (${(realAcos * 100).toFixed(1)}%) is comfortably below break-even (${(breakEvenAcos * 100).toFixed(1)}%) — room to invest carefully.` };
  }

  if (realAcos <= breakEvenAcos) {
    return { productId, strategy: 'MONITOR', reason: `Real ACoS (${(realAcos * 100).toFixed(1)}%) is close to break-even (${(breakEvenAcos * 100).toFixed(1)}%) — monitor before increasing spend.` };
  }

  return { productId, strategy: 'FIX_ECONOMICS', reason: `Real ACoS (${(realAcos * 100).toFixed(1)}%) exceeds break-even (${(breakEvenAcos * 100).toFixed(1)}%) — fix economics before scaling.` };
}

export const STRATEGY_LABEL: Record<ProductStrategyResult['strategy'], string> = {
  GROW_CAREFULLY: 'Grow Carefully',
  FIX_ECONOMICS: 'Fix Economics',
  REDUCE_WASTE: 'Reduce Waste',
  MONITOR: 'Monitor',
  INSUFFICIENT_DATA: 'Insufficient Data',
};
