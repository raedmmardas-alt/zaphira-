import type {
  AccountNetProfitEntry, DateRange, EnrichedCampaign, EnrichedSearchTerm, EnrichedTarget, Product, ProductEconomics,
  ProductStrategyResult, ReconciliationCheck, ReportImportMeta, ReportType, SavedAdGroupMapping, Settings,
} from '../types';
import type { ReportRowsByType } from './store';
import { aggregateSellerboardProducts } from '../lib/aggregate/sellerboard';
import { buildAdvertisedProductIndex } from '../lib/aggregate/mapping';
import type { MappingIndexes } from '../lib/aggregate/mapping';
import { resolveProductMapping } from '../lib/aggregate/mapping';
import { buildBaseSearchTerms, buildBaseTargets, buildEnrichedCampaigns } from '../lib/aggregate/amazon';
import { computeAlignment, combineObserved, periodKey, type AlignmentResult } from '../lib/parse/periodEngine';
import { classifyDelivery } from '../lib/engine/delivery';
import { decideTargetAction } from '../lib/engine/targetActions';
import { decideCampaignRecommendation } from '../lib/engine/campaignRecommendation';
import { decorateSearchTerms } from '../lib/engine/searchTerms';
import { classifyProductStrategy } from '../lib/engine/strategy';
import {
  runReconciliation, deriveDashboardReconciliationStatus,
  type ReconciliationInputs, type DashboardReconciliationStatus,
} from '../lib/aggregate/reconciliation';

export interface Kpis {
  impressions: number;
  clicks: number;
  attributedSales: number;
  ppcSpend: number;
  orders: number;
  acos: number | null;
  productProfit: number | null;
  accountNetProfit: number | null;
}

export interface Workspace {
  currentPeriod: DateRange | null;
  alignment: AlignmentResult;
  // rawInputs: the exact five values actually supplied to runReconciliation()
  // this render — surfaced for the Dashboard diagnostics panel so the live
  // runtime numbers can be inspected directly, instead of inferred from
  // uploaded-file summaries. Not used by any reconciliation logic itself.
  // status: the ONE authoritative source for the Dashboard "Data
  // reconciliation" badge — see deriveDashboardReconciliationStatus for the
  // exact, isolated rule. Never combined with report-quality/DEGRADED,
  // period-alignment, mapping, or delivery status.
  reconciliation: { checks: ReconciliationCheck[]; status: DashboardReconciliationStatus; rawInputs: ReconciliationInputs };
  economics: ProductEconomics[];
  economicsById: Record<string, ProductEconomics>;
  strategies: ProductStrategyResult[];
  targets: EnrichedTarget[];
  campaigns: EnrichedCampaign[];
  searchTerms: EnrichedSearchTerm[];
  accountNetProfitEntry: AccountNetProfitEntry | null;
  kpis: Kpis;
}

type ReportMetaMap = Partial<Record<ReportType, ReportImportMeta>>;

function reportPeriod(meta: ReportImportMeta | undefined): DateRange | null {
  if (!meta) return null;
  return meta.requestedPeriod ?? meta.observedPeriod;
}

function getCurrentPeriod(reportMeta: ReportMetaMap): DateRange | null {
  let period: DateRange | null = null;
  for (const type of ['campaign', 'targeting', 'advertisedProduct'] as ReportType[]) {
    const p = reportPeriod(reportMeta[type]);
    if (p) period = combineObserved(period, p);
  }
  return period;
}

