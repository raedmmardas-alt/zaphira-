import { useMemo, useState } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge, actionTone, confidenceTone, riskTone } from '../components/ui/Badge';
import { useWorkspace } from '../state/useWorkspace';
import { useAppStore } from '../state/store';
import { downloadCsv } from '../lib/export/csv';
import { evaluateShadowSnapshot } from '../lib/engine/shadowEvaluation';
import type { ShadowSnapshot } from '../types';

const OUTCOME_TONE: Record<string, 'positive' | 'negative' | 'watch' | 'neutral'> = {
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
  MIXED: 'watch',
  INSUFFICIENT_DATA: 'neutral',
  NON_COMPARABLE_PERIOD: 'neutral',
};

export function ShadowMode() {
  const ws = useWorkspace();
  const shadowSnapshots = useAppStore((s) => s.shadowSnapshots);
  const saveShadowSnapshot = useAppStore((s) => s.saveShadowSnapshot);
  const markShadowApplied = useAppStore((s) => s.markShadowApplied);
  const [query, setQuery] = useState('');

  const currentTargetsByKey = useMemo(() => new Map(ws.targets.filter((t) => t.isCurrentPeriod).map((t) => [t.key, t])), [ws.targets]);

  const actionable = ws.targets.filter((t) => t.isCurrentPeriod && ['SCALE', 'REDUCE_BID', 'NEGATIVE_PAUSE_CANDIDATE'].includes(t.action.action));
  const filteredActionable = actionable.filter((t) => t.targetingText.toLowerCase().includes(query.toLowerCase()));

  function saveSnapshot(target: (typeof actionable)[number]) {
    const snap: ShadowSnapshot = {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      reportPeriod: ws.currentPeriod,
      targetKey: target.key,
      targetingText: target.targetingText,
      matchType: target.matchType,
      productId: target.productId,
      productName: target.productName,
      campaign: target.campaign,
      adGroup: target.adGroup,
      currentBid: target.currentBid,
      recommendedAction: target.action.action,
      recommendedBid: target.action.recommendedBid,
      risk: target.action.risk,
      confidence: target.action.confidence,
      beforeMetrics: { impressions: target.impressions, clicks: target.clicks, spend: target.spend, orders: target.orders, sales: target.sales, acos: target.acos },
      appliedManually: false,
      appliedAt: null,
    };
    saveShadowSnapshot(snap);
  }

  const evaluations = shadowSnapshots.map((s) => ({ snapshot: s, evaluation: evaluateShadowSnapshot(s, currentTargetsByKey, ws.currentPeriod) }));

  function exportCsv() {
    downloadCsv(
      'zaphira_shadow_mode.csv',
      ['Saved At', 'Report Period', 'Product', 'Campaign', 'Ad Group', 'Keyword', 'Match Type', 'Current Bid', 'Recommended Action', 'Recommended Bid', 'Risk', 'Confidence', 'Applied Manually', 'Outcome'],
      evaluations.map(({ snapshot: s, evaluation: e }) => [
        s.savedAt, s.reportPeriod ? `${s.reportPeriod.start} to ${s.reportPeriod.end}` : '', s.productName ?? 'UNMAPPED', s.campaign, s.adGroup, s.targetingText, s.matchType,
        s.currentBid ?? '', s.recommendedAction, s.recommendedBid ?? '', s.risk, s.confidence, s.appliedManually ? 'YES' : 'NO', s.appliedManually ? e.outcome : 'NOT APPLIED — OBSERVATIONAL ONLY',
      ]),
    );
  }

  return (
    <div>
      <PageHeader title="Shadow Mode" subtitle="Observe, record, validate. Zaphira never automatically changes Amazon — this is a decision journal, not an executor." />
      <div className="space-y-6 p-8">
        <Card title="Save a Shadow Snapshot" subtitle="Freezes the current recommendation and before-metrics for later comparison">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search targets…" className="mb-4 w-72 rounded-lg border border-border-subtle px-3 py-1.5 text-sm" />
          <Table>
            <thead><tr><Th>Keyword</Th><Th>Product</Th><Th>Campaign</Th><Th>Action</Th><Th>Risk</Th><Th>Confidence</Th><Th></Th></tr></thead>
            <tbody>
              {filteredActionable.length === 0 && <tr><Td className="text-navy-500">No current-period targets with an active recommendation yet.</Td></tr>}
              {filteredActionable.slice(0, 100).map((t) => (
                <tr key={t.key}>
                  <Td className="font-medium text-navy-900">{t.targetingText}</Td>
                  <Td>{t.productName ?? 'Unmapped'}</Td>
                  <Td className="max-w-[160px] truncate text-xs">{t.campaign}</Td>
                  <Td><Badge tone={actionTone(t.action.action)}>{t.action.action.replace(/_/g, ' ')}</Badge></Td>
                  <Td><Badge tone={riskTone(t.action.risk)}>{t.action.risk}</Badge></Td>
                  <Td><Badge tone={confidenceTone(t.action.confidence)}>{t.action.confidence}</Badge></Td>
                  <Td><button onClick={() => saveSnapshot(t)} className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700">Save Snapshot</button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card
          title="Saved Snapshots"
          subtitle="Only manually-applied snapshots are evaluated for directional outcome. Non-applied snapshots are observational only."
          actions={<button onClick={exportCsv} className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-navy-900/5">Download Shadow Mode CSV</button>}
        >
          <Table>
            <thead><tr><Th>Saved</Th><Th>Product</Th><Th>Keyword</Th><Th>Recommendation</Th><Th>Applied?</Th><Th>Outcome</Th><Th>Notes</Th></tr></thead>
            <tbody>
              {evaluations.length === 0 && <tr><Td className="text-navy-500">No snapshots saved yet.</Td></tr>}
              {evaluations.map(({ snapshot: s, evaluation: e }) => (
                <tr key={s.id}>
                  <Td className="text-xs">{new Date(s.savedAt).toLocaleDateString()}</Td>
                  <Td>{s.productName ?? 'Unmapped'}</Td>
                  <Td className="max-w-[200px] truncate font-medium text-navy-900">{s.targetingText}</Td>
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
