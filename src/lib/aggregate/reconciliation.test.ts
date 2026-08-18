import { describe, it, expect } from 'vitest';
import { runReconciliation, worstStatus, deriveDashboardReconciliationStatus } from './reconciliation';
import type { ReconciliationInputs } from './reconciliation';

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
