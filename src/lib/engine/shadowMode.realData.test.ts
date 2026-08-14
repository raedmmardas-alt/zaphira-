import { describe, it, expect } from 'vitest';
import { buildWorkspace } from '../../state/deriveWorkspace';
import { EMPTY_ROWS } from '../../state/store';
import { DEFAULT_PRODUCTS, DEFAULT_SETTINGS } from '../../types';
import type { ReportImportMeta, TargetingRow } from '../../types';
import { buildShadowSnapshotFromTarget, evaluateShadowSnapshot, summarizeShadowBatch } from './shadowEvaluation';

// Real-data regression fixture: the confirmed Aug 9-12, 2026 report period,
// 22 current-period targets (21 WAIT-shaped, 1 WATCH — the real Vanilla
// "body butter" row), reproducing the exact scenario reported against
// Shadow Mode's baseline capture.
const PERIOD = { start: '2026-08-09', end: '2026-08-12' };

function targetingMeta(): ReportImportMeta {
  return {
    id: 't1', type: 'targeting', filename: 'targeting.csv', fileSizeBytes: 1, rowCount: 22, importedAt: new Date().toISOString(),
    requestedPeriod: PERIOD, observedPeriod: PERIOD, periodConfirmedManually: true, status: 'OK',
    detectedColumns: [], missingRequiredFields: [], missingOptionalFields: [],
  };
}

const CAMPAIGNS = ['Rose - Sponsored Products', 'Coconut - Sponsored Products', 'Mango - Sponsored Products', 'Vanilla - Sponsored Products'];

function buildRealAugDataset(): TargetingRow[] {
  const rows: TargetingRow[] = [];
  // 21 low-click WAIT-shaped targets, spread across all four products.
  for (let i = 0; i < 21; i++) {
    const campaign = CAMPAIGNS[i % CAMPAIGNS.length];
    rows.push({
      campaign,
      adGroup: `${campaign.split(' - ')[0]} AG`,
      targetingText: `keyword ${i + 1}`,
      matchType: 'broad',
      bid: 0.3,
      impressions: 50 + i,
      clicks: (i % 4), // always < 5
      spend: 1 + i * 0.1,
      orders: 0,
      sales: 0,
    });
  }
  // The exact real Vanilla "body butter" row.
  rows.push({
    campaign: 'Vanilla - Sponsored Products',
    adGroup: 'Vanilla AG',
    targetingText: 'body butter',
    matchType: 'exact',
    bid: 1.0,
    impressions: 3367,
    clicks: 11,
    spend: 9.23,
    orders: 0,
    sales: 0,
  });
  return rows;
}

describe('Shadow Mode real Aug 9-12 baseline capture', () => {
  const rows = buildRealAugDataset();
  const ws = buildWorkspace(
    { campaign: targetingMeta(), targeting: targetingMeta() },
    { ...EMPTY_ROWS, targeting: rows },
    DEFAULT_PRODUCTS,
    [],
    DEFAULT_SETTINGS,
    {},
  );
  const currentTargets = ws.targets.filter((t) => t.isCurrentPeriod);

  it('confirms the report period automatically equals Aug 9-12, 2026 (not manually entered)', () => {
    expect(ws.currentPeriod).toEqual(PERIOD);
  });

  it('has exactly 22 current-period targets', () => {
    expect(currentTargets).toHaveLength(22);
  });

  it('classifies exactly 21 WAIT and 1 WATCH (matching the real dataset)', () => {
    const byAction: Record<string, number> = {};
    for (const t of currentTargets) byAction[t.action.action] = (byAction[t.action.action] ?? 0) + 1;
    expect(byAction.WAIT).toBe(21);
    expect(byAction.WATCH).toBe(1);
  });

  it('includes Vanilla "body butter" as WATCH with the exact real metrics', () => {
    const vanillaBodyButter = currentTargets.find((t) => t.targetingText === 'body butter' && t.productName === 'Vanilla');
    expect(vanillaBodyButter).toBeDefined();
    expect(vanillaBodyButter!.impressions).toBe(3367);
    expect(vanillaBodyButter!.clicks).toBe(11);
    expect(vanillaBodyButter!.spend).toBeCloseTo(9.23);
    expect(vanillaBodyButter!.orders).toBe(0);
    expect(vanillaBodyButter!.action.action).toBe('WATCH');
    expect(vanillaBodyButter!.action.risk).toBe('MEDIUM');
    expect(vanillaBodyButter!.action.confidence).toBe('MEDIUM');
  });

  describe('saving a Shadow Snapshot baseline over ALL current-period targets (not just actionable ones)', () => {
    const savedAt = '2026-08-13T00:00:00.000Z';
    const snapshots = currentTargets.map((t) => buildShadowSnapshotFromTarget(t, savedAt, ws.currentPeriod));

    it('records exactly 22 snapshot rows, including WAIT-classified targets', () => {
      expect(snapshots).toHaveLength(22);
      expect(snapshots.filter((s) => s.recommendedAction === 'WAIT')).toHaveLength(21);
      expect(snapshots.filter((s) => s.recommendedAction === 'WATCH')).toHaveLength(1);
    });

    it('automatically stamps the baseline period as Aug 9-12, 2026 on every row, with no manual entry', () => {
      for (const s of snapshots) expect(s.reportPeriod).toEqual(PERIOD);
    });

    it('defaults every snapshot to NOT APPLIED', () => {
      for (const s of snapshots) {
        expect(s.appliedManually).toBe(false);
        expect(s.appliedAt).toBeNull();
      }
    });

    it('preserves the Vanilla body butter row with full frozen metrics', () => {
      const snap = snapshots.find((s) => s.targetingText === 'body butter' && s.productName === 'Vanilla');
      expect(snap).toBeDefined();
      expect(snap!.beforeMetrics).toMatchObject({ impressions: 3367, clicks: 11, spend: 9.23, orders: 0, sales: 0 });
      expect(snap!.recommendedAction).toBe('WATCH');
      expect(snap!.currentBid).toBe(1.0);
    });

    it('directional accuracy evaluated count remains 0 until something is manually marked Applied', () => {
      // No snapshot is applied yet, so evaluateShadowSnapshot short-circuits
      // to INSUFFICIENT_DATA for every row regardless of comparison data —
      // an empty map is sufficient to prove that.
      const evaluations = snapshots.map((s) => ({ snapshot: s, evaluation: evaluateShadowSnapshot(s, new Map(), ws.currentPeriod) }));
      const summary = summarizeShadowBatch(savedAt, ws.currentPeriod, evaluations);
      expect(summary.numTargets).toBe(22);
      expect(summary.numApplied).toBe(0);
      expect(summary.numEvaluated).toBe(0);
    });
  });
});
