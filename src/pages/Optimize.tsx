import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { useDecisionActions } from '../state/useDecisionActions';
import { useAppStore } from '../state/store';
import { formatCurrency, formatMatchType, formatPercent } from '../lib/engine/metrics';
import { DELIVERY_LABEL } from '../lib/engine/delivery';
import { SIMPLE_ACTION_LABEL, SIMPLE_RISK_LABEL, simpleActionTone, simpleRiskTone, type SimpleAction } from '../lib/engine/simplifiedAction';
import type { DecisionAction } from '../types';

const ACTION_FILTERS: { value: SimpleAction | 'all'; label: string }[] = [
  { value: 'all', label: 'All Actions' },
  { value: 'INCREASE', label: 'Increase' },
  { value: 'HOLD', label: 'Hold' },
  { value: 'REDUCE', label: 'Reduce' },
  { value: 'PAUSE', label: 'Pause' },
  { value: 'TEST', label: 'Test' },
];

function bidCell(a: DecisionAction): string {
  if (a.currentBid === null && a.recommendedBid === null) return '—';
  return `${formatCurrency(a.currentBid)} → ${formatCurrency(a.recommendedBid)}`;
}

export function Optimize() {
  const { targetDecisions } = useDecisionActions();
  const products = useAppStore((s) => s.products);
  const [searchParams, setSearchParams] = useSearchParams();
  const productFilter = searchParams.get('product') ?? 'all';
  const [actionFilter, setActionFilter] = useState<SimpleAction | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return targetDecisions.filter((a) => {
      if (productFilter !== 'all' && a.productId !== productFilter) return false;
      if (actionFilter !== 'all' && SIMPLE_ACTION_LABEL[a.action] !== actionFilter) return false;
      return true;
    });
  }, [targetDecisions, productFilter, actionFilter]);

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div>
      <PageHeader title="Optimize" subtitle="What exactly should I change? Recommendation-only — Zaphira never changes Amazon campaigns automatically." />
      <div className="p-8">
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select
              value={productFilter}
              onChange={(e) => setSearchParams(e.target.value === 'all' ? {} : { product: e.target.value })}
              className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm"
            >
              <option value="all">All Products</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as SimpleAction | 'all')}
              className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm"
            >
              {ACTION_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <span className="text-xs text-navy-500">{filtered.length} of {targetDecisions.length} current-period keywords/targets</span>
          </div>

          <Table>
            <thead>
              <tr>
                <Th>Product</Th><Th>Keyword / Target</Th><Th>Match Type</Th><Th>Current Bid</Th><Th>Recommended Bid</Th><Th>Reason</Th><Th>Risk</Th><Th>Action</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><Td className="text-navy-500" colSpan={9}>Nothing to show yet. Upload Amazon Targeting/Campaign reports on the Upload Data page.</Td></tr>
              )}
              {filtered.map((a) => (
                <Fragment key={a.key}>
                  <tr>
                    <Td className="font-medium text-navy-900">{a.productName ?? <span className="text-negative-600">Unmapped</span>}</Td>
                    <Td className="max-w-[220px] truncate font-medium text-navy-900">{a.targetingText}</Td>
                    <Td className="text-xs">{formatMatchType(a.matchType)}</Td>
                    <Td>{a.currentBid !== null ? formatCurrency(a.currentBid) : '—'}</Td>
                    <Td className="font-medium text-navy-900">{bidCell(a)}</Td>
                    <Td className="max-w-[280px] truncate text-xs text-navy-600" title={a.reason}>{a.reason}</Td>
                    <Td><Badge tone={simpleRiskTone(a.risk.classification)}>{SIMPLE_RISK_LABEL[a.risk.classification]}</Badge></Td>
                    <Td><Badge tone={simpleActionTone(a.action)}>{SIMPLE_ACTION_LABEL[a.action]}</Badge></Td>
                    <Td>
                      <button onClick={() => toggleExpanded(a.key)} className="text-xs font-medium text-brand-700 hover:underline">
                        {expanded.has(a.key) ? 'Hide' : 'Why?'}
                      </button>
                    </Td>
                  </tr>
                  {expanded.has(a.key) && (
                    <tr>
                      <Td colSpan={9} className="bg-navy-900/[0.02]">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 py-1 text-xs text-navy-600 md:grid-cols-4">
                          <div>Checkpoint <span className="float-right font-medium text-navy-900">{a.checkpointLabel}</span></div>
                          <div>Conversion evidence <span className="float-right font-medium text-navy-900">{a.conversionEvidence}</span></div>
                          <div>Traffic / delivery <span className="float-right font-medium text-navy-900">{DELIVERY_LABEL[a.delivery]}</span></div>
                          <div>Confidence <span className="float-right font-medium text-navy-900">{a.confidence}</span></div>
                          <div>Remaining to CPA review <span className="float-right font-medium text-navy-900">{a.remainingToTargetCpaReview !== null ? formatCurrency(a.remainingToTargetCpaReview) : '—'}</span></div>
                          <div>Remaining to break-even <span className="float-right font-medium text-navy-900">{a.remainingToBreakEvenStop !== null ? formatCurrency(a.remainingToBreakEvenStop) : '—'}</span></div>
                          <div>Current ACoS <span className="float-right font-medium text-navy-900">{formatPercent(a.currentPerformance.acos)}</span></div>
                          {a.estimatedImpact !== 0 && (
                            <div>Estimated impact <span className={`float-right font-medium ${a.estimatedImpact >= 0 ? 'text-positive-600' : 'text-negative-600'}`}>{formatCurrency(a.estimatedImpact)}</span></div>
                          )}
                        </div>
                      </Td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
