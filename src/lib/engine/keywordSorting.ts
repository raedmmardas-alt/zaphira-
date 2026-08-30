// Keyword Opportunities table sorting — UI display order only. Never
// recomputes or alters any intelligence-engine value (score, risk, bid,
// action, etc.); it only re-orders an already-analyzed results array. Kept
// in its own pure module (rather than inline in KeywordFinder.tsx) so
// sorting behavior is deterministically testable and so re-sorting in the
// UI can be memoized separately from the expensive analyzeHeliumKeywords()
// call.
import type { KeywordAction, KeywordIntelligenceResult } from '../../types/helium';

export type SortColumn =
  | 'keyword' | 'searchVolume' | 'competitorStrength' | 'zaphiraHistory' | 'opportunityScore'
  | 'risk' | 'matchType' | 'recommendedBid' | 'maxSafeBid' | 'recommendedDailyBudget' | 'action';
export type SortDirection = 'asc' | 'desc';

const RISK_SORT_ORDER: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, EXTREME: 3 };
const ACTION_SORT_ORDER: Record<KeywordAction, number> = { LAUNCH: 0, TEST: 1, WATCH: 2, AVOID: 3 };

function historyRank(h: KeywordIntelligenceResult['zaphiraHistory']): number {
  if (h.isExistingTarget) return 4;
  if (h.isHistoricalWinner) return 3;
  if (h.orders > 0) return 2;
  if (h.clicks > 0) return 1;
  return 0;
}

// Sorts by the underlying value, never the display string — e.g.
// "Competitor Strength" sorts on competitorCount, not the rendered
// "N competitors ranking..." text.
export const SORT_ACCESSORS: Record<SortColumn, (r: KeywordIntelligenceResult) => number | string | null> = {
  keyword: (r) => r.keyword.toLowerCase(),
  searchVolume: (r) => r.searchVolume,
  competitorStrength: (r) => r.competitorCount,
  zaphiraHistory: (r) => historyRank(r.zaphiraHistory),
  opportunityScore: (r) => r.opportunityScore,
  risk: (r) => RISK_SORT_ORDER[r.risk],
  matchType: (r) => r.recommendedMatchType,
  recommendedBid: (r) => r.recommendedBid,
  maxSafeBid: (r) => r.maxSafeBid,
  recommendedDailyBudget: (r) => r.recommendedDailyBudget,
  action: (r) => ACTION_SORT_ORDER[r.action],
};

// Missing values (null) always sort to the bottom, in either direction.
// `column === null` means "no manual sort selected" — the array is
// returned unchanged, preserving whatever default order the caller already
// applied (LAUNCH > TEST > WATCH > AVOID, then Opportunity Score
// descending, via sortKeywordResults in keywordIntelligence.ts).
export function sortKeywordResultsForDisplay(rows: KeywordIntelligenceResult[], column: SortColumn | null, direction: SortDirection): KeywordIntelligenceResult[] {
  if (!column) return rows;
  const accessor = SORT_ACCESSORS[column];
  return rows
    .map((r, i) => ({ r, v: accessor(r), i }))
    .sort((a, b) => {
      const aNull = a.v === null;
      const bNull = b.v === null;
      if (aNull && bNull) return a.i - b.i; // stable among equally-missing rows
      if (aNull) return 1;
      if (bNull) return -1;
      const cmp = typeof a.v === 'string' ? (a.v as string).localeCompare(b.v as string) : (a.v as number) - (b.v as number);
      return direction === 'asc' ? cmp : -cmp;
    })
    .map((x) => x.r);
}

// Click cycle: inactive -> ascending -> descending -> inactive (back to
// the caller's default order).
export function nextSortState(current: { column: SortColumn | null; direction: SortDirection }, clicked: SortColumn): { column: SortColumn | null; direction: SortDirection } {
  if (current.column !== clicked) return { column: clicked, direction: 'asc' };
  if (current.direction === 'asc') return { column: clicked, direction: 'desc' };
  return { column: null, direction: 'asc' };
}
