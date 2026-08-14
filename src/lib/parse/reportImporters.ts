import type {
  AdvertisedProductRow, CampaignRow, DateRange, ReportImportMeta, ReportType,
  SearchTermRow, SellerboardKeywordRow, SellerboardProductRow, TargetingRow,
} from '../../types';
import { buildHeaderMap, toNullableNumber, toNumber } from './normalizeHeaders';
import { maxDate, minDate, parseDateRangeValue, parseFilenameDateRange, parseFlexibleDate } from './dateUtils';
import type { RawParsedFile } from './fileParser';

const REQUIRED_FIELDS: Record<ReportType, string[]> = {
  campaign: ['campaign', 'impressions', 'clicks', 'spend'],
  targeting: ['campaign', 'adGroup', 'targetingText', 'impressions', 'clicks', 'spend'],
  searchTerm: ['campaign', 'adGroup', 'searchTerm', 'impressions', 'clicks', 'spend'],
  advertisedProduct: ['campaign', 'adGroup', 'asin', 'impressions', 'clicks', 'spend'],
  sellerboardProduct: ['asin', 'sku'],
  sellerboardKeyword: ['keyword'],
};

const OPTIONAL_FIELDS: Record<ReportType, string[]> = {
  campaign: ['status', 'orders', 'sales', 'budget', 'startDate', 'endDate', 'dateRange'],
  targeting: ['matchType', 'bid', 'status', 'orders', 'sales', 'asin', 'sku', 'startDate', 'endDate', 'dateRange'],
  searchTerm: ['targetingText', 'matchType', 'orders', 'sales', 'asin', 'sku', 'startDate', 'endDate', 'dateRange'],
  advertisedProduct: ['sku', 'orders', 'sales', 'startDate', 'endDate', 'dateRange'],
  sellerboardProduct: ['marketplace', 'date', 'salesOrganic', 'salesPpc', 'salesSponsoredProducts', 'promotions', 'amazonFees', 'cogs', 'refundCost', 'adSpend', 'units', 'orders', 'netProfit'],
  sellerboardKeyword: ['asin', 'sku', 'orders', 'sales', 'spend', 'acos', 'startDate', 'endDate'],
};

export interface ImportResult<T> {
  meta: ReportImportMeta;
  rows: T[];
}

function rowActivityRange(row: Record<string, unknown>, map: Record<string, string>): DateRange | null {
  if (map.dateRange) {
    const r = parseDateRangeValue(row[map.dateRange]);
    if (r) return r;
  }
  if (map.startDate || map.endDate) {
    const s = map.startDate ? parseFlexibleDate(row[map.startDate]) : null;
    const e = map.endDate ? parseFlexibleDate(row[map.endDate]) : null;
    if (s && e) return { start: s, end: e };
    if (s) return { start: s, end: s };
  }
  return null;
}

function computeObservedPeriod(ranges: (DateRange | null)[]): DateRange | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const r of ranges) {
    if (!r) continue;
    start = minDate(start, r.start);
    end = maxDate(end, r.end);
  }
  return start && end ? { start, end } : null;
}

function baseMeta(
  type: ReportType,
  file: { name: string; size: number },
  raw: RawParsedFile,
  map: Record<string, string>,
  observedPeriod: DateRange | null,
): ReportImportMeta {
  const required = REQUIRED_FIELDS[type];
  const missingRequired = required.filter((f) => !(f in map));
  const optional = OPTIONAL_FIELDS[type];
  const missingOptional = optional.filter((f) => !(f in map));
  const filenameRange = parseFilenameDateRange(file.name);

  return {
    id: crypto.randomUUID(),
    type,
    filename: file.name,
    fileSizeBytes: file.size,
    rowCount: raw.rows.length,
    importedAt: new Date().toISOString(),
    requestedPeriod: filenameRange,
    observedPeriod,
    periodConfirmedManually: false,
    status: missingRequired.length > 0 ? 'FORMAT_NOT_RECOGNIZED' : missingOptional.length > 0 ? 'DEGRADED' : 'OK',
    detectedColumns: raw.headers,
    missingRequiredFields: missingRequired,
    missingOptionalFields: missingOptional,
  };
}

