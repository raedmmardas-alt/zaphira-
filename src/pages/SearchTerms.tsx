import { useMemo, useState } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { SEARCH_TERM_LABEL } from '../lib/engine/searchTerms';
import { useWorkspace } from '../state/useWorkspace';
import { useAppStore } from '../state/store';
import { formatCurrency, formatPercent } from '../lib/engine/metrics';
import { downloadCsv } from '../lib/export/csv';
import { buildKeywordOpportunities } from '../lib/engine/opportunities';

const CLASS_TONE: Record<string, 'positive' | 'watch' | 'negative' | 'neutral' | 'brand'> = {
  CURRENT_SEARCH_TERM: 'brand',
  HISTORICAL_WINNER: 'positive',
  HISTORICAL_PROMISING: 'watch',
  HISTORICAL_INEFFICIENT: 'negative',
  HISTORICAL_INSIGHT: 'neutral',
};

export function SearchTerms() {
  const ws = useWorkspace();
  const products = useAppStore((s) => s.products);
  const reportRows = useAppStore((s) => s.reportRows);
  const manualKeywordHistory = useAppStore((s) => s.manualKeywordHistory);
  const addManualKeyword = useAppStore((s) => s.addManualKeyword);
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newKeyword, setNewKeyword] = useState('');
  const [newProduct, setNewProduct] = useState('');

  const filtered = useMemo(() => {
    return ws.searchTerms.filter((s) => {
      if (classFilter !== 'all' && s.classification !== classFilter) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return s.searchTerm.toLowerCase().includes(q) || (s.productName ?? '').toLowerCase().includes(q);
    });
  }, [ws.searchTerms, query, classFilter]);

  const opportunities = useMemo(
    () => buildKeywordOpportunities(ws.searchTerms, ws.targets, reportRows.sellerboardKeyword, manualKeywordHistory, products),
    [ws.searchTerms, ws.targets, reportRows.sellerboardKeyword, manualKeywordHistory, products],
  );

  function exportSearchTermCsv() {
    downloadCsv(
      'zaphira_search_term_analysis.csv',
      ['Product', 'Campaign', 'Ad Group', 'Search Term', 'Matched Target', 'Match Type', 'Impressions', 'Clicks', 'Orders', 'Sales', 'Spend', 'ACoS', 'Classification'],
      filtered.map((s) => [s.productName ?? 'UNMAPPED', s.campaign, s.adGroup, s.searchTerm, s.targetingText, s.matchType, s.impressions, s.clicks, s.orders, s.sales.toFixed(2), s.spend.toFixed(2), s.acos !== null ? (s.acos * 100).toFixed(2) : '', s.classification]),
    );
  }

  function exportOpportunitiesCsv() {
    const toExport = opportunities.filter((o) => selected.size === 0 || selected.has(o.id));
    downloadCsv(
      'zaphira_add_keywords.csv',
      ['Keyword', 'Product', 'Source', 'Suggested Match Type', 'Suggested Test Bid', 'Historical Orders', 'Historical Sales', 'Historical ACoS', 'Confidence'],
      toExport.map((o) => [o.keyword, o.productName ?? 'UNMAPPED', o.source, o.suggestedMatchType, o.suggestedTestBid ?? '', o.historicalOrders, o.historicalSales.toFixed(2), o.historicalAcos !== null ? (o.historicalAcos * 100).toFixed(2) : '', o.confidence]),
    );
  }

  return (
    <div>
      <PageHeader title="Search Terms" subtitle="Historical rows are intelligence only — they never generate active bid changes." />
      <div className="space-y-6 p-8">
        <Card
          title="Search Term Intelligence"
          actions={<button onClick={exportSearchTermCsv} className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-navy-900/5">Download Search Term Analysis CSV</button>}
        >
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="w-64 rounded-lg border border-border-subtle px-3 py-1.5 text-sm" />
            <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm">
              <option value="all">All classifications</option>
              {Object.entries(SEARCH_TERM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <Table>
            <thead><tr><Th>Product</Th><Th>Search Term</Th><Th>Matched Target</Th><Th>Campaign</Th><Th>Impr.</Th><Th>Clicks</Th><Th>Orders</Th><Th>Sales</Th><Th>Spend</Th><Th>ACoS</Th><Th>Classification</Th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><Td className="text-navy-500">No search term data yet. Import a Search Term report on the Dashboard.</Td></tr>}
              {filtered.slice(0, 500).map((s, i) => (
                <tr key={`${s.searchTerm}-${s.campaign}-${i}`}>
                  <Td>{s.productName ?? <span className="text-negative-600">UNMAPPED</span>}</Td>
                  <Td className="max-w-[240px] truncate font-medium text-navy-900">{s.searchTerm}</Td>
                  <Td className="max-w-[180px] truncate text-xs text-navy-600">{s.targetingText}</Td>
                  <Td className="max-w-[160px] truncate text-xs text-navy-600">{s.campaign}</Td>
                  <Td>{s.impressions.toLocaleString()}</Td>
                  <Td>{s.clicks.toLocaleString()}</Td>
                  <Td>{s.orders}</Td>
                  <Td>{formatCurrency(s.sales)}</Td>
                  <Td>{formatCurrency(s.spend)}</Td>
                  <Td>{formatPercent(s.acos)}</Td>
                  <Td><Badge tone={CLASS_TONE[s.classification]}>{SEARCH_TERM_LABEL[s.classification]}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card
          title="Keyword Opportunities"
          subtitle="Deduplicated against currently targeted keyword/product/match combinations"
          actions={<button onClick={exportOpportunitiesCsv} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">ADD KEYWORDS CSV</button>}
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="Manually add a keyword…" className="w-56 rounded-lg border border-border-subtle px-3 py-1.5 text-sm" />
            <select value={newProduct} onChange={(e) => setNewProduct(e.target.value)} className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm">
              <option value="">Product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button
              onClick={() => { if (newKeyword.trim()) { addManualKeyword(newKeyword.trim(), newProduct || null); setNewKeyword(''); } }}
              className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-navy-900/5"
            >
              Add
            </button>
          </div>
          <Table>
            <thead><tr><Th></Th><Th>Keyword</Th><Th>Product</Th><Th>Source</Th><Th>Hist. Orders</Th><Th>Hist. Sales</Th><Th>Hist. ACoS</Th><Th>Suggested Match</Th><Th>Confidence</Th></tr></thead>
            <tbody>
              {opportunities.length === 0 && <tr><Td className="text-navy-500">No opportunities found yet — needs Search Term or Sellerboard Keyword data.</Td></tr>}
              {opportunities.slice(0, 200).map((o) => (
                <tr key={o.id}>
                  <Td><input type="checkbox" checked={selected.has(o.id)} onChange={(e) => setSelected((prev) => { const n = new Set(prev); if (e.target.checked) n.add(o.id); else n.delete(o.id); return n; })} /></Td>
                  <Td className="font-medium text-navy-900">{o.keyword}</Td>
                  <Td>{o.productName ?? <span className="text-negative-600">Unmapped</span>}</Td>
                  <Td className="text-xs">{o.source.replace(/_/g, ' ')}</Td>
                  <Td>{o.historicalOrders}</Td>
                  <Td>{formatCurrency(o.historicalSales)}</Td>
                  <Td>{formatPercent(o.historicalAcos)}</Td>
                  <Td className="text-xs">{o.suggestedMatchType}</Td>
                  <Td><Badge tone={o.confidence === 'HIGH' ? 'positive' : o.confidence === 'MEDIUM' ? 'watch' : 'wait'}>{o.confidence}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
