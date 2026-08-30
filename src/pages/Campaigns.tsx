import { useMemo, useState } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge, riskTone, confidenceTone } from '../components/ui/Badge';
import { useWorkspace } from '../state/useWorkspace';
import { formatCurrency, formatPercent } from '../lib/engine/metrics';
import { downloadCsv } from '../lib/export/csv';

const STATUS_LABEL: Record<string, string> = {
  CURRENT_ACTIVITY_CONFIRMED: 'Current-period activity confirmed',
  HISTORICAL_ONLY: 'Historical only',
  CURRENT_STATUS_UNKNOWN: 'Current status unknown',
};

export function Campaigns() {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'current' | 'historical'>('current');

  const filtered = useMemo(() => {
    const set = ws.campaigns.filter((c) => (tab === 'current' ? c.isCurrentPeriod : !c.isCurrentPeriod));
    const q = query.trim().toLowerCase();
    if (!q) return set;
    return set.filter((c) => c.campaign.toLowerCase().includes(q) || (c.productName ?? '').toLowerCase().includes(q));
  }, [ws.campaigns, tab, query]);

  function exportCsv() {
    downloadCsv(
      'zaphira_campaign_analysis.csv',
      ['Campaign', 'Product', 'Status Confidence', 'Impressions', 'Clicks', 'Spend', 'Orders', 'Sales', 'ACoS', 'CTR', 'CPC', 'CVR', 'Budget', 'Recommendation', 'Risk', 'Confidence'],
      filtered.map((c) => [
        c.campaign, c.productName ?? 'UNMAPPED', STATUS_LABEL[c.statusConfidence], c.impressions, c.clicks, c.spend.toFixed(2),
        c.orders, c.sales.toFixed(2), c.acos !== null ? (c.acos * 100).toFixed(2) : '', c.ctr !== null ? (c.ctr * 100).toFixed(2) : '',
        c.cpc !== null ? c.cpc.toFixed(2) : '', c.cvr !== null ? (c.cvr * 100).toFixed(2) : '', c.budget ?? '', c.recommendation, c.risk, c.confidence,
      ]),
    );
  }

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle="A campaign's target status shown as ENABLED never proves it is currently live."
        actions={<button onClick={exportCsv} className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-navy-700 hover:bg-navy-900/5">Download Campaign Analysis CSV</button>}
      />
      <div className="p-8">
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-lg border border-border-subtle p-1 text-sm">
              <button onClick={() => setTab('current')} className={`rounded-md px-3 py-1.5 font-medium ${tab === 'current' ? 'bg-brand-600 text-white' : 'text-navy-600'}`}>Current-period ({ws.campaigns.filter((c) => c.isCurrentPeriod).length})</button>
              <button onClick={() => setTab('historical')} className={`rounded-md px-3 py-1.5 font-medium ${tab === 'historical' ? 'bg-brand-600 text-white' : 'text-navy-600'}`}>Historical ({ws.campaigns.filter((c) => !c.isCurrentPeriod).length})</button>
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search campaign or product…"
              className="w-64 rounded-lg border border-border-subtle px-3 py-1.5 text-sm"
            />
          </div>

          <Table>
            <thead><tr>
              <Th>Campaign</Th><Th>Product</Th><Th>Status</Th><Th>Impr.</Th><Th>Clicks</Th><Th>Spend</Th><Th>Orders</Th><Th>Sales</Th><Th>ACoS</Th><Th>CTR</Th><Th>CPC</Th><Th>CVR</Th><Th>Budget</Th><Th>Recommendation</Th><Th>Risk</Th><Th>Confidence</Th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><Td className="text-navy-500">No campaigns to show. Import a Campaign report on the Dashboard.</Td></tr>}
              {filtered.map((c) => (
                <tr key={c.campaign}>
                  <Td className="max-w-[220px] truncate font-medium text-navy-900">{c.campaign}</Td>
                  <Td>{c.productName ?? <span className="text-negative-600">UNMAPPED</span>}</Td>
                  <Td><Badge tone={c.statusConfidence === 'CURRENT_ACTIVITY_CONFIRMED' ? 'positive' : c.statusConfidence === 'HISTORICAL_ONLY' ? 'neutral' : 'watch'}>{STATUS_LABEL[c.statusConfidence]}</Badge></Td>
                  <Td>{c.impressions.toLocaleString()}</Td>
                  <Td>{c.clicks.toLocaleString()}</Td>
                  <Td>{formatCurrency(c.spend)}</Td>
                  <Td>{c.orders}</Td>
                  <Td>{formatCurrency(c.sales)}</Td>
                  <Td>{formatPercent(c.acos)}</Td>
                  <Td>{formatPercent(c.ctr)}</Td>
                  <Td>{c.cpc !== null ? formatCurrency(c.cpc) : '—'}</Td>
                  <Td>{formatPercent(c.cvr)}</Td>
                  <Td>{c.budget !== null ? formatCurrency(c.budget) : '—'}</Td>
                  <Td className="max-w-[240px] truncate text-xs" title={c.recommendation}>{c.recommendation}</Td>
                  <Td><Badge tone={riskTone(c.risk)}>{c.risk}</Badge></Td>
                  <Td><Badge tone={confidenceTone(c.confidence)}>{c.confidence}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
