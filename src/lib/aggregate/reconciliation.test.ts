import { describe, it, expect } from 'vitest';
import { runReconciliation, worstStatus } from './reconciliation';

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
