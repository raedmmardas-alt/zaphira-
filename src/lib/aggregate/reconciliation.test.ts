import { describe, it, expect } from 'vitest';
import { runReconciliation, worstStatus, deriveDashboardReconciliationStatus, reconcileCampaignSources, reconcileTargetingSources } from './reconciliation';
import type { ReconciliationInputs } from './reconciliation';
import { importCampaignReport, importSellerboardProductReport } from '../parse/reportImporters';
import { aggregateSellerboardProducts } from './sellerboard';
import type { RawParsedFile } from '../parse/fileParser';

describe('runReconciliation — Sellerboard PPC spend sign normalization', () => {
  it('reconciles +23.88 Amazon Ads spend against -23.88 Sellerboard PPC expense as a MATCH (magnitude, not sign)', () => {
    const checks = runReconciliation({
      campaignSpend: 23.88,
      targetingSpend: 23.88,
      searchTermSpend: 23.88,
      advertisedProductSpend: null,
      sellerboardPpcSpend: -23.88,
    });
    const sellerboardCheck = checks.find((c) => c.label === 'Campaign spend vs Sellerboard PPC spend');
    expect(sellerboardCheck).toBeDefined();
    expect(sellerboardCheck!.status).toBe('DATA_RECONCILED');
    expect(sellerboardCheck!.diffPct).toBe(0);
    expect(worstStatus(checks)).toBe('DATA_RECONCILED');
  });

  it('still reconciles when Sellerboard reports the expense as positive (some exports do) — sign must never matter either way', () => {
    const checks = runReconciliation({
      campaignSpend: 23.88,
      targetingSpend: 23.88,
      searchTermSpend: 23.88,
      advertisedProductSpend: null,
      sellerboardPpcSpend: 23.88,
    });
    const sellerboardCheck = checks.find((c) => c.label === 'Campaign spend vs Sellerboard PPC spend');
    expect(sellerboardCheck!.status).toBe('DATA_RECONCILED');
  });

  it('still flags a genuine numerical mismatch as DATA_MISMATCH_REVIEW_REQUIRED, even with a negative Sellerboard figure', () => {
    const checks = runReconciliation({
      campaignSpend: 23.88,
      targetingSpend: 23.88,
      searchTermSpend: 23.88,
      advertisedProductSpend: null,
      sellerboardPpcSpend: -10.00, // genuinely different magnitude, not just sign
    });
    const sellerboardCheck = checks.find((c) => c.label === 'Campaign spend vs Sellerboard PPC spend');
    expect(sellerboardCheck!.status).toBe('DATA_MISMATCH_REVIEW_REQUIRED');
    expect(worstStatus(checks)).toBe('DATA_MISMATCH_REVIEW_REQUIRED');
  });

  it('never applies sign normalization to the Amazon-native checks (Campaign/Targeting/Search Term/Advertised Product), which are unaffected by this fix', () => {
    const checks = runReconciliation({
      campaignSpend: 23.88,
      targetingSpend: 10.00, // genuine mismatch between two always-positive Amazon reports
      searchTermSpend: 23.88,
      advertisedProductSpend: null,
      sellerboardPpcSpend: null,
    });
    const campaignVsTargeting = checks.find((c) => c.label === 'Campaign spend vs Targeting spend');
    expect(campaignVsTargeting!.status).toBe('DATA_MISMATCH_REVIEW_REQUIRED');
  });

  it('does not include a Sellerboard check at all when no Sellerboard data was imported', () => {
    const checks = runReconciliation({
      campaignSpend: 23.88,
      targetingSpend: 23.88,
      searchTermSpend: 23.88,
      advertisedProductSpend: null,
      sellerboardPpcSpend: null,
    });
    expect(checks.find((c) => c.label === 'Campaign spend vs Sellerboard PPC spend')).toBeUndefined();
  });
});

