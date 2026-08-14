import { useMemo, useState } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge, actionTone, confidenceTone, deliveryTone, riskTone } from '../components/ui/Badge';
import { DELIVERY_LABEL } from '../lib/engine/delivery';
import { useWorkspace } from '../state/useWorkspace';
import { useAppStore } from '../state/store';
import { downloadCsv } from '../lib/export/csv';
import { buildShadowSnapshotFromTarget, buildShadowTargetKey, evaluateShadowSnapshot, summarizeShadowBatch } from '../lib/engine/shadowEvaluation';
import type { ShadowSnapshot } from '../types';

const OUTCOME_TONE: Record<string, 'positive' | 'negative' | 'watch' | 'neutral'> = {
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
  MIXED: 'watch',
  INSUFFICIENT_DATA: 'neutral',
  NON_COMPARABLE_PERIOD: 'neutral',
};

const ALIGNED_STATUSES = new Set(['REPORT_PERIODS_ALIGNED', 'AUTO_ALIGNED_HIGH_CONFIDENCE']);

export function ShadowMode() {
  const ws = useWorkspace();
  const shadowSnapshots = useAppStore((s) => s.shadowSnapshots);
  const saveShadowSnapshotBatch = useAppStore((s) => s.saveShadowSnapshotBatch);
  const markShadowApplied = useAppStore((s) => s.markShadowApplied);
  const [query, setQuery] = useState('');

  // Comparison map uses the SAME composite key used to save snapshots, so
  // later-period evaluation lookups always match correctly.
  const currentTargetsByKey = useMemo(
    () => new Map(ws.targets.filter((t) => t.isCurrentPeriod).map((t) => [buildShadowTargetKey(t), t])),
    [ws.targets],
  );

  // ALL current-period targets are eligible for the baseline — Shadow Mode
  // freezes the full before-state, not just targets with a bid-change call.
  const currentTargets = useMemo(() => ws.targets.filter((t) => t.isCurrentPeriod), [ws.targets]);
  const filteredPreview = currentTargets.filter((t) => t.targetingText.toLowerCase().includes(query.toLowerCase()) || (t.productName ?? '').toLowerCase().includes(query.toLowerCase()));

  const periodAligned = ALIGNED_STATUSES.has(ws.alignment.status);
  const canSnapshot = periodAligned && currentTargets.length > 0 && ws.currentPeriod !== null;

  let disabledReason = '';
  if (!ws.currentPeriod) {
    disabledReason = 'No confirmed current report period yet — import and align Campaign/Targeting reports first.';
  } else if (!periodAligned) {
    disabledReason = `Report periods are not yet aligned or confirmed (status: ${ws.alignment.status.replace(/_/g, ' ')}). Resolve this on the Dashboard before saving a baseline.`;
  } else if (currentTargets.length === 0) {
    disabledReason = 'No current-period targets available to snapshot.';
  }

  function saveBaselineSnapshot() {
    if (!canSnapshot) return;
    const savedAt = new Date().toISOString();
    const snapshots = currentTargets.map((t) => buildShadowSnapshotFromTarget(t, savedAt, ws.currentPeriod));
    saveShadowSnapshotBatch(snapshots);
  }

  const evaluations = shadowSnapshots.map((s) => ({ snapshot: s, evaluation: evaluateShadowSnapshot(s, currentTargetsByKey, ws.currentPeriod) }));

  // Group the flat snapshot rows into the batches they were saved in
  // (one "Save Shadow Snapshot" click = one batch, sharing savedAt + period).
  const batches = useMemo(() => {
    const map = new Map<string, { savedAt: string; reportPeriod: ShadowSnapshot['reportPeriod']; rows: typeof evaluations }>();
    for (const entry of evaluations) {
      const key = `${entry.snapshot.savedAt}|${entry.snapshot.reportPeriod ? `${entry.snapshot.reportPeriod.start}_${entry.snapshot.reportPeriod.end}` : 'none'}`;
      const existing = map.get(key);
      if (existing) existing.rows.push(entry);
      else map.set(key, { savedAt: entry.snapshot.savedAt, reportPeriod: entry.snapshot.reportPeriod, rows: [entry] });
    }
    return Array.from(map.values()).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  }, [evaluations]);

  function exportCsv() {
    downloadCsv(
      'zaphira_shadow_mode.csv',
      [
        'Saved At', 'Report Period', 'Product', 'ASIN', 'Campaign', 'Ad Group', 'Keyword', 'Match Type', 'Current Bid',
        'Impressions', 'Clicks', 'Spend', 'Orders', 'Sales', 'CVR', 'ACoS', 'Delivery',
        'Recommended Action', 'Recommended Bid', 'Risk', 'Confidence', 'Applied Manually', 'Outcome',
      ],
      evaluations.map(({ snapshot: s, evaluation: e }) => [
        s.savedAt, s.reportPeriod ? `${s.reportPeriod.start} to ${s.reportPeriod.end}` : '', s.productName ?? 'UNMAPPED', s.asin ?? '', s.campaign, s.adGroup, s.targetingText, s.matchType,
        s.currentBid ?? '',
        s.beforeMetrics.impressions, s.beforeMetrics.clicks, s.beforeMetrics.spend, s.beforeMetrics.orders, s.beforeMetrics.sales,
        s.beforeMetrics.cvr ?? '', s.beforeMetrics.acos ?? '', DELIVERY_LABEL[s.delivery],
        s.recommendedAction, s.recommendedBid ?? '', s.risk, s.confidence, s.appliedManually ? 'YES' : 'NO', s.appliedManually ? e.outcome : 'NOT APPLIED — OBSERVATIONAL ONLY',
      ]),
    );
  }

  return (
    <div>
      <PageHeader title="Shadow Mode" subtitle="Observe, record, validate. Zaphira never automatically changes Amazon — this is a decision journal, not an executor." />
      <div className="space-y-6 p-8">
        <Card title="Save a Shadow Snapshot" subtitle="Freezes the full before-state of every current-period target for later comparison — not only targets with an active bid-change recommendation.">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-navy-900/[0.02] px-4 py-3">
            <div className="text-sm">
              <div className="font-medium text-navy-900">
                Baseline period: {ws.currentPeriod ? `${ws.currentPeriod.start} → ${ws.currentPeriod.end}` : '— not established'}
              </div>
              <div className="text-xs text-navy-500">Automatically inherited from the currently confirmed/aligned report period. Not manually entered.</div>
              {!canSnapshot && <div className="mt-1 text-xs font-medium text-negative-600">{disabledReason}</div>}
              {canSnapshot && <div className="mt-1 text-xs text-navy-500">{currentTargets.length} current-period target(s) will be captured.</div>}
            </div>
            <button
              onClick={saveBaselineSnapshot}
              disabled={!canSnapshot}
              className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save Shadow Snapshot
            </button>
          </div>

          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search targets…" className="mb-4 w-72 rounded-lg border border-border-subtle px-3 py-1.5 text-sm" />
          <Table>
            <thead><tr><Th>Keyword</Th><Th>Product</Th><Th>Campaign</Th><Th>Delivery</Th><Th>Action</Th><Th>Risk</Th><Th>Confidence</Th></tr></thead>
            <tbody>
              {filteredPreview.length === 0 && <tr><Td className="text-navy-500">No current-period targets to preview.</Td></tr>}
              {filteredPreview.slice(0, 200).map((t) => (
                <tr key={t.key}>
                  <Td className="font-medium text-navy-900">{t.targetingText}</Td>
                  <Td>{t.productName ?? 'Unmapped'}</Td>
                  <Td className="max-w-[160px] truncate text-xs">{t.campaign}</Td>
                  <Td><Badge tone={deliveryTone(t.delivery)}>{DELIVERY_LABEL[t.delivery]}</Badge></Td>
                  <Td><Badge tone={actionTone(t.action.action)}>{t.action.action.replace(/_/g, ' ')}</Badge></Td>
                  <Td><Badge tone={riskTone(t.action.risk)}>{t.action.risk}</Badge></Td>
                  <Td><Badge tone={confidenceTone(t.action.confidence)}>{t.action.confidence}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Snapshot Batches" subtitle="Every Save Shadow Snapshot click creates a new batch. Older batches are never overwritten.">
          {batches.length === 0 ? <p className="text-sm text-navy-500">No snapshots saved yet.</p> : (
            <div className="space-y-2">
              {batches.map((b) => {
                const summary = summarizeShadowBatch(b.savedAt, b.reportPeriod, b.rows);
                return (
                  <div key={`${b.savedAt}|${b.reportPeriod?.start}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle p-3 text-sm">
                    <div>
                      <div className="font-medium text-navy-900">{new Date(b.savedAt).toLocaleString()}</div>
                      <div className="text-xs text-navy-500">Baseline period: {b.reportPeriod ? `${b.reportPeriod.start} → ${b.reportPeriod.end}` : '—'}</div>
                    </div>
                    <div className="flex gap-4 text-xs text-navy-600">
                      <span><span className="font-semibold text-navy-900">{summary.numTargets}</span> targets</span>
                      <span><span className="font-semibold text-navy-900">{summary.numApplied}</span> applied</span>
                      <span><span className="font-semibold text-navy-900">{summary.numEvaluated}</span> evaluated</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title="Saved Snapshots"
          subtitle="Only manually-applied snapshots are evaluated for directional outcome. Non-applied snapshots are observational only. Observational validation only — not proof of causal lift."
          actions={<button onClick={exportCsv} className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-navy-900/5">Download Shadow Mode CSV</button>}
        >
          <Table>
            <thead><tr><Th>Saved</Th><Th>Product</Th><Th>Keyword</Th><Th>Delivery</Th><Th>Recommendation</Th><Th>Applied?</Th><Th>Outcome</Th><Th>Notes</Th></tr></thead>
            <tbody>
              {evaluations.length === 0 && <tr><Td className="text-navy-500">No snapshots saved yet.</Td></tr>}
              {evaluations.map(({ snapshot: s, evaluation: e }) => (
                <tr key={s.id}>
                  <Td className="text-xs">{new Date(s.savedAt).toLocaleDateString()}</Td>
                  <Td>{s.productName ?? 'Unmapped'}</Td>
                  <Td className="max-w-[200px] truncate font-medium text-navy-900">{s.targetingText}</Td>
                  <Td><Badge tone={deliveryTone(s.delivery)}>{DELIVERY_LABEL[s.delivery]}</Badge></Td>
                  <Td><Badge tone={actionTone(s.recommendedAction)}>{s.recommendedAction.replace(/_/g, ' ')}</Badge></Td>
                  <Td>
                    {s.appliedManually ? (
                      <span className="text-xs font-medium text-positive-600">Applied {s.appliedAt ? new Date(s.appliedAt).toLocaleDateString() : ''}</span>
                    ) : (
                      <button onClick={() => markShadowApplied(s.id)} className="rounded border border-border-subtle px-2 py-1 text-xs hover:bg-navy-900/5">Mark Applied Manually</button>
                    )}
                  </Td>
                  <Td>
                    {s.appliedManually ? <Badge tone={OUTCOME_TONE[e.outcome]}>{e.outcome.replace(/_/g, ' ')}</Badge> : <span className="text-xs text-navy-400">Observational only</span>}
                  </Td>
                  <Td className="max-w-[280px] whitespace-normal text-xs text-navy-600">{s.appliedManually ? e.notes : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

