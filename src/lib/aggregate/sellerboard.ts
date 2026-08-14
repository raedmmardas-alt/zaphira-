import type { ProductEconomics, SellerboardProductRow } from '../../types';

// Aggregates Sellerboard's daily-row export into one economics record per
// Marketplace + ASIN + SKU. This is the fix for failure mode #1 (daily rows
// becoming dozens of fake "products") and failure mode #2 (zero sales from
// not summing SalesOrganic + SalesPPC).
export function aggregateSellerboardProducts(rows: SellerboardProductRow[]): ProductEconomics[] {
  const groups = new Map<string, SellerboardProductRow[]>();
  for (const row of rows) {
    const key = `${row.marketplace}|${row.asin}|${row.sku}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const result: ProductEconomics[] = [];
  for (const [key, groupRows] of groups) {
    const [marketplace, asin, sku] = key.split('|');

    const salesOrganic = sum(groupRows, (r) => r.salesOrganic);
    const salesPpc = sum(groupRows, (r) => r.salesPpc);
    // Total sales = organic + PPC only. SalesSponsoredProducts is a subset of
    // PPC sales in Sellerboard's schema and is intentionally NOT added again
    // here — adding it would double count (failure mode #2/#3).
    const totalSales = salesOrganic + salesPpc;

    // Sellerboard exports these cost columns as SIGNED values (negative =
    // a cost). Subtracting an already-negative raw sum would flip a cost
    // into income (e.g. AmazonFees -0.76, Ads spend 0 must net to -0.76,
    // not 0 - (-0.76) = +0.76). Normalize to positive magnitudes explicitly
    // before using them in the break-even/contribution subtraction below.
    const promotions = Math.abs(sum(groupRows, (r) => r.promotions));
    const amazonFees = Math.abs(sum(groupRows, (r) => r.amazonFees));
    const cogs = Math.abs(sum(groupRows, (r) => r.cogs));
    const refundCost = Math.abs(sum(groupRows, (r) => r.refundCost));
    // Ad spend may be stored as a negative "cost" column in some exports.
    const ppcSpend = Math.abs(sum(groupRows, (r) => r.adSpend));
    const units = sum(groupRows, (r) => r.units);
    const orders = sum(groupRows, (r) => r.orders);

    const contributionBeforeAds = totalSales - promotions - amazonFees - cogs - refundCost;
    // Break-even ACoS never subtracts PPC spend — PPC is what we're testing
    // against this margin, not a component of it.
    const breakEvenAcos = totalSales > 0 ? contributionBeforeAds / totalSales : null;

    // Product Net Profit: prefer Sellerboard's own signed Net Profit total
    // when the export includes that column — it is the authoritative final
    // figure and must never be reconstructed from components when present.
    // Only fall back to reconstructing it from contribution-before-ads minus
    // PPC spend when Sellerboard did not supply a Net Profit column at all.
    const hasNetProfitColumn = groupRows.some((r) => r.netProfit !== null && r.netProfit !== undefined);
    const netProfit = hasNetProfitColumn
      ? sum(groupRows, (r) => r.netProfit ?? 0)
      : contributionBeforeAds - ppcSpend;

    const margin = totalSales > 0 ? netProfit / totalSales : null;
    const realAcos = totalSales > 0 ? ppcSpend / totalSales : null;

    result.push({
      productId: null,
      asin,
      sku,
      marketplace,
      totalSales,
      ppcSpend,
      promotions,
      amazonFees,
      cogs,
      refundCost,
      contributionBeforeAds,
      breakEvenAcos,
      netProfit,
      margin,
      realAcos,
      units,
      orders,
    });
  }

  return result;
}

function sum<T>(rows: T[], f: (r: T) => number): number {
  return rows.reduce((acc, r) => acc + (f(r) || 0), 0);
}