describe('reconcileCampaignSources — Amazon API vs manual Campaign CSV, same period', () => {
  it('reports DATA_RECONCILED when both sources agree closely', () => {
    const checks = reconcileCampaignSources(
      { spend: 16.48, sales: 0, orders: 0, clicks: 12 },
      { spend: 16.50, sales: 0, orders: 0, clicks: 12 },
    );
    expect(worstStatus(checks)).toBe('DATA_RECONCILED');
  });

  it('reports SMALL_ATTRIBUTION_DIFFERENCE for a moderate gap (reuses the same 5%/15% thresholds as every other reconciliation pair)', () => {
    const checks = reconcileCampaignSources(
      { spend: 100, sales: 0, orders: 0, clicks: 10 },
      { spend: 108, sales: 0, orders: 0, clicks: 10 }, // 8% diff -> small, not a mismatch
    );
    expect(worstStatus(checks)).toBe('SMALL_ATTRIBUTION_DIFFERENCE');
  });

  it('reports DATA_MISMATCH_REVIEW_REQUIRED for a large gap and never silently picks a source', () => {
    const checks = reconcileCampaignSources(
      { spend: 100, sales: 500, orders: 20, clicks: 50 },
      { spend: 40, sales: 500, orders: 20, clicks: 50 }, // 60% spend gap
    );
    expect(worstStatus(checks)).toBe('DATA_MISMATCH_REVIEW_REQUIRED');
    const spendCheck = checks.find((c) => c.label.startsWith('Spend'));
    expect(spendCheck?.a).toBe(40); // api value preserved, not overwritten
    expect(spendCheck?.b).toBe(100); // manual value preserved, not overwritten
  });

  it('the exact reference scenario from Phase 2A (Aug 9-12): zero-sales, zero-orders reconciles cleanly when spend matches', () => {
    const checks = reconcileCampaignSources(
      { spend: 16.48, sales: 0, orders: 0, clicks: 20 },
      { spend: 16.48, sales: 0, orders: 0, clicks: 20 },
    );
    expect(worstStatus(checks)).toBe('DATA_RECONCILED');
    expect(checks.every((c) => c.status === 'DATA_RECONCILED')).toBe(true);
  });

  it('compares clicks and orders too, not only spend and sales', () => {
    const checks = reconcileCampaignSources(
      { spend: 50, sales: 200, orders: 10, clicks: 100 },
      { spend: 50, sales: 200, orders: 2, clicks: 100 }, // orders wildly off
    );
    const ordersCheck = checks.find((c) => c.label.startsWith('Orders'));
    expect(ordersCheck?.status).toBe('DATA_MISMATCH_REVIEW_REQUIRED');
  });
});

describe('reconcileTargetingSources — Amazon API vs manual Targeting CSV, same period', () => {
  it('reports DATA_RECONCILED when both sources agree closely', () => {
    const checks = reconcileTargetingSources(
      { spend: 12.4, sales: 39.98, orders: 2, clicks: 18 },
      { spend: 12.5, sales: 39.98, orders: 2, clicks: 18 },
    );
    expect(worstStatus(checks)).toBe('DATA_RECONCILED');
  });

  it('reports SMALL_ATTRIBUTION_DIFFERENCE for a moderate gap (reuses the same 5%/15% thresholds)', () => {
    const checks = reconcileTargetingSources(
      { spend: 100, sales: 0, orders: 0, clicks: 10 },
      { spend: 108, sales: 0, orders: 0, clicks: 10 }, // 8% diff -> small, not a mismatch
    );
    expect(worstStatus(checks)).toBe('SMALL_ATTRIBUTION_DIFFERENCE');
  });

  it('reports DATA_MISMATCH_REVIEW_REQUIRED for a large gap and never silently picks a source', () => {
    const checks = reconcileTargetingSources(
      { spend: 100, sales: 500, orders: 20, clicks: 50 },
      { spend: 40, sales: 500, orders: 20, clicks: 50 }, // 60% spend gap
    );
    expect(worstStatus(checks)).toBe('DATA_MISMATCH_REVIEW_REQUIRED');
    const spendCheck = checks.find((c) => c.label.startsWith('Spend'));
    expect(spendCheck?.a).toBe(40); // api value preserved, not overwritten
    expect(spendCheck?.b).toBe(100); // manual value preserved, not overwritten
  });

  it('zero-sales, zero-orders reconciles cleanly when the other metrics match', () => {
    const checks = reconcileTargetingSources(
      { spend: 2.1, sales: 0, orders: 0, clicks: 4 },
      { spend: 2.1, sales: 0, orders: 0, clicks: 4 },
    );
    expect(worstStatus(checks)).toBe('DATA_RECONCILED');
    expect(checks.every((c) => c.status === 'DATA_RECONCILED')).toBe(true);
  });

  it('compares clicks and orders too, not only spend and sales', () => {
    const checks = reconcileTargetingSources(
      { spend: 50, sales: 200, orders: 10, clicks: 100 },
      { spend: 50, sales: 200, orders: 2, clicks: 100 }, // orders wildly off
    );
    const ordersCheck = checks.find((c) => c.label.startsWith('Orders'));
    expect(ordersCheck?.status).toBe('DATA_MISMATCH_REVIEW_REQUIRED');
  });
});

