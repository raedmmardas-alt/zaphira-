import type {
  EnrichedSearchTerm, EnrichedTarget, KeywordOpportunity, OpportunitySource, Product, SellerboardKeywordRow,
} from '../../types';

function norm(s: string): string {
  return s.toLowerCase().trim();
}

// Builds deduplicated keyword opportunity candidates from converting search
// terms, historical winners, Sellerboard keyword intelligence, and manual
// entries — never suggesting a keyword/product/match combination already targeted.
export function buildKeywordOpportunities(
  searchTerms: EnrichedSearchTerm[],
  currentTargets: EnrichedTarget[],
  sellerboardKeywords: SellerboardKeywordRow[],
  manualEntries: { keyword: string; productId: string | null }[],
  products: Product[],
): KeywordOpportunity[] {
  const alreadyTargeted = new Set(
    currentTargets.filter((t) => t.isCurrentPeriod).map((t) => `${norm(t.targetingText)}|${t.productId ?? ''}|${norm(t.matchType)}`),
  );

  const candidates = new Map<string, KeywordOpportunity>();

  function upsert(
    keyword: string,
    source: OpportunitySource,
    productId: string | null,
    orders: number,
    sales: number,
    acos: number | null,
  ) {
    const productName = products.find((p) => p.id === productId)?.name ?? null;
    const dedupeKey = `${norm(keyword)}|${productId ?? ''}`;
    const matchKey = `${norm(keyword)}|${productId ?? ''}|broad`;
    const targeted = alreadyTargeted.has(matchKey) || [...alreadyTargeted].some((k) => k.startsWith(`${norm(keyword)}|${productId ?? ''}`));

    const existing = candidates.get(dedupeKey);
    if (existing) {
      existing.historicalOrders = Math.max(existing.historicalOrders, orders);
      existing.historicalSales = Math.max(existing.historicalSales, sales);
      if (acos !== null && (existing.historicalAcos === null || acos < existing.historicalAcos)) existing.historicalAcos = acos;
      return;
    }

    candidates.set(dedupeKey, {
      id: dedupeKey,
      keyword,
      source,
      productId,
      productName,
      historicalOrders: orders,
      historicalSales: sales,
      historicalAcos: acos,
      currentActiveStatus: targeted ? 'ALREADY_TARGETED' : 'NOT_CURRENTLY_TARGETED',
      alreadyTargeted: targeted,
      suggestedMatchType: 'phrase',
      suggestedTestBid: null,
      confidence: orders >= 2 ? 'HIGH' : orders === 1 ? 'MEDIUM' : 'LOW',
    });
  }

  for (const st of searchTerms) {
    // Only actual current converters and confirmed historical winners feed
    // this source — a single-order "promising" row is not yet a winner and
    // must never be mislabeled as one (every recommendation must be explainable).
    if (st.isCurrentPeriod && st.orders >= 1) {
      upsert(st.searchTerm, 'CONVERTING_SEARCH_TERM', st.productId, st.orders, st.sales, st.acos);
    } else if (st.classification === 'HISTORICAL_WINNER') {
      upsert(st.searchTerm, 'HISTORICAL_WINNER', st.productId, st.orders, st.sales, st.acos);
    }
  }

  for (const kw of sellerboardKeywords) {
    if (kw.orders >= 1) {
      const product = products.find((p) => kw.asin && norm(p.asin) === norm(kw.asin!)) ?? null;
      upsert(kw.keyword, 'SELLERBOARD_KEYWORD', product?.id ?? null, kw.orders, kw.sales, kw.acos ?? (kw.sales > 0 ? kw.spend / kw.sales : null));
    }
  }

  for (const m of manualEntries) {
    upsert(m.keyword, 'MANUAL_ENTRY', m.productId, 0, 0, null);
  }

  return Array.from(candidates.values())
    .filter((c) => !c.alreadyTargeted)
    .sort((a, b) => b.historicalOrders - a.historicalOrders || b.historicalSales - a.historicalSales);
}
