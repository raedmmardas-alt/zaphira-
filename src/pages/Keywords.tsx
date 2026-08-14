import { useMemo, useState } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge, actionTone, confidenceTone, deliveryTone, riskTone } from '../components/ui/Badge';
import { DELIVERY_LABEL } from '../lib/engine/delivery';
import { useWorkspace } from '../state/useWorkspace';
import { useAppStore } from '../state/store';
import { formatCurrency, formatPercent } from '../lib/engine/metrics';
import { downloadCsv } from '../lib/export/csv';
import type { EnrichedTarget } from '../types';

function MapProductCell({ target }: { target: EnrichedTarget }) {
  const products = useAppStore((s) => s.products);
  const addSavedMapping = useAppStore((s) => s.addSavedMapping);
  const [open, setOpen] = useState(false);

  if (target.productName) {
    return <span className="font-medium text-navy-900">{target.productName}</span>;
  }

  return (
    <div>
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-xs font-semibold text-negative-600 underline decoration-dotted">
          MAPPING REQUIRED — map now
        </button>
      ) : (
        <select
          autoFocus
          defaultValue=""
          onChange={(e) => {
            if (!e.target.value) return;
            addSavedMapping({ campaignName: target.campaign, adGroupName: target.adGroup, productId: e.target.value });
            setOpen(false);
          }}
          onBlur={() => setOpen(false)}
          className="rounded-md border border-border-subtle px-1.5 py-1 text-xs"
        >
          <option value="">Select product…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
    </div>
  );
}

