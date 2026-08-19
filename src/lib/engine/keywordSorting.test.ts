import { describe, it, expect } from 'vitest';
import { nextSortState, sortKeywordResultsForDisplay } from './keywordSorting';
import type { KeywordIntelligenceResult, KeywordZaphiraHistory } from '../../types/helium';

function history(overrides: Partial<KeywordZaphiraHistory> = {}): KeywordZaphiraHistory {
  return { label: 'Never tested', clicks: 0, spend: 0, orders: 0, isExistingTarget: false, isHistoricalWinner: false, ...overrides };
}

function row(overrides: Partial<KeywordIntelligenceResult> = {}): KeywordIntelligenceResult {
  return {
    keyword: 'coconut body butter', normalizedKeyword: 'coconut body butter', productId: 'coconut', productName: 'Coconut',
    isProductDefinite: true, isGenericRelevance: false, isCompetitorBrand: false, searchVolume: 1000, competitorCount: 3,
    sourceCount: 1, competitorStrengthLabel: '3 competitors ranking', zaphiraHistory: history(), opportunityScore: 50,
    risk: 'MEDIUM', confidence: 'MEDIUM', recommendedMatchType: 'PHRASE', recommendedBid: 0.5, maxSafeBid: 0.7,
    recommendedDailyBudget: 3, action: 'TEST', bidUnavailableReason: null, explanation: 'x',
    ...overrides,
  };
}

describe('sortKeywordResultsForDisplay — column === null keeps the caller\'s default order unchanged', () => {
  it('returns rows in their original order when no column is selected', () => {
    const rows = [row({ keyword: 'b' }), row({ keyword: 'a' }), row({ keyword: 'c' })];
    expect(sortKeywordResultsForDisplay(rows, null, 'asc').map((r) => r.keyword)).toEqual(['b', 'a', 'c']);
  });
});

describe('sortKeywordResultsForDisplay — alphabetical (Keyword)', () => {
  it('sorts A-Z ascending and Z-A descending', () => {
    const rows = [row({ keyword: 'rose body butter', normalizedKeyword: 'r' }), row({ keyword: 'coconut body butter', normalizedKeyword: 'c' }), row({ keyword: 'mango body butter', normalizedKeyword: 'm' })];
    expect(sortKeywordResultsForDisplay(rows, 'keyword', 'asc').map((r) => r.keyword)).toEqual(['coconut body butter', 'mango body butter', 'rose body butter']);
    expect(sortKeywordResultsForDisplay(rows, 'keyword', 'desc').map((r) => r.keyword)).toEqual(['rose body butter', 'mango body butter', 'coconut body butter']);
  });
});

describe('sortKeywordResultsForDisplay — numeric columns', () => {
  it('Search Volume: numeric ascending and descending', () => {
    const rows = [row({ normalizedKeyword: 'a', searchVolume: 500 }), row({ normalizedKeyword: 'b', searchVolume: 5000 }), row({ normalizedKeyword: 'c', searchVolume: 50 })];
    expect(sortKeywordResultsForDisplay(rows, 'searchVolume', 'asc').map((r) => r.searchVolume)).toEqual([50, 500, 5000]);
    expect(sortKeywordResultsForDisplay(rows, 'searchVolume', 'desc').map((r) => r.searchVolume)).toEqual([5000, 500, 50]);
  });

  it('Opportunity Score: numeric ascending and descending', () => {
    const rows = [row({ normalizedKeyword: 'a', opportunityScore: 40 }), row({ normalizedKeyword: 'b', opportunityScore: 90 }), row({ normalizedKeyword: 'c', opportunityScore: 10 })];
    expect(sortKeywordResultsForDisplay(rows, 'opportunityScore', 'asc').map((r) => r.opportunityScore)).toEqual([10, 40, 90]);
    expect(sortKeywordResultsForDisplay(rows, 'opportunityScore', 'desc').map((r) => r.opportunityScore)).toEqual([90, 40, 10]);
  });

  it('Recommended Bid, Maximum Safe Bid, Recommended Daily Budget: numeric, missing values (null) always last in either direction', () => {
    const rows = [
      row({ normalizedKeyword: 'a', recommendedBid: 0.9, maxSafeBid: 1.2, recommendedDailyBudget: 5 }),
      row({ normalizedKeyword: 'b', recommendedBid: null, maxSafeBid: null, recommendedDailyBudget: null }),
      row({ normalizedKeyword: 'c', recommendedBid: 0.3, maxSafeBid: 0.5, recommendedDailyBudget: 2 }),
    ];
    const asc = sortKeywordResultsForDisplay(rows, 'recommendedBid', 'asc');
    expect(asc.map((r) => r.normalizedKeyword)).toEqual(['c', 'a', 'b']); // 0.3, 0.9, then null last
    const desc = sortKeywordResultsForDisplay(rows, 'recommendedBid', 'desc');
    expect(desc.map((r) => r.normalizedKeyword)).toEqual(['a', 'c', 'b']); // 0.9, 0.3, then null LAST even in descending

    expect(sortKeywordResultsForDisplay(rows, 'maxSafeBid', 'desc').map((r) => r.normalizedKeyword)).toEqual(['a', 'c', 'b']);
    expect(sortKeywordResultsForDisplay(rows, 'recommendedDailyBudget', 'desc').map((r) => r.normalizedKeyword)).toEqual(['a', 'c', 'b']);
  });

  it('missing Search Volume also always sorts last in either direction', () => {
    const rows = [row({ normalizedKeyword: 'a', searchVolume: 100 }), row({ normalizedKeyword: 'b', searchVolume: null })];
    expect(sortKeywordResultsForDisplay(rows, 'searchVolume', 'asc').map((r) => r.normalizedKeyword)).toEqual(['a', 'b']);
    expect(sortKeywordResultsForDisplay(rows, 'searchVolume', 'desc').map((r) => r.normalizedKeyword)).toEqual(['a', 'b']);
  });
});

