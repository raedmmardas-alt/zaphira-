import { describe, it, expect } from 'vitest';
import { aggregateHeliumKeywords, normalizeKeywordText } from './heliumKeywords';
import type { HeliumRawKeywordRow } from '../../types/helium';

function row(overrides: Partial<HeliumRawKeywordRow>): HeliumRawKeywordRow {
  return {
    keyword: 'coconut body butter', searchVolume: null, organicRank: null, sponsoredRank: null,
    competingProducts: null, titleDensity: null, cerebroIqScore: null, cpr: null, suggestedBid: null,
    keywordSales: null, searchVolumeTrend: null, competitorAsin: null, sourceId: 'source-1',
    ...overrides,
  };
}

describe('normalizeKeywordText', () => {
  it('lowercases, trims, and collapses repeated internal whitespace', () => {
    expect(normalizeKeywordText('  Coconut   Body  Butter  ')).toBe('coconut body butter');
    expect(normalizeKeywordText('Coconut Body Butter')).toBe('coconut body butter');
  });
});

describe('aggregateHeliumKeywords — deduplication across multiple competitors', () => {
  it('combines multiple competitor rows for the same keyword into one aggregate, never creating duplicate rows', () => {
    const rows: HeliumRawKeywordRow[] = [
      row({ keyword: 'coconut body butter', competitorAsin: 'B001AAA', organicRank: 8, sponsoredRank: 3, searchVolume: 1672 }),
      row({ keyword: 'Coconut Body Butter', competitorAsin: 'B002BBB', organicRank: 4, sponsoredRank: null, searchVolume: 1650 }),
      row({ keyword: '  coconut   body butter  ', competitorAsin: 'B003CCC', organicRank: 15, sponsoredRank: 9, searchVolume: 1700 }),
    ];
    const aggregates = aggregateHeliumKeywords(rows);
    expect(aggregates).toHaveLength(1);
    const agg = aggregates[0];
    expect(agg.keyword).toBe('coconut body butter');
    expect(agg.normalizedKeyword).toBe('coconut body butter');
    expect(agg.competitorCount).toBe(3);
    expect(agg.competitorAsins.sort()).toEqual(['B001AAA', 'B002BBB', 'B003CCC']);
    expect(agg.bestOrganicRank).toBe(4); // lowest (best) of 8, 4, 15
    expect(agg.bestSponsoredRank).toBe(3); // lowest of 3, 9 (null ignored)
    expect(agg.medianOrganicRank).toBe(8); // median of [4, 8, 15]
    expect(agg.maxSearchVolume).toBe(1700);
  });

  it('never double-counts an exact duplicate row for the same competitor ASIN', () => {
    const rows: HeliumRawKeywordRow[] = [
      row({ keyword: 'vanilla body lotion', competitorAsin: 'B001AAA' }),
      row({ keyword: 'vanilla body lotion', competitorAsin: 'B001AAA' }), // accidental exact duplicate
    ];
    const aggregates = aggregateHeliumKeywords(rows);
    expect(aggregates[0].competitorCount).toBe(1);
    expect(aggregates[0].competitorAsins).toEqual(['B001AAA']);
  });

  it('keeps unrelated keywords as separate aggregates', () => {
    const rows: HeliumRawKeywordRow[] = [
      row({ keyword: 'coconut body butter' }),
      row({ keyword: 'rose body butter' }),
    ];
    const aggregates = aggregateHeliumKeywords(rows);
    expect(aggregates).toHaveLength(2);
    expect(aggregates.map((a) => a.normalizedKeyword).sort()).toEqual(['coconut body butter', 'rose body butter']);
  });

  it('treats a keyword with no ASIN column at all as one competitor context, not zero', () => {
    const rows: HeliumRawKeywordRow[] = [row({ keyword: 'mango body butter', competitorAsin: null })];
    const aggregates = aggregateHeliumKeywords(rows);
    expect(aggregates[0].competitorCount).toBe(1);
    expect(aggregates[0].competitorAsins).toEqual([]);
  });

  it('takes the median suggested bid (not the mean or an outlier) as the representative value', () => {
    const rows: HeliumRawKeywordRow[] = [
      row({ keyword: 'coconut body butter', competitorAsin: 'A', suggestedBid: 0.80 }),
      row({ keyword: 'coconut body butter', competitorAsin: 'B', suggestedBid: 0.90 }),
      row({ keyword: 'coconut body butter', competitorAsin: 'C', suggestedBid: 5.00 }), // outlier
    ];
    const aggregates = aggregateHeliumKeywords(rows);
    expect(aggregates[0].suggestedBid).toBe(0.90);
  });

  it('ignores rows with a blank keyword rather than creating an empty-string aggregate', () => {
    const rows: HeliumRawKeywordRow[] = [row({ keyword: '   ' }), row({ keyword: 'rose body butter' })];
    const aggregates = aggregateHeliumKeywords(rows);
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0].normalizedKeyword).toBe('rose body butter');
  });
});