describe('deriveDashboardReconciliationStatus — the Dashboard badge\'s single authoritative source', () => {
  const reconciledInputs: ReconciliationInputs = {
    campaignSpend: 23.88, targetingSpend: 23.88, searchTermSpend: 23.88, advertisedProductSpend: 23.88, sellerboardPpcSpend: -23.88,
  };

  it('returns DATA_RECONCILED when every check the exact real scenario produces is reconciled', () => {
    const checks = runReconciliation(reconciledInputs);
    expect(deriveDashboardReconciliationStatus(checks, reconciledInputs)).toBe('DATA_RECONCILED');
  });

  it('returns DATA_MISMATCH_REVIEW_REQUIRED when at least one check genuinely mismatches (the hasMismatch rule)', () => {
    const inputs: ReconciliationInputs = { ...reconciledInputs, searchTermSpend: 5.00 };
    const checks = runReconciliation(inputs);
    expect(checks.some((c) => c.status === 'DATA_MISMATCH_REVIEW_REQUIRED')).toBe(true);
    expect(deriveDashboardReconciliationStatus(checks, inputs)).toBe('DATA_MISMATCH_REVIEW_REQUIRED');
  });

  it('returns INSUFFICIENT_DATA when the Campaign report is missing, never a falsely reassuring DATA_RECONCILED', () => {
    const inputs: ReconciliationInputs = { ...reconciledInputs, campaignSpend: null };
    const checks = runReconciliation(inputs);
    expect(deriveDashboardReconciliationStatus(checks, inputs)).toBe('INSUFFICIENT_DATA');
  });

  it('returns INSUFFICIENT_DATA when the Targeting report is missing', () => {
    const inputs: ReconciliationInputs = { ...reconciledInputs, targetingSpend: null };
    const checks = runReconciliation(inputs);
    expect(deriveDashboardReconciliationStatus(checks, inputs)).toBe('INSUFFICIENT_DATA');
  });

  it('treats a SMALL_ATTRIBUTION_DIFFERENCE-only result as DATA_RECONCILED for this badge (not blocking, unlike a genuine mismatch)', () => {
    // ~10% off — inside the SMALL_ATTRIBUTION_DIFFERENCE band (5%-15%), not a DATA_MISMATCH.
    const inputs: ReconciliationInputs = { ...reconciledInputs, searchTermSpend: 21.5 };
    const checks = runReconciliation(inputs);
    expect(checks.some((c) => c.status === 'SMALL_ATTRIBUTION_DIFFERENCE')).toBe(true);
    expect(checks.some((c) => c.status === 'DATA_MISMATCH_REVIEW_REQUIRED')).toBe(false);
    expect(deriveDashboardReconciliationStatus(checks, inputs)).toBe('DATA_RECONCILED');
  });

  it('never lets report-quality, period, or any other health signal into this decision — it is a pure function of checks + the two core spend inputs', () => {
    // Sanity: the function signature itself only accepts checks + inputs — no
    // report-quality/period/mapping/delivery parameter exists to pass one in.
    const checks = runReconciliation(reconciledInputs);
    const status = deriveDashboardReconciliationStatus(checks, reconciledInputs);
    expect(['DATA_RECONCILED', 'DATA_MISMATCH_REVIEW_REQUIRED', 'INSUFFICIENT_DATA']).toContain(status);
  });
});

