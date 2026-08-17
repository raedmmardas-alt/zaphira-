import type { CampaignRow, DateRange, EnrichedCampaign, ISODate, Product } from '../../types';
import { computeAcos, computeCpc, computeRoas } from './metrics';

export type ChartGranularity = 'daily' | 'weekly' | 'monthly';

export interface PerformancePoint {
  // For daily this is the calendar day; for weekly it's the Monday of that
  // ISO week; for monthly it's the first of the month. Always a real date
  // that at least one underlying daily row genuinely falls within.
  date: ISODate;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
}

// Builds one point per genuine single-day Campaign report row within the
// current period. Rows that only carry an aggregated multi-day range
// (activityStart !== activityEnd) are excluded — attributing their total to
// a single day would fabricate a daily value that was never in the source
// file. The chart is only as granular as what was actually uploaded.
export function buildDailySeriesFromCampaigns(rows: CampaignRow[], currentPeriod: DateRange | null): PerformancePoint[] {
  if (!currentPeriod) return [];
  const byDate = new Map<string, PerformancePoint>();
  for (const r of rows) {
    if (!r.activityStart || !r.activityEnd || r.activityStart !== r.activityEnd) continue;
    const date = r.activityStart;
    if (date < currentPeriod.start || date > currentPeriod.end) continue;
    const existing = byDate.get(date) ?? { date, impressions: 0, clicks: 0, spend: 0, sales: 0 };
    existing.impressions += r.impressions;
    existing.clicks += r.clicks;
    existing.spend += r.spend;
    existing.sales += r.sales;
    byDate.set(date, existing);
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

function mondayOf(dateStr: ISODate): ISODate {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dayOfWeek = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (dayOfWeek + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

function firstOfMonth(dateStr: ISODate): ISODate {
  return `${dateStr.slice(0, 7)}-01`;
}

// Aggregates genuine daily points into weekly/monthly buckets. This only
// ever sums real daily values that already exist — it never invents a day.
export function bucketSeries(points: PerformancePoint[], granularity: ChartGranularity): PerformancePoint[] {
  if (granularity === 'daily') return points;
  const keyFor = granularity === 'weekly' ? mondayOf : firstOfMonth;
  const byBucket = new Map<string, PerformancePoint>();
  for (const p of points) {
    const key = keyFor(p.date);
    const existing = byBucket.get(key) ?? { date: key, impressions: 0, clicks: 0, spend: 0, sales: 0 };
    existing.impressions += p.impressions;
    existing.clicks += p.clicks;
    existing.spend += p.spend;
    existing.sales += p.sales;
    byBucket.set(key, existing);
  }
  return Array.from(byBucket.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface ProductPerformanceRow {
  productId: string;
  productName: string;
  asin: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  cpc: number | null;
  acos: number | null;
  roas: number | null;
}

// Current-period ad performance rolled up per configured product (Coconut/
// Rose/Vanilla/Mango by default), from the same campaign data the rest of
// the Dashboard already uses — no new calculation semantics.
export function buildProductPerformanceRows(campaigns: EnrichedCampaign[], products: Product[]): ProductPerformanceRow[] {
  return products.map((p) => {
    const rows = campaigns.filter((c) => c.isCurrentPeriod && c.productId === p.id);
    const impressions = rows.reduce((a, c) => a + c.impressions, 0);
    const clicks = rows.reduce((a, c) => a + c.clicks, 0);
    const spend = rows.reduce((a, c) => a + c.spend, 0);
    const orders = rows.reduce((a, c) => a + c.orders, 0);
    const sales = rows.reduce((a, c) => a + c.sales, 0);
    return {
      productId: p.id,
      productName: p.name,
      asin: p.asin,
      impressions,
      clicks,
      spend,
      orders,
      sales,
      cpc: computeCpc(spend, clicks),
      acos: computeAcos(spend, sales),
      roas: computeRoas(sales, spend),
    };
  });
}