describe('aggregateHeliumKeywords — multi-source (competitor file) overlap', () => {
  it('is always exactly 1 source when only one file is loaded — never fabricated as more', () => {
    const rows: HeliumRawKeywordRow[] = [
      row({ keyword: 'coconut body butter', competitorAsin: 'A', sourceId: 'source-1' }),
      row({ keyword: 'coconut body butter', competitorAsin: 'B', sourceId: 'source-1' }),
    ];
    const aggregates = aggregateHeliumKeywords(rows);
    expect(aggregates[0].sourceCount).toBe(1);
    expect(aggregates[0].sourceIds).toEqual(['source-1']);
    expect(aggregates[0].competitorCount).toBe(2); // still 2 distinct ASINs within that one file
  });

  it('counts distinct source files a keyword appears in across multiple uploads, deduplicating rows within a source', () => {
    const rows: HeliumRawKeywordRow[] = [
      row({ keyword: 'coconut body butter', competitorAsin: 'A', sourceId: 'source-1' }),
      row({ keyword: 'coconut body butter', competitorAsin: 'A', sourceId: 'source-1' }), // duplicate within source 1
      row({ keyword: 'coconut body butter', competitorAsin: 'C', sourceId: 'source-2' }),
      row({ keyword: 'coconut body butter', competitorAsin: 'D', sourceId: 'source-3' }),
    ];
    const aggregates = aggregateHeliumKeywords(rows);
    expect(aggregates[0].sourceCount).toBe(3);
    expect(aggregates[0].sourceIds.sort()).toEqual(['source-1', 'source-2', 'source-3']);
  });

  it('merges and deduplicates keywords found in different source files into one aggregate', () => {
    const rows: HeliumRawKeywordRow[] = [
      row({ keyword: 'Coconut Body Butter', competitorAsin: 'A', sourceId: 'source-1', searchVolume: 1600 }),
      row({ keyword: 'coconut body butter', competitorAsin: 'B', sourceId: 'source-2', searchVolume: 1700 }),
    ];
    const aggregates = aggregateHeliumKeywords(rows);
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0].maxSearchVolume).toBe(1700);
    expect(aggregates[0].sourceCount).toBe(2);
  });

  it('a keyword only found in one of several loaded sources still has real, non-fabricated evidence for that one source', () => {
    const rows: HeliumRawKeywordRow[] = [
      row({ keyword: 'coconut body butter', sourceId: 'source-1' }),
      row({ keyword: 'rose body butter', sourceId: 'source-2' }), // only in source 2
    ];
    const aggregates = aggregateHeliumKeywords(rows);
    const rose = aggregates.find((a) => a.normalizedKeyword === 'rose body butter')!;
    expect(rose.sourceCount).toBe(1);
    expect(rose.sourceIds).toEqual(['source-2']);
  });
});