describe('sortKeywordResultsForDisplay — Competitor Strength sorts on the underlying count, not display text', () => {
  it('sorts by competitorCount even though the display label text would sort differently', () => {
    const rows = [
      row({ normalizedKeyword: 'a', competitorCount: 1, competitorStrengthLabel: '1 competitor ranking' }),
      row({ normalizedKeyword: 'b', competitorCount: 10, competitorStrengthLabel: '10 competitors ranking' }), // "10..." would sort before "1..." / "2..." alphabetically
      row({ normalizedKeyword: 'c', competitorCount: 2, competitorStrengthLabel: '2 competitors ranking' }),
    ];
    expect(sortKeywordResultsForDisplay(rows, 'competitorStrength', 'asc').map((r) => r.competitorCount)).toEqual([1, 2, 10]);
  });
});

describe('sortKeywordResultsForDisplay — Risk logical order (LOW < MEDIUM < HIGH < EXTREME)', () => {
  it('sorts risk in its defined logical order, not alphabetically', () => {
    const rows = [
      row({ normalizedKeyword: 'a', risk: 'EXTREME' }), row({ normalizedKeyword: 'b', risk: 'LOW' }),
      row({ normalizedKeyword: 'c', risk: 'HIGH' }), row({ normalizedKeyword: 'd', risk: 'MEDIUM' }),
    ];
    expect(sortKeywordResultsForDisplay(rows, 'risk', 'asc').map((r) => r.risk)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'EXTREME']);
    expect(sortKeywordResultsForDisplay(rows, 'risk', 'desc').map((r) => r.risk)).toEqual(['EXTREME', 'HIGH', 'MEDIUM', 'LOW']);
  });
});

describe('sortKeywordResultsForDisplay — Action priority order (LAUNCH < TEST < WATCH < AVOID)', () => {
  it('sorts action in its defined priority order, not alphabetically', () => {
    const rows = [
      row({ normalizedKeyword: 'a', action: 'AVOID' }), row({ normalizedKeyword: 'b', action: 'LAUNCH' }),
      row({ normalizedKeyword: 'c', action: 'WATCH' }), row({ normalizedKeyword: 'd', action: 'TEST' }),
    ];
    expect(sortKeywordResultsForDisplay(rows, 'action', 'asc').map((r) => r.action)).toEqual(['LAUNCH', 'TEST', 'WATCH', 'AVOID']);
  });
});

describe('sortKeywordResultsForDisplay — Zaphira PPC History sorts on evidence strength, not display text', () => {
  it('ranks existing target > historical winner > has orders > tested (clicks only) > never tested', () => {
    const rows = [
      row({ normalizedKeyword: 'never', zaphiraHistory: history() }),
      row({ normalizedKeyword: 'tested', zaphiraHistory: history({ label: 'Tested', clicks: 5 }) }),
      row({ normalizedKeyword: 'existing', zaphiraHistory: history({ label: 'Existing target', isExistingTarget: true }) }),
      row({ normalizedKeyword: 'winner', zaphiraHistory: history({ label: 'Historical winner', isHistoricalWinner: true, orders: 3 }) }),
      row({ normalizedKeyword: 'ordered', zaphiraHistory: history({ label: '1 order', orders: 1 }) }),
    ];
    expect(sortKeywordResultsForDisplay(rows, 'zaphiraHistory', 'desc').map((r) => r.normalizedKeyword)).toEqual(['existing', 'winner', 'ordered', 'tested', 'never']);
  });
});

describe('nextSortState — click cycle', () => {
  it('clicking a new column starts ascending', () => {
    expect(nextSortState({ column: null, direction: 'asc' }, 'opportunityScore')).toEqual({ column: 'opportunityScore', direction: 'asc' });
    expect(nextSortState({ column: 'risk', direction: 'desc' }, 'opportunityScore')).toEqual({ column: 'opportunityScore', direction: 'asc' });
  });

  it('clicking the active ascending column switches to descending', () => {
    expect(nextSortState({ column: 'opportunityScore', direction: 'asc' }, 'opportunityScore')).toEqual({ column: 'opportunityScore', direction: 'desc' });
  });

  it('clicking the active descending column returns to the default order (column null)', () => {
    expect(nextSortState({ column: 'opportunityScore', direction: 'desc' }, 'opportunityScore')).toEqual({ column: null, direction: 'asc' });
  });
});
