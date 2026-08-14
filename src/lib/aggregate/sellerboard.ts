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

    const promotions = sum(groupRows, (r) => r.promotions);
    const amazonFees = sum(groupRows, (r) => r.amazonFees);
    const cogs = sum(groupRows, (r) => r.cogs);
    const refundCost = sum(groupRows, (r) => r.refundCost);
    // Ad spend may be stored as a negative "cost" column in some exports.
    const ppcSpend = Math.abs(sum(groupRows, (r) => r.adSpend));
    const units = sum(groupRows, (r) => r.units);
    const orders = sum(groupRows, (r) => r.orders);

    const contributionBeforeAds = totalSales - promotions - amazonFees - cogs - refundCost;
    // Break-even ACoS never subtracts PPC spend — PPC is what we're testing
    // against this margin, not a component of it.
    const breakEvenAcos = totalSales > 0 ? contributionBeforeAds / totalSales : null;
    const netProfit = contributionBeforeAds - ppcSpend;
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
