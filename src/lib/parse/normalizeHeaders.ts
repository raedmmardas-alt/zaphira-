// Header normalization: Amazon/Sellerboard export column names vary by marketplace,
// report type, and export date. We normalize to a canonical key space and resolve
// aliases so we never depend on one exact column order.

export function normalizeHeaderKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Canonical field -> list of normalized header aliases that map to it.
export const FIELD_ALIASES: Record<string, string[]> = {
  campaign: ['campaign name', 'campaigns', 'campaign'],
  campaignId: ['campaign id'],
  status: ['status', 'state', 'campaign status'],
  adGroup: ['ad group name', 'ad group', 'adgroup name', 'adgroup'],
  targetingText: [
    'targeting', 'target', 'targeting expression', 'keyword text', 'keyword',
    'product targeting expression', 'customer search term targeting',
  ],
  matchType: ['match type', 'matchtype', 'targeting type'],
  targetingId: ['keyword id', 'target id', 'targeting id'],
  bid: ['bid', 'max bid', 'keyword bid'],
  impressions: ['impressions'],
  clicks: ['clicks'],
  // "Total cost" is the canonical PPC spend column in current Amazon
  // Sponsored Products exports (Campaign, Targeting, Search Term, and
  // Advertised Product reports all use this shared alias list).
  spend: ['spend', 'cost', 'amount spent', 'spend usd', 'total cost'],
  orders: ['orders', '7 day total orders', 'total orders', 'orders new to brand', 'purchases'],
  sales: ['sales', '7 day total sales', 'total sales', 'attributed sales', 'sales usd'],
  budget: ['budget', 'daily budget', 'campaign budget amount'],
  // "Search term" belongs to the Search Term report's canonical searchTerm
  // field only. It must NOT also be listed under `keyword` below — aliases
  // are resolved into a single reverse lookup, so a value duplicated across
  // two canonical fields lets whichever field is declared later silently
  // steal it, which previously broke Search Term report recognition.
  searchTerm: ['customer search term', 'search term'],
  keyword: ['keyword', 'target'],
  // "Advertised product" is the current Amazon Advertised Product report's
  // ASIN identifier column. Deliberately exact-match only — "Advertised
  // product SKU/parent ID/marketplace/category" are distinct columns and
  // must never collide with this alias (or with each other).
  asin: ['asin', 'advertised asin', 'product asin', 'child asin', 'advertised product'],
  sku: ['sku', 'advertised sku', 'advertised product sku'],
  dateRange: ['date range', 'reporting range', 'date'],
  startDate: ['start date', 'report start date'],
  endDate: ['end date', 'report end date'],
  // Sellerboard
  marketplace: ['marketplace', 'market place', 'country'],
  salesOrganic: ['sales organic', 'organic sales'],
  salesPpc: ['sales ppc', 'ppc sales', 'sales advertising'],
  salesSponsoredProducts: ['sales sponsored products', 'sponsored products sales'],
  promotions: ['promotions', 'promotion', 'promo'],
  amazonFees: ['amazon fees', 'fees', 'referral fee', 'fba fee'],
  cogs: ['cogs', 'cost of goods', 'cost of goods sold'],
  refundCost: ['refund cost', 'refunds', 'refund'],
  adSpend: ['ads spend', 'ad spend', 'advertising cost', 'advertising spend'],
  units: ['units', 'units sold'],
  acos: ['acos'],
};

// Build reverse lookup once.
const REVERSE: Map<string, string> = new Map();
for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const alias of aliases) {
    REVERSE.set(alias, canonical);
  }
  REVERSE.set(normalizeHeaderKey(canonical), canonical);
}

export function resolveCanonicalField(rawHeader: string): string | null {
  const norm = normalizeHeaderKey(rawHeader);
  if (REVERSE.has(norm)) return REVERSE.get(norm)!;
  return null;
}

// Map an array of raw headers -> { canonicalField: rawHeader }
export function buildHeaderMap(rawHeaders: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const raw of rawHeaders) {
    const canonical = resolveCanonicalField(raw);
    if (canonical && !(canonical in map)) {
      map[canonical] = raw;
    }
  }
  return map;
}

export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[$,%]/g, '').replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned.toLowerCase() === 'n/a') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/[$,%]/g, '').replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned.toLowerCase() === 'n/a') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
