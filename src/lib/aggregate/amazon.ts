import type {
  AdvertisedProductRow, CampaignRow, CampaignStatusConfidence, DateRange, EnrichedCampaign, EnrichedSearchTerm,
  EnrichedTarget, MappingSource, SearchTermRow, TargetingRow,
} from '../../types';
import { computeAcos, computeCpc, computeCtr, computeCvr } from '../engine/metrics';
import { daysBetween } from '../parse/dateUtils';
import type { MappingIndexes } from './mapping';
import { resolveProductMapping } from './mapping';

function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return !(a.end < b.start || a.start > b.end);
}

// Determines whether a row's activity is within the app's established
// current period. Returns null when we simply don't know (no date evidence),
// which must never be silently treated as "current". A row whose date range
// is materially wider than the current period (e.g. a 30-day cumulative
// search-term export that merely overlaps the tail of a 4-day current
// window) is historical, not current — overlap alone is not enough
// (failure mode #7: historical rows mistaken for currently active).
export function classifyPeriod(
  rowRange: DateRange | null | undefined,
  reportRange: DateRange | null,
  currentPeriod: DateRange | null,
): boolean | null {
  if (!currentPeriod) return null;
  const effective = rowRange ?? reportRange;
  if (!effective) return null;

  const rowDuration = daysBetween(effective.start, effective.end) + 1;
  const currentDuration = daysBetween(currentPeriod.start, currentPeriod.end) + 1;
  if (rowDuration > currentDuration * 1.5 && rowDuration > currentDuration + 3) {
    return false;
  }

  return rangesOverlap(effective, currentPeriod);
}

export type BaseEnrichedTarget = Omit<EnrichedTarget, 'action'> & { mappingConfident: boolean };

export function buildBaseTargets(
  rows: TargetingRow[],
  mappingIdx: MappingIndexes,
  reportRange: DateRange | null,
  currentPeriod: DateRange | null,
): BaseEnrichedTarget[] {
  return rows.map((r) => {
    const mapping = resolveProductMapping({ asin: r.asin, sku: r.sku, campaign: r.campaign, adGroup: r.adGroup }, mappingIdx);
    const product = mappingIdx.products.find((p) => p.id === mapping.productId) ?? null;
    const rowRange: DateRange | null = r.activityStart && r.activityEnd ? { start: r.activityStart, end: r.activityEnd } : null;
    const isCurrent = classifyPeriod(rowRange, reportRange, currentPeriod);
    return {
      key: `${r.campaign}|${r.adGroup}|${r.targetingText}|${r.matchType}`,
      targetingText: r.targetingText,
      matchType: r.matchType,
      campaign: r.campaign,
      adGroup: r.adGroup,
      productId: mapping.confident ? mapping.productId : mapping.productId, // productId kept even at low confidence for display; economics engine gates on confidence
      productName: product?.name ?? null,
      asin: product?.asin ?? r.asin ?? null,
      mappingSource: mapping.source,
      currentBid: r.bid,
      impressions: r.impressions,
      clicks: r.clicks,
      spend: r.spend,
      orders: r.orders,
      sales: r.sales,
      ctr: computeCtr(r.clicks, r.impressions),
      cvr: computeCvr(r.orders, r.clicks),
      acos: computeAcos(r.spend, r.sales),
      delivery: 'NO_DELIVERY', // filled in by delivery engine
      isCurrentPeriod: isCurrent === true,
      mappingConfident: mapping.confident,
    };
  });
}

export function buildEnrichedCampaigns(
  campaignRows: CampaignRow[],
  mappingIdx: MappingIndexes,
  reportRange: DateRange | null,
  currentPeriod: DateRange | null,
): Omit<EnrichedCampaign, 'recommendation' | 'risk' | 'confidence'>[] {
  return campaignRows.map((r) => {
    const mapping = resolveProductMapping({ campaign: r.campaign }, mappingIdx);
    const product = mappingIdx.products.find((p) => p.id === mapping.productId) ?? null;
    const rowRange: DateRange | null = r.activityStart && r.activityEnd ? { start: r.activityStart, end: r.activityEnd } : null;
    const isCurrent = classifyPeriod(rowRange, reportRange, currentPeriod);
    const statusConfidence: CampaignStatusConfidence =
      isCurrent === true ? 'CURRENT_ACTIVITY_CONFIRMED' : isCurrent === false ? 'HISTORICAL_ONLY' : 'CURRENT_STATUS_UNKNOWN';
    return {
      campaign: r.campaign,
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      statusConfidence,
      impressions: r.impressions,
      clicks: r.clicks,
      spend: r.spend,
      orders: r.orders,
      sales: r.sales,
      acos: computeAcos(r.spend, r.sales),
      ctr: computeCtr(r.clicks, r.impressions),
      cpc: computeCpc(r.spend, r.clicks),
      cvr: computeCvr(r.orders, r.clicks),
      budget: r.budget ?? null,
      isCurrentPeriod: isCurrent === true,
    };
  });
}

export interface HistoricalRates {
  hasSearchTermHistory: boolean;
}

export function buildBaseSearchTerms(
  rows: SearchTermRow[],
  mappingIdx: MappingIndexes,
  reportRange: DateRange | null,
  currentPeriod: DateRange | null,
): Omit<EnrichedSearchTerm, 'classification'>[] {
  return rows.map((r) => {
    const mapping = resolveProductMapping({ asin: r.asin, sku: r.sku, campaign: r.campaign, adGroup: r.adGroup }, mappingIdx);
    const product = mappingIdx.products.find((p) => p.id === mapping.productId) ?? null;
    const rowRange: DateRange | null = r.activityStart && r.activityEnd ? { start: r.activityStart, end: r.activityEnd } : null;
    const isCurrent = classifyPeriod(rowRange, reportRange, currentPeriod);
    return {
      searchTerm: r.searchTerm,
      targetingText: r.targetingText || r.searchTerm,
      matchType: r.matchType,
      campaign: r.campaign,
      adGroup: r.adGroup,
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      impressions: r.impressions,
      clicks: r.clicks,
      spend: r.spend,
      orders: r.orders,
      sales: r.sales,
      acos: computeAcos(r.spend, r.sales),
      isCurrentPeriod: isCurrent === true,
    };
  });
}

export function buildAdvertisedProductIndexAsinBySku(rows: AdvertisedProductRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (r.sku && r.asin) m.set(r.sku, r.asin);
  return m;
}

export const MAPPING_SOURCE_ORDER: MappingSource[] = [
  'ASIN', 'SKU', 'ADVERTISED_PRODUCT_REPORT', 'SAVED_AD_GROUP_MAPPING', 'EXPLICIT_ALIAS', 'NAME_INFERENCE', 'UNMAPPED',
];