describe('End-to-end: real raw report headers -> parser -> aggregation -> reconciliation', () => {
  // This is the actual bug that was live: the Sellerboard Product export's
  // "Sponsored products (PPC)" column didn't match any adSpend alias, so
  // every row parsed adSpend as 0, sellerboardPpcSpend summed to 0.00, and
  // Campaign spend $23.88 vs Sellerboard $0.00 produced a genuine
  // DATA_MISMATCH_REVIEW_REQUIRED — a real mismatch caused by a parsing
  // gap, not a reconciliation-logic bug. Fixed by adding the
  // "sponsored products ppc" alias in normalizeHeaders.ts; nothing in this
  // file (reconciliation.ts) changed for this fix.
  it('parses Amazon Campaign spend 23.88 and Sellerboard "Sponsored products (PPC)" -23.88 through the full real pipeline and reconciles as DATA_RECONCILED', () => {
    const campaignFile: RawParsedFile = {
      headers: ['Date range', 'Campaign name', 'Impressions', 'Clicks', 'Total cost', 'Purchases', 'Sales'],
      rows: [{ 'Date range': 'Aug 14-Aug 17, 2026', 'Campaign name': 'Coconut - Sponsored Products', Impressions: '6131', Clicks: '18', 'Total cost': '23.88', Purchases: '0', Sales: '0' }],
    };
    const { rows: campaignRows } = importCampaignReport({ name: 'campaign.csv', size: 1 }, campaignFile);
    const campaignSpend = campaignRows.reduce((a, r) => a + r.spend, 0);
    expect(campaignSpend).toBeCloseTo(23.88);

    const sellerboardFile: RawParsedFile = {
      headers: ['Marketplace', 'ASIN', 'SKU', 'Ads', 'Sponsored products (PPC)', 'Sponsored Display', 'Sponsored brands (HSA)', 'Sponsored Brands Video'],
      rows: [
        { Marketplace: 'US', ASIN: 'B0GZVBBRZP', SKU: 'ROSE-001', Ads: '-2.42', 'Sponsored products (PPC)': '-2.42', 'Sponsored Display': '0', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
        { Marketplace: 'US', ASIN: 'B0GZVGXXS2', SKU: 'COCO-001', Ads: '-18.25', 'Sponsored products (PPC)': '-18.25', 'Sponsored Display': '0', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
        { Marketplace: 'US', ASIN: 'B0GZVP9HRB', SKU: 'MANGO-001', Ads: '0', 'Sponsored products (PPC)': '0', 'Sponsored Display': '0', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
        { Marketplace: 'US', ASIN: 'B0H28WG6BB', SKU: 'VAN-001', Ads: '-3.21', 'Sponsored products (PPC)': '-3.21', 'Sponsored Display': '0', 'Sponsored brands (HSA)': '0', 'Sponsored Brands Video': '0' },
      ],
    };
    const { rows: sellerboardRows, meta: sellerboardMeta } = importSellerboardProductReport({ name: 'sellerboard.csv', size: 1 }, sellerboardFile);
    expect(sellerboardMeta.missingOptionalFields).not.toContain('adSpend');

    const economics = aggregateSellerboardProducts(sellerboardRows);
    const rawTotal = sellerboardRows.reduce((a, r) => a + r.adSpend, 0);
    expect(rawTotal).toBeCloseTo(-23.88); // raw signed total, preserved as-is
    const sellerboardPpcSpend = economics.reduce((a, e) => a + e.ppcSpend, 0);
    expect(sellerboardPpcSpend).toBeCloseTo(23.88); // magnitude, post-aggregation

    const inputs: ReconciliationInputs = {
      campaignSpend, targetingSpend: campaignSpend, searchTermSpend: campaignSpend, advertisedProductSpend: campaignSpend,
      sellerboardPpcSpend,
    };
    const checks = runReconciliation(inputs);
    expect(deriveDashboardReconciliationStatus(checks, inputs)).toBe('DATA_RECONCILED');
  });

  it('reconciles Amazon Campaign/Targeting/Search Term/Advertised Product all at 23.88 against Sellerboard raw PPC -23.88 as DATA_RECONCILED', () => {
    const inputs: ReconciliationInputs = {
      campaignSpend: 23.88,
      targetingSpend: 23.88,
      searchTermSpend: 23.88,
      advertisedProductSpend: 23.88,
      sellerboardPpcSpend: Math.abs(-23.88),
    };
    const checks = runReconciliation(inputs);
    expect(checks.every((c) => c.status === 'DATA_RECONCILED')).toBe(true);
    expect(deriveDashboardReconciliationStatus(checks, inputs)).toBe('DATA_RECONCILED');
  });
});
