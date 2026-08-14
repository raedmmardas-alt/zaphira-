import type { ReconciliationCheck, ReconciliationStatus } from '../../types';

const SMALL_DIFF_THRESHOLD = 0.05; // 5%
const MISMATCH_THRESHOLD = 0.15; // 15%

function statusFor(diffPct: number | null): ReconciliationStatus {
  if (diffPct === null) return 'DATA_RECONCILED';
  const abs = Math.abs(diffPct);
  if (abs <= SMALL_DIFF_THRESHOLD) return 'DATA_RECONCILED';
  if (abs <= MISMATCH_THRESHOLD) return 'SMALL_ATTRIBUTION_DIFFERENCE';
  return 'DATA_MISMATCH_REVIEW_REQUIRED';
}

function check(label: string, a: number | null, b: number | null): ReconciliationCheck {
  if (a === null || b === null || (a === 0 && b === 0)) {
    return { label, a, b, diffPct: null, status: 'DATA_RECONCILED' };
  }
  const base = Math.max(Math.abs(a), Math.abs(b), 0.01);
  const diffPct = (a - b) / base;
  return { label, a, b, diffPct, status: statusFor(diffPct) };
}

export interface ReconciliationInputs {
  campaignSpend: number | null;
  targetingSpend: number | null;
  searchTermSpend: number | null;
  advertisedProductSpend: number | null;
  sellerboardPpcSpend: number | null;
}

export function runReconciliation(inputs: ReconciliationInputs): ReconciliationCheck[] {
  const checks: ReconciliationCheck[] = [];
  checks.push(check('Campaign spend vs Targeting spend', inputs.campaignSpend, inputs.targetingSpend));
  checks.push(check('Targeting spend vs Search Term spend', inputs.targetingSpend, inputs.searchTermSpend));
  if (inputs.advertisedProductSpend !== null) {
    checks.push(check('Targeting spend vs Advertised Product spend', inputs.targetingSpend, inputs.advertisedProductSpend));
  }
  if (inputs.sellerboardPpcSpend !== null) {
    checks.push(check('Campaign spend vs Sellerboard PPC spend', inputs.campaignSpend, inputs.sellerboardPpcSpend));
  }
  return checks;
}

export function worstStatus(checks: ReconciliationCheck[]): ReconciliationStatus {
  if (checks.some((c) => c.status === 'DATA_MISMATCH_REVIEW_REQUIRED')) return 'DATA_MISMATCH_REVIEW_REQUIRED';
  if (checks.some((c) => c.status === 'SMALL_ATTRIBUTION_DIFFERENCE')) return 'SMALL_ATTRIBUTION_DIFFERENCE';
  return 'DATA_RECONCILED';
}
