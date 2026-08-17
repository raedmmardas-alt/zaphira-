import { useMemo, useState } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { KpiCard } from '../components/ui/KpiCard';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { useWorkspace } from '../state/useWorkspace';
import { useAppStore } from '../state/store';
import { formatCurrency, formatPercent } from '../lib/engine/metrics';
import { computeBreakEvenScenario } from '../lib/engine/scenario';
import { calculateProductEconomics } from '../lib/engine/productEconomicsManual';
import { blankManualEconomics } from '../types';

function numOrNull(v: string): number | null {
  return v.trim() === '' ? null : Number(v);
}

export function ProfitCapital() {
  const ws = useWorkspace();
  const products = useAppStore((s) => s.products);
  const updateProduct = useAppStore((s) => s.updateProduct);
  const productManualEconomics = useAppStore((s) => s.productManualEconomics);
  const updateProductManualEconomics = useAppStore((s) => s.updateProductManualEconomics);
  const [scenarioProductId, setScenarioProductId] = useState<string>('');
  const [additionalSpend, setAdditionalSpend] = useState(10);

  const totalSales = ws.economics.reduce((a, e) => a + e.totalSales, 0);
  const ppcSpend = ws.economics.reduce((a, e) => a + e.ppcSpend, 0);
  const productProfit = ws.economics.reduce((a, e) => a + e.netProfit, 0);
  const tacos = totalSales > 0 ? ppcSpend / totalSales : null;
  const margin = totalSales > 0 ? productProfit / totalSales : null;
  const accountNetProfit = ws.kpis.accountNetProfit;
  const accountDifference = accountNetProfit !== null ? accountNetProfit - productProfit : null;

  const scenarioTargets = useMemo(() => ws.targets.filter((t) => t.isCurrentPeriod && t.productId === scenarioProductId), [ws.targets, scenarioProductId]);
  const scenarioClicks = scenarioTargets.reduce((a, t) => a + t.clicks, 0);
  const scenarioSpend = scenarioTargets.reduce((a, t) => a + t.spend, 0);
  const scenarioOrders = scenarioTargets.reduce((a, t) => a + t.orders, 0);
  const cpc = scenarioClicks > 0 ? scenarioSpend / scenarioClicks : null;
  const conversionRate = scenarioClicks > 0 ? scenarioOrders / scenarioClicks : null;
  const economics = ws.economicsById[scenarioProductId] ?? null;
  const contributionMarginPerOrder = economics && economics.orders > 0 ? economics.contributionBeforeAds / economics.orders : null;

  const scenario = computeBreakEvenScenario({ additionalSpend, cpc, conversionRate, contributionMarginPerOrder });

  return (
    <div>
      <PageHeader title="Profit & Capital" subtitle="Financial decision screen — where capital is working and where it isn't." />
      <div className="space-y-6 p-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard label="Total Sales" value={formatCurrency(totalSales)} />
          <KpiCard label="PPC Spend" value={formatCurrency(ppcSpend)} />
          <KpiCard label="Product Profit" value={formatCurrency(productProfit)} tone={productProfit >= 0 ? 'positive' : 'negative'} />
          <KpiCard label="Account Net Profit" value={accountNetProfit !== null ? formatCurrency(accountNetProfit) : '—'} sublabel={accountNetProfit === null ? 'Not set for this period' : undefined} />
          <KpiCard label="TACoS" value={formatPercent(tacos)} sublabel="PPC spend / total sales" />
          <KpiCard label="Margin" value={formatPercent(margin)} />
          <KpiCard
            label="Account Reconciliation"
            value={accountDifference !== null ? formatCurrency(accountDifference) : '—'}
            sublabel="Account net profit − product profit (fees/adjustments)"
            tone={accountDifference !== null ? (accountDifference >= 0 ? 'positive' : 'negative') : 'neutral'}
          />
        </div>

        <Card
          title="Product Economics"
          subtitle="Manual per-order inputs. Amazon Fees are never assumed — enter and confirm them for each product before its economics count as complete."
        >
          <Table>
            <thead>
              <tr>
                <Th>Product</Th><Th>Selling Price</Th><Th>COGS</Th><Th>Amazon Fees</Th><Th>Confirmed?</Th><Th>Seller-Funded Discount</Th><Th>Target Profit/Order</Th>
                <Th>Contribution Before Ads</Th><Th>Break-even CPA</Th><Th>Break-even ACoS</Th><Th>Max CPA (Target)</Th><Th>Target ACoS</Th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const inputs = productManualEconomics[p.id] ?? blankManualEconomics(p.id);
                const result = calculateProductEconomics(p, inputs);
                return (
                  <tr key={p.id}>
                    <Td className="font-medium text-navy-900">{p.name}</Td>
                    <Td>
                      <input
                        defaultValue={p.sellingPrice ?? ''}
                        type="number"
                        step="0.01"
                        onBlur={(e) => updateProduct(p.id, { sellingPrice: numOrNull(e.target.value) })}
                        className="w-20 rounded border border-transparent px-1 py-0.5 hover:border-border-subtle focus:border-border-subtle"
                      />
                    </Td>
                    <Td>
                      <input
                        defaultValue={inputs.cogs ?? ''}
                        type="number"
                        step="0.01"
                        onBlur={(e) => updateProductManualEconomics(p.id, { cogs: numOrNull(e.target.value) })}
                        className="w-20 rounded border border-transparent px-1 py-0.5 hover:border-border-subtle focus:border-border-subtle"
                      />
                    </Td>
                    <Td>
                      <input
                        defaultValue={inputs.amazonFees ?? ''}
                        type="number"
                        step="0.01"
                        placeholder="required"
                        onBlur={(e) => updateProductManualEconomics(p.id, { amazonFees: numOrNull(e.target.value) })}
                        className="w-20 rounded border border-transparent px-1 py-0.5 placeholder:text-negative-600/60 hover:border-border-subtle focus:border-border-subtle"
                      />
                    </Td>
                    <Td>
                      <input
                        type="checkbox"
                        checked={inputs.amazonFeesConfirmed}
                        disabled={inputs.amazonFees === null}
                        onChange={(e) => updateProductManualEconomics(p.id, { amazonFeesConfirmed: e.target.checked })}
                      />
                    </Td>
                    <Td>
                      <input
                        defaultValue={inputs.sellerFundedDiscount ?? 0}
                        type="number"
                        step="0.01"
                        onBlur={(e) => updateProductManualEconomics(p.id, { sellerFundedDiscount: numOrNull(e.target.value) ?? 0 })}
                        className="w-20 rounded border border-transparent px-1 py-0.5 hover:border-border-subtle focus:border-border-subtle"
                      />
                    </Td>
                    <Td>
                      <input
                        defaultValue={inputs.targetProfitPerOrder ?? ''}
                        type="number"
                        step="0.01"
                        placeholder="optional"
                        onBlur={(e) => updateProductManualEconomics(p.id, { targetProfitPerOrder: numOrNull(e.target.value) })}
                        className="w-20 rounded border border-transparent px-1 py-0.5 hover:border-border-subtle focus:border-border-subtle"
                      />
                    </Td>
                    {!result.complete ? (
                      <Td colSpan={5}><Badge tone="watch">Economics incomplete</Badge> <span className="ml-1 text-xs text-navy-500">Missing: {result.missingFields.join(', ')}</span></Td>
                    ) : (
                      <>
                        <Td className={result.contributionBeforeAdvertising! >= 0 ? '' : 'text-negative-600'}>{formatCurrency(result.contributionBeforeAdvertising)}</Td>
                        <Td className={result.breakEvenCpa! >= 0 ? '' : 'text-negative-600'}>{formatCurrency(result.breakEvenCpa)}</Td>
                        <Td className={result.breakEvenAcos !== null && result.breakEvenAcos < 0 ? 'text-negative-600' : ''}>{formatPercent(result.breakEvenAcos)}</Td>
                        <Td>{result.maxCpaForTargetProfit !== null ? formatCurrency(result.maxCpaForTargetProfit) : <span className="text-xs text-navy-400">Set target profit</span>}</Td>
                        <Td>{result.targetAcos !== null ? formatPercent(result.targetAcos) : <span className="text-xs text-navy-400">Set target profit</span>}</Td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <Card title="Break-even ACoS by SKU / PPC Investment by Product">
          <Table>
            <thead><tr><Th>Product</Th><Th>ASIN</Th><Th>SKU</Th><Th>Sales</Th><Th>PPC Spend</Th><Th>Net Profit</Th><Th>Margin</Th><Th>Real ACoS</Th><Th>Break-even ACoS</Th></tr></thead>
            <tbody>
              {ws.economics.length === 0 && <tr><Td className="text-navy-500">Import a Sellerboard Product Profitability report to populate this table.</Td></tr>}
              {ws.economics.map((e) => {
                const product = products.find((p) => p.id === e.productId);
                return (
                  <tr key={`${e.marketplace}-${e.asin}-${e.sku}`}>
                    <Td className="font-medium text-navy-900">{product?.name ?? <span className="text-negative-600">UNMAPPED</span>}</Td>
                    <Td className="text-xs">{e.asin}</Td>
                    <Td className="text-xs">{e.sku}</Td>
                    <Td>{formatCurrency(e.totalSales)}</Td>
                    <Td>{formatCurrency(e.ppcSpend)}</Td>
                    <Td className={e.netProfit >= 0 ? 'text-positive-600' : 'text-negative-600'}>{formatCurrency(e.netProfit)}</Td>
                    <Td>{formatPercent(e.margin)}</Td>
                    <Td>{formatPercent(e.realAcos)}</Td>
                    <Td>{formatPercent(e.breakEvenAcos)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <Card title="Scenario Calculator" subtitle="If I spend another $X on this SKU, what conversion performance is required to break even? Estimate only.">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-navy-600">Product</label>
              <select value={scenarioProductId} onChange={(e) => setScenarioProductId(e.target.value)} className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm">
                <option value="">Select…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-navy-600">Additional spend ($)</label>
              <input type="number" min={1} value={additionalSpend} onChange={(e) => setAdditionalSpend(Number(e.target.value))} className="w-28 rounded-lg border border-border-subtle px-3 py-1.5 text-sm" />
            </div>
          </div>
          {scenarioProductId && (
            <div className="mt-4 rounded-lg border border-border-subtle p-4 text-sm">
              <div className="mb-2 inline-block rounded bg-watch-50 px-2 py-0.5 text-xs font-semibold text-watch-600">ESTIMATE ONLY</div>
              <p className="text-navy-700">{scenario.explanation}</p>
              {scenario.feasible !== 'UNKNOWN' && (
                <p className="mt-2 text-xs font-medium text-navy-600">
                  Compared to current conversion rate ({formatPercent(scenario.currentConversionRate)}), this looks{' '}
                  <span className={scenario.feasible === 'LIKELY' ? 'text-positive-600' : scenario.feasible === 'UNLIKELY' ? 'text-negative-600' : 'text-watch-600'}>{scenario.feasible.toLowerCase()}</span>.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
