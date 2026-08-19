// Deduplicates raw Helium 10 / Cerebro rows (one row per keyword per
// competitor ASIN) into one aggregate per normalized keyword, combining
// competitor evidence instead of creating duplicate rows.
import type { HeliumKeywordAggregate, HeliumRawKeywordRow } from '../../types/helium';

export function normalizeKeywordText(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function nonNull(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null);
}

export function aggregateHeliumKeywords(rows: HeliumRawKeywordRow[]): HeliumKeywordAggregate[] {
  const groups = new Map<string, HeliumRawKeywordRow[]>();
  for (const row of rows) {
    const key = normalizeKeywordText(row.keyword);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const result: HeliumKeywordAggregate[] = [];
  for (const [normalizedKeyword, groupRows] of groups) {
    // Distinct competitor ASINs, so an accidental duplicate row for the same
    // ASIN is never double-counted. When the export has no ASIN column at
    // all, we can't distinguish sources — treat the keyword as having at
    // least one competitor context rather than zero.
    const asinSet = new Set(groupRows.map((r) => r.competitorAsin).filter((a): a is string => !!a));
    const competitorAsins = Array.from(asinSet);
    const competitorCount = competitorAsins.length > 0 ? competitorAsins.length : (groupRows.length > 0 ? 1 : 0);

    const organicRanks = nonNull(groupRows.map((r) => r.organicRank));
    const sponsoredRanks = nonNull(groupRows.map((r) => r.sponsoredRank));
    const searchVolumes = nonNull(groupRows.map((r) => r.searchVolume));
    const titleDensities = nonNull(groupRows.map((r) => r.titleDensity));
    const competingProducts = nonNull(groupRows.map((r) => r.competingProducts));
    const suggestedBids = nonNull(groupRows.map((r) => r.suggestedBid));
    const searchVolumeTrends = nonNull(groupRows.map((r) => r.searchVolumeTrend));

    result.push({
      keyword: groupRows[0].keyword,
      normalizedKeyword,
      competitorCount,
      competitorAsins,
      bestOrganicRank: organicRanks.length > 0 ? Math.min(...organicRanks) : null,
      bestSponsoredRank: sponsoredRanks.length > 0 ? Math.min(...sponsoredRanks) : null,
      medianOrganicRank: median(organicRanks),
      maxSearchVolume: searchVolumes.length > 0 ? Math.max(...searchVolumes) : null,
      titleDensity: titleDensities.length > 0 ? Math.max(...titleDensities) : null,
      competingProducts: competingProducts.length > 0 ? Math.max(...competingProducts) : null,
      suggestedBid: median(suggestedBids),
      searchVolumeTrend: searchVolumeTrends.length > 0 ? searchVolumeTrends[0] : null,
    });
  }

  return result;
}