export function importCampaignReport(file: { name: string; size: number }, raw: RawParsedFile): ImportResult<CampaignRow> {
  const map = buildHeaderMap(raw.headers);
  const rows: CampaignRow[] = [];
  const ranges: (DateRange | null)[] = [];
  for (const r of raw.rows) {
    const activity = rowActivityRange(r, map);
    ranges.push(activity);
    rows.push({
      campaign: String(r[map.campaign] ?? '').trim(),
      campaignId: map.campaignId ? String(r[map.campaignId] ?? '') : undefined,
      status: map.status ? String(r[map.status] ?? '') : undefined,
      impressions: toNumber(r[map.impressions]),
      clicks: toNumber(r[map.clicks]),
      spend: toNumber(r[map.spend]),
      orders: toNumber(r[map.orders]),
      sales: toNumber(r[map.sales]),
      budget: map.budget ? toNullableNumber(r[map.budget]) ?? undefined : undefined,
      activityStart: activity?.start,
      activityEnd: activity?.end,
    });
  }
  const meta = baseMeta('campaign', file, raw, map, computeObservedPeriod(ranges));
  return { meta, rows: rows.filter((r) => r.campaign) };
}

export function importTargetingReport(file: { name: string; size: number }, raw: RawParsedFile): ImportResult<TargetingRow> {
  const map = buildHeaderMap(raw.headers);
  const rows: TargetingRow[] = [];
  const ranges: (DateRange | null)[] = [];
  for (const r of raw.rows) {
    const activity = rowActivityRange(r, map);
    ranges.push(activity);
    rows.push({
      campaign: String(r[map.campaign] ?? '').trim(),
      adGroup: String(r[map.adGroup] ?? '').trim(),
      targetingText: String(r[map.targetingText] ?? '').trim(),
      matchType: map.matchType ? String(r[map.matchType] ?? '').trim() : 'unknown',
      targetingId: map.targetingId ? String(r[map.targetingId] ?? '') : undefined,
      bid: map.bid ? toNullableNumber(r[map.bid]) : null,
      status: map.status ? String(r[map.status] ?? '') : undefined,
      impressions: toNumber(r[map.impressions]),
      clicks: toNumber(r[map.clicks]),
      spend: toNumber(r[map.spend]),
      orders: toNumber(r[map.orders]),
      sales: toNumber(r[map.sales]),
      asin: map.asin ? String(r[map.asin] ?? '') : undefined,
      sku: map.sku ? String(r[map.sku] ?? '') : undefined,
      activityStart: activity?.start,
      activityEnd: activity?.end,
    });
  }
  const meta = baseMeta('targeting', file, raw, map, computeObservedPeriod(ranges));
  return { meta, rows: rows.filter((r) => r.campaign && r.targetingText) };
}

export function importSearchTermReport(file: { name: string; size: number }, raw: RawParsedFile): ImportResult<SearchTermRow> {
  const map = buildHeaderMap(raw.headers);
  const rows: SearchTermRow[] = [];
  const ranges: (DateRange | null)[] = [];
  for (const r of raw.rows) {
    const activity = rowActivityRange(r, map);
    ranges.push(activity);
    rows.push({
      campaign: String(r[map.campaign] ?? '').trim(),
      adGroup: String(r[map.adGroup] ?? '').trim(),
      searchTerm: String(r[map.searchTerm] ?? '').trim(),
      targetingText: map.targetingText ? String(r[map.targetingText] ?? '').trim() : '',
      matchType: map.matchType ? String(r[map.matchType] ?? '').trim() : 'unknown',
      impressions: toNumber(r[map.impressions]),
      clicks: toNumber(r[map.clicks]),
      spend: toNumber(r[map.spend]),
      orders: toNumber(r[map.orders]),
      sales: toNumber(r[map.sales]),
      asin: map.asin ? String(r[map.asin] ?? '') : undefined,
      sku: map.sku ? String(r[map.sku] ?? '') : undefined,
      activityStart: activity?.start,
      activityEnd: activity?.end,
    });
  }
  const meta = baseMeta('searchTerm', file, raw, map, computeObservedPeriod(ranges));
  return { meta, rows: rows.filter((r) => r.campaign && r.searchTerm) };
}

