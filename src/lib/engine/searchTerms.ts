import type { EnrichedSearchTerm, SearchTermClassification } from '../../types';

// Historical search-term rules. These NEVER produce active bid changes —
// they are intelligence only, surfaced through Keyword Opportunities.
export function classifySearchTerm(isCurrentPeriod: boolean, orders: number, acos: number | null): SearchTermClassification {
  if (isCurrentPeriod) return 'CURRENT_SEARCH_TERM';

  if (orders >= 2 && acos !== null && acos <= 0.45) return 'HISTORICAL_WINNER';
  if (orders === 1 && acos !== null && acos <= 0.45) return 'HISTORICAL_PROMISING';
  if (orders === 1 && (acos === null || acos > 0.45)) return 'HISTORICAL_INEFFICIENT';
  return 'HISTORICAL_INSIGHT';
}

export function decorateSearchTerms(rows: Omit<EnrichedSearchTerm, 'classification'>[]): EnrichedSearchTerm[] {
  return rows.map((r) => ({
    ...r,
    classification: classifySearchTerm(r.isCurrentPeriod, r.orders, r.acos),
  }));
}

export const SEARCH_TERM_LABEL: Record<SearchTermClassification, string> = {
  CURRENT_SEARCH_TERM: 'Current Search Term',
  HISTORICAL_WINNER: 'Historical Winner',
  HISTORICAL_PROMISING: 'Historical Promising — More Data',
  HISTORICAL_INEFFICIENT: 'Historical Inefficient — Watch',
  HISTORICAL_INSIGHT: 'Historical Insight — No Bid Change',
};