export function buildWorkspace(
  reportMeta: ReportMetaMap,
  reportRows: ReportRowsByType,
  products: Product[],
  savedAdGroupMappings: SavedAdGroupMapping[],
  settings: Settings,
  accountNetProfitByPeriod: Record<string, AccountNetProfitEntry>,
): Workspace {
  const currentPeriod = getCurrentPeriod(reportMeta);
  const alignment = computeAlignment(Object.values(reportMeta).filter((m): m is NonNullable<typeof m> => !!m));

  const advertisedProductIndex = buildAdvertisedProductIndex(reportRows.advertisedProduct);
  const mappingIdx: MappingIndexes = { products, advertisedProductIndex, savedMappings: savedAdGroupMappings };

  // --- Product economics (Sellerboard) ---
  const rawEconomics = aggregateSellerboardProducts(reportRows.sellerboardProduct);
  const economics: ProductEconomics[] = rawEconomics.map((e) => {
    const mapping = resolveProductMapping({ asin: e.asin, sku: e.sku, campaign: '' }, mappingIdx);
    return { ...e, productId: mapping.confident ? mapping.productId : null };
  });
  const economicsById: Record<string, ProductEconomics> = {};
  for (const e of economics) if (e.productId) economicsById[e.productId] = e;

  const strategies = economics.map((e) => classifyProductStrategy(e));

  // --- Targets (Keywords/Targeting) ---
  const targetingMeta = reportMeta.targeting;
  const targetingRange = reportPeriod(targetingMeta);
  const baseTargets = buildBaseTargets(reportRows.targeting, mappingIdx, targetingRange, currentPeriod);
  const targets: EnrichedTarget[] = baseTargets.map((t) => {
    const delivery = classifyDelivery(t.impressions, t.clicks, settings.deliveryThresholds);
    const econ = t.productId ? economicsById[t.productId] ?? null : null;
    const action = decideTargetAction({
      clicks: t.clicks,
      orders: t.orders,
      spend: t.spend,
      sales: t.sales,
      acos: t.acos,
      currentBid: t.currentBid,
      mappingConfident: t.mappingConfident,
      productId: t.productId,
      productEconomics: econ,
      settings,
    });
    const { mappingConfident: _mc, ...rest } = t;
    void _mc;
    return { ...rest, delivery, action };
  });

  // --- Campaigns ---
  const campaignMeta = reportMeta.campaign;
  const campaignRange = reportPeriod(campaignMeta);
  const baseCampaigns = buildEnrichedCampaigns(reportRows.campaign, mappingIdx, campaignRange, currentPeriod);
  const campaigns: EnrichedCampaign[] = baseCampaigns.map((c) => {
    const econ = c.productId ? economicsById[c.productId] ?? null : null;
    const rec = decideCampaignRecommendation({
      productId: c.productId,
      isCurrentPeriod: c.isCurrentPeriod,
      spend: c.spend,
      acos: c.acos,
      economics: econ,
      stopLossSpend: settings.stopLossSpend,
    });
    return { ...c, ...rec };
  });

  // --- Search terms ---
  const searchTermMeta = reportMeta.searchTerm;
  const searchTermRange = reportPeriod(searchTermMeta);
  const baseSearchTerms = buildBaseSearchTerms(reportRows.searchTerm, mappingIdx, searchTermRange, currentPeriod);
  const searchTerms = decorateSearchTerms(baseSearchTerms);

  // --- Reconciliation ---
  const sumSpend = (rows: { spend: number }[]) => (rows.length > 0 ? rows.reduce((a, r) => a + r.spend, 0) : null);
  const reconciliationInputs: ReconciliationInputs = {
    campaignSpend: sumSpend(reportRows.campaign),
    targetingSpend: sumSpend(reportRows.targeting),
    searchTermSpend: sumSpend(reportRows.searchTerm),
    advertisedProductSpend: reportRows.advertisedProduct.length > 0 ? sumSpend(reportRows.advertisedProduct) : null,
    sellerboardPpcSpend: economics.length > 0 ? economics.reduce((a, e) => a + e.ppcSpend, 0) : null,
  };
  const checks = runReconciliation(reconciliationInputs);

  // --- Account net profit (period-scoped, never carried over) ---
  const accountNetProfitEntry = currentPeriod ? accountNetProfitByPeriod[periodKey(currentPeriod)] ?? null : null;

  // --- KPIs ---
  // Traffic + spend/sales/orders KPIs all come from the same source (current-
  // period Campaign report rows), so Impressions/Clicks/CTR/CPC stay
  // consistent with PPC Spend/Orders/Attributed Sales rather than mixing in
  // a different report's totals.
  const currentCampaigns = campaigns.filter((c) => c.isCurrentPeriod);
  const impressions = currentCampaigns.reduce((a, c) => a + c.impressions, 0);
  const clicks = currentCampaigns.reduce((a, c) => a + c.clicks, 0);
  const attributedSales = currentCampaigns.reduce((a, c) => a + c.sales, 0);
  const ppcSpend = currentCampaigns.reduce((a, c) => a + c.spend, 0);
  const orders = currentCampaigns.reduce((a, c) => a + c.orders, 0);
  const acos = attributedSales > 0 ? ppcSpend / attributedSales : null;
  const productProfit = economics.length > 0 ? economics.reduce((a, e) => a + e.netProfit, 0) : null;

  return {
    currentPeriod,
    alignment,
    reconciliation: { checks, status: deriveDashboardReconciliationStatus(checks, reconciliationInputs), rawInputs: reconciliationInputs },
    economics,
    economicsById,
    strategies,
    targets,
    campaigns,
    searchTerms,
    accountNetProfitEntry,
    kpis: {
      impressions, clicks, attributedSales, ppcSpend, orders, acos, productProfit,
      accountNetProfit: accountNetProfitEntry?.accountNetProfit ?? null,
    },
  };
}
