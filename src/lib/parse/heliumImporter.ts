// Helium 10 / Cerebro keyword export parser. Fully self-contained — it
// reuses normalizeHeaderKey/toNullableNumber (the same tolerant, punctuation
// and case-insensitive matching used by the Amazon/Sellerboard parsers) but
// keeps its own alias table, entirely separate from FIELD_ALIASES in
// normalizeHeaders.ts. This is deliberate: Helium column names (e.g. "ASIN",
// "Position") could otherwise collide with unrelated Amazon/Sellerboard
// canonical fields if merged into the same shared alias table.
import type { RawParsedFile } from './fileParser';
import type { HeliumImportMeta, HeliumRawKeywordRow } from '../../types/helium';
import { normalizeHeaderKey, toNullableNumber } from './normalizeHeaders';

type HeliumField =
  | 'keyword' | 'searchVolume' | 'organicRank' | 'sponsoredRank' | 'rank' | 'competingProducts'
  | 'titleDensity' | 'cerebroIqScore' | 'cpr' | 'suggestedBid' | 'keywordSales' | 'searchVolumeTrend' | 'competitorAsin';

// Aliases are plain lowercase words/phrases — normalizeHeaderKey() is applied
// to both sides before comparison, so exact pre-normalized spacing here
// doesn't matter as long as it matches what normalizeHeaderKey would produce.
const HELIUM_FIELD_ALIASES: Record<HeliumField, string[]> = {
  keyword: ['keyword phrase', 'keyword', 'search term', 'phrase'],
  searchVolume: ['search volume', 'exact search volume', 'monthly search volume', 'search vol', 'broad search volume'],
  organicRank: ['organic rank', 'rank organic', 'organic position', 'position organic'],
  sponsoredRank: ['sponsored rank', 'ppc rank', 'sponsored position', 'position sponsored', 'ad rank'],
  // Generic single-rank column fallback, used only when no explicit organic
  // rank column exists at all (see resolution below).
  rank: ['position', 'rank'],
  competingProducts: ['competing products', 'products'],
  titleDensity: ['title density'],
  cerebroIqScore: ['cerebro iq score', 'cerebro iq', 'iq score'],
  cpr: ['cpr', 'cerebro cpr', 'competitor performance rank'],
  suggestedBid: ['suggested ppc bid', 'suggested bid', 'ppc bid', 'suggested cpc', 'sponsored abid'],
  keywordSales: ['keyword sales', 'estimated sales'],
  searchVolumeTrend: ['search volume trend', 'trend'],
  competitorAsin: ['competitor asin', 'asin'],
};

const REVERSE = new Map<string, HeliumField>();
for (const [canonical, aliases] of Object.entries(HELIUM_FIELD_ALIASES) as [HeliumField, string[]][]) {
  for (const alias of aliases) REVERSE.set(normalizeHeaderKey(alias), canonical);
}

function resolveHeliumField(rawHeader: string): HeliumField | null {
  return REVERSE.get(normalizeHeaderKey(rawHeader)) ?? null;
}

function buildHeliumHeaderMap(rawHeaders: string[]): Partial<Record<HeliumField, string>> {
  const map: Partial<Record<HeliumField, string>> = {};
  for (const raw of rawHeaders) {
    const canonical = resolveHeliumField(raw);
    if (canonical && !(canonical in map)) map[canonical] = raw;
  }
  return map;
}

// Optional fields that "missingOptionalFields" reports on when the file has
// no matching column at all. "rank" is a fallback alias for organicRank, not
// a field of its own, so it's excluded here.
const OPTIONAL_FIELDS: HeliumField[] = [
  'searchVolume', 'organicRank', 'sponsoredRank', 'competingProducts', 'titleDensity',
  'cerebroIqScore', 'cpr', 'suggestedBid', 'keywordSales', 'searchVolumeTrend', 'competitorAsin',
];

export interface HeliumImportResult {
  meta: HeliumImportMeta;
  rows: HeliumRawKeywordRow[];
}

export function importHeliumKeywordFile(file: { name: string; size: number }, raw: RawParsedFile): HeliumImportResult {
  const map = buildHeliumHeaderMap(raw.headers);
  const baseMeta = {
    id: crypto.randomUUID(),
    filename: file.name,
    fileSizeBytes: file.size,
    importedAt: new Date().toISOString(),
    detectedColumns: raw.headers,
  };

  if (!map.keyword) {
    return {
      meta: {
        ...baseMeta,
        rowCount: 0,
        status: 'FORMAT_NOT_RECOGNIZED',
        missingRequiredFields: ['keyword'],
        missingOptionalFields: [],
      },
      rows: [],
    };
  }

  const rows: HeliumRawKeywordRow[] = [];
  for (const r of raw.rows) {
    const keyword = String(r[map.keyword] ?? '').trim();
    if (!keyword) continue; // never fabricate a keyword for a blank row
    const organicRank = map.organicRank ? toNullableNumber(r[map.organicRank]) : map.rank ? toNullableNumber(r[map.rank]) : null;
    rows.push({
      keyword,
      searchVolume: map.searchVolume ? toNullableNumber(r[map.searchVolume]) : null,
      organicRank,
      sponsoredRank: map.sponsoredRank ? toNullableNumber(r[map.sponsoredRank]) : null,
      competingProducts: map.competingProducts ? toNullableNumber(r[map.competingProducts]) : null,
      titleDensity: map.titleDensity ? toNullableNumber(r[map.titleDensity]) : null,
      cerebroIqScore: map.cerebroIqScore ? toNullableNumber(r[map.cerebroIqScore]) : null,
      cpr: map.cpr ? toNullableNumber(r[map.cpr]) : null,
      suggestedBid: map.suggestedBid ? toNullableNumber(r[map.suggestedBid]) : null,
      keywordSales: map.keywordSales ? toNullableNumber(r[map.keywordSales]) : null,
      searchVolumeTrend: map.searchVolumeTrend ? toNullableNumber(r[map.searchVolumeTrend]) : null,
      competitorAsin: map.competitorAsin ? (String(r[map.competitorAsin] ?? '').trim() || null) : null,
      sourceId: baseMeta.id,
    });
  }

  const missingOptionalFields = OPTIONAL_FIELDS.filter((f) => !map[f]);

  return {
    meta: {
      ...baseMeta,
      rowCount: rows.length,
      status: missingOptionalFields.length > 0 ? 'DEGRADED' : 'OK',
      missingRequiredFields: [],
      missingOptionalFields,
    },
    rows,
  };
}