export function Keywords() {
  const ws = useWorkspace();
  const setDeliveryWorkflowStatus = useAppStore((s) => s.setDeliveryWorkflowStatus);
  const deliveryWorkflow = useAppStore((s) => s.deliveryWorkflow);
  const [query, setQuery] = useState('');
  const [productFilter, setProductFilter] = useState('all');
  const [showHidden, setShowHidden] = useState(false);
  const products = useAppStore((s) => s.products);

  const currentTargets = ws.targets.filter((t) => t.isCurrentPeriod);

  const filtered = useMemo(() => {
    return currentTargets.filter((t) => {
      const wf = deliveryWorkflow[t.key];
      if (!showHidden && wf?.status === 'HIDDEN') return false;
      if (productFilter !== 'all' && t.productId !== productFilter) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        t.targetingText.toLowerCase().includes(q) ||
        t.campaign.toLowerCase().includes(q) ||
        t.adGroup.toLowerCase().includes(q) ||
        (t.productName ?? '').toLowerCase().includes(q)
      );
    });
  }, [currentTargets, query, productFilter, showHidden, deliveryWorkflow]);

  function exportCsv() {
    downloadCsv(
      'zaphira_keyword_analysis.csv',
      ['Product', 'ASIN', 'Campaign', 'Ad Group', 'Keyword', 'Match Type', 'Current Bid', 'Impressions', 'Clicks', 'CTR', 'Spend', 'Orders', 'Sales', 'CVR', 'ACoS', 'Delivery', 'Recommended Action', 'Risk', 'Confidence'],
      filtered.map((t) => [
        t.productName ?? 'UNMAPPED', t.asin ?? '', t.campaign, t.adGroup, t.targetingText, t.matchType,
        t.currentBid ?? '', t.impressions, t.clicks, t.ctr !== null ? (t.ctr * 100).toFixed(2) : '', t.spend.toFixed(2),
        t.orders, t.sales.toFixed(2), t.cvr !== null ? (t.cvr * 100).toFixed(2) : '', t.acos !== null ? (t.acos * 100).toFixed(2) : '',
        DELIVERY_LABEL[t.delivery], t.action.action, t.action.risk, t.action.confidence,
      ]),
    );
  }

  function exportPauseReview() {
    const candidates = filtered.filter((t) => t.delivery === 'NO_DELIVERY' || t.delivery === 'LOW_DELIVERY' || t.action.action === 'NEGATIVE_PAUSE_CANDIDATE');
    downloadCsv(
      'zaphira_pause_review.csv',
      ['Product', 'ASIN', 'Campaign', 'Ad Group', 'Keyword', 'Match Type', 'Delivery', 'Spend', 'Orders', 'Workflow Status'],
      candidates.map((t) => [t.productName ?? 'UNMAPPED', t.asin ?? '', t.campaign, t.adGroup, t.targetingText, t.matchType, DELIVERY_LABEL[t.delivery], t.spend.toFixed(2), t.orders, deliveryWorkflow[t.key]?.status ?? 'NONE']),
    );
  }

  return (
    <div>
      <PageHeader
        title="Keywords"
        subtitle="Identical keyword text can exist across multiple products — Product and Ad Group are always shown."
        actions={
          <>
            <button onClick={exportPauseReview} className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-navy-700 hover:bg-navy-900/5">Export Pause Review CSV</button>
            <button onClick={exportCsv} className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-navy-700 hover:bg-navy-900/5">Download Keyword Analysis CSV</button>
          </>
        }
      />
      <div className="p-8">
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search keyword, campaign, ad group, product…" className="w-72 rounded-lg border border-border-subtle px-3 py-1.5 text-sm" />
            <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm">
              <option value="all">All products</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-navy-600">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
            </label>
            <span className="text-xs text-navy-500">{filtered.length} of {currentTargets.length} current-period targets</span>
          </div>

          <Table>
            <thead><tr>
              <Th>Product</Th><Th>Ad Group</Th><Th>Keyword / Target</Th><Th>Match</Th><Th>Campaign</Th><Th>Bid</Th><Th>Impr.</Th><Th>Clicks</Th><Th>CTR</Th><Th>Spend</Th><Th>Orders</Th><Th>Sales</Th><Th>CVR</Th><Th>ACoS</Th><Th>Delivery</Th><Th>Action</Th><Th>Risk</Th><Th>Confidence</Th><Th>Workflow</Th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><Td className="text-navy-500">No targets to show. Import a Targeting report on the Dashboard.</Td></tr>}
              {filtered.map((t) => {
                const wf = deliveryWorkflow[t.key];
                const lowNoDelivery = t.delivery === 'NO_DELIVERY' || t.delivery === 'LOW_DELIVERY';
                return (
                  <tr key={t.key}>
                    <Td><MapProductCell target={t} /></Td>
                    <Td className="max-w-[160px] truncate text-xs text-navy-600">{t.adGroup}</Td>
                    <Td className="max-w-[220px] truncate font-medium text-navy-900">{t.targetingText}</Td>
                    <Td className="text-xs">{t.matchType}</Td>
                    <Td className="max-w-[160px] truncate text-xs text-navy-600">{t.campaign}</Td>
                    <Td>{t.currentBid !== null ? formatCurrency(t.currentBid) : '—'}</Td>
                    <Td>{t.impressions.toLocaleString()}</Td>
                    <Td>{t.clicks.toLocaleString()}</Td>
                    <Td>{formatPercent(t.ctr)}</Td>
                    <Td>{formatCurrency(t.spend)}</Td>
                    <Td>{t.orders}</Td>
                    <Td>{formatCurrency(t.sales)}</Td>
                    <Td>{formatPercent(t.cvr)}</Td>
                    <Td>{formatPercent(t.acos)}</Td>
                    <Td><Badge tone={deliveryTone(t.delivery)}>{DELIVERY_LABEL[t.delivery]}</Badge></Td>
                    <Td><Badge tone={actionTone(t.action.action)}>{t.action.action.replace(/_/g, ' ')}</Badge></Td>
                    <Td><Badge tone={riskTone(t.action.risk)}>{t.action.risk}</Badge></Td>
                    <Td><Badge tone={confidenceTone(t.action.confidence)}>{t.action.confidence}</Badge></Td>
                    <Td>
                      {lowNoDelivery ? (
                        <div className="flex gap-1">
                          <button title="Hide from workspace" onClick={() => setDeliveryWorkflowStatus(t.key, 'HIDDEN', ws.currentPeriod)} className="rounded border border-border-subtle px-1.5 py-0.5 text-[10px] hover:bg-navy-900/5">Hide</button>
                          <button title="Mark Pause Candidate" onClick={() => setDeliveryWorkflowStatus(t.key, 'PAUSE_CANDIDATE', ws.currentPeriod)} className="rounded border border-border-subtle px-1.5 py-0.5 text-[10px] hover:bg-navy-900/5">Pause?</button>
                          <button title="Keep Watching" onClick={() => setDeliveryWorkflowStatus(t.key, 'KEEP_WATCHING', ws.currentPeriod)} className="rounded border border-border-subtle px-1.5 py-0.5 text-[10px] hover:bg-navy-900/5">Watch</button>
                        </div>
                      ) : (
                        <span className="text-xs text-navy-400">{wf?.status && wf.status !== 'NONE' ? wf.status.replace(/_/g, ' ') : '—'}</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