export function importAdvertisedProductReport(file: { name: string; size: number }, raw: RawParsedFile): ImportResult<AdvertisedProductRow> {
  const map = buildHeaderMap(raw.headers);
  const rows: AdvertisedProductRow[] = [];
  const ranges: (DateRange | null)[] = [];
  for (const r of raw.rows) {
    const activity = rowActivityRange(r, map);
    ranges.push(activity);
    rows.push({
      campaign: String(r[map.campaign] ?? '').trim(),
      adGroup: String(r[map.adGroup] ?? '').trim(),
      asin: String(r[map.asin] ?? '').trim(),
      sku: map.sku ? String(r[map.sku] ?? '') : undefined,
      impressions: toNumber(r[map.impressions]),
      clicks: toNumber(r[map.clicks]),
      spend: toNumber(r[map.spend]),
      orders: toNumber(r[map.orders]),
      sales: toNumber(r[map.sales]),
      activityStart: activity?.start,
      activityEnd: activity?.end,
    });
  }
  const meta = baseMeta('advertisedProduct', file, raw, map, computeObservedPeriod(ranges));
  return { meta, rows: rows.filter((r) => r.campaign && r.asin) };
}

export function importSellerboardProductReport(file: { name: string; size: number }, raw: RawParsedFile): ImportResult<SellerboardProductRow> {
  const map = buildHeaderMap(raw.headers);
  const rows: SellerboardProductRow[] = [];
  const dates: (DateRange | null)[] = [];
  for (const r of raw.rows) {
    const date = map.date ? parseFlexibleDate(r[map.date]) : null;
    if (date) dates.push({ start: date, end: date });
    rows.push({
      date,
      marketplace: map.marketplace ? String(r[map.marketplace] ?? 'UNKNOWN') : 'UNKNOWN',
      asin: String(r[map.asin] ?? '').trim(),
      sku: String(r[map.sku] ?? '').trim(),
      salesOrganic: toNumber(r[map.salesOrganic]),
      salesPpc: toNumber(r[map.salesPpc]),
      salesSponsoredProducts: toNumber(r[map.salesSponsoredProducts]),
      promotions: toNumber(r[map.promotions]),
      amazonFees: toNumber(r[map.amazonFees]),
      cogs: toNumber(r[map.cogs]),
      refundCost: toNumber(r[map.refundCost]),
      adSpend: toNumber(r[map.adSpend]),
      units: toNumber(r[map.units]),
      orders: toNumber(r[map.orders]),
      netProfit: map.netProfit ? toNullableNumber(r[map.netProfit]) : null,
    });
  }
  const filenameRange = parseFilenameDateRange(file.name);
  const observed = filenameRange ?? computeObservedPeriod(dates);
  const meta = baseMeta('sellerboardProduct', file, raw, map, observed);
  return { meta, rows: rows.filter((r) => r.asin || r.sku) };
}

export function importSellerboardKeywordReport(file: { name: string; size: number }, raw: RawParsedFile): ImportResult<SellerboardKeywordRow> {
  const map = buildHeaderMap(raw.headers);
  const rows: SellerboardKeywordRow[] = [];
  const ranges: (DateRange | null)[] = [];
  for (const r of raw.rows) {
    const activity = rowActivityRange(r, map);
    ranges.push(activity);
    rows.push({
      keyword: String(r[map.keyword] ?? '').trim(),
      asin: map.asin ? String(r[map.asin] ?? '') : undefined,
      sku: map.sku ? String(r[map.sku] ?? '') : undefined,
      orders: toNumber(r[map.orders]),
      sales: toNumber(r[map.sales]),
      spend: toNumber(r[map.spend]),
      acos: map.acos ? toNullableNumber(r[map.acos]) : null,
      activityStart: activity?.start,
      activityEnd: activity?.end,
    });
  }
  const filenameRange = parseFilenameDateRange(file.name);
  const meta = baseMeta('sellerboardKeyword', file, raw, map, filenameRange ?? computeObservedPeriod(ranges));
  return { meta, rows: rows.filter((r) => r.keyword) };
}
