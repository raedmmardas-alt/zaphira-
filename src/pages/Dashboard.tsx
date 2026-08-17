import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { KpiCard } from '../components/ui/KpiCard';
import { Badge, actionTone, riskTone } from '../components/ui/Badge';
import { AlignmentBanner } from '../components/AlignmentBanner';
import { ReportCoverage } from '../components/ReportCoverage';
import { useWorkspace } from '../state/useWorkspace';
import { useAppStore } from '../state/store';
import { computeCpc, computeCtr, formatCurrency, formatNumber, formatPercent } from '../lib/engine/metrics';
import { STRATEGY_LABEL } from '../lib/engine/strategy';
import { rankNextDollarCandidates } from '../lib/engine/nextDollar';
import { calculateProductEconomics } from '../lib/engine/productEconomicsManual';
import { blankManualEconomics } from '../types';

export function Dashboard() {
  const ws = useWorkspace();
  const settings = useAppStore((s) => s.settings);
  const products = useAppStore((s) => s.products);
  const productManualEconomics = useAppStore((s) => s.productManualEconomics);

  const currentTargets = ws.targets.filter((t) => t.isCurrentPeriod);
  const attentionItems = currentTargets
    .filter((t) => t.action.risk === 'HIGH' || t.action.risk === 'BLOCKED')
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8);

  const recommendedActions = currentTargets
    .filter((t) => ['SCALE', 'REDUCE_BID', 'NEGATIVE_PAUSE_CANDIDATE'].includes(t.action.action))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8);

  const historicalWinners = ws.searchTerms
    .filter((s) => s.classification === 'HISTORICAL_WINNER' || s.classification === 'HISTORICAL_PROMISING')
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 8);

  const nextDollar = rankNextDollarCandidates(ws.targets, ws.economicsById, settings.maxDailyPpcBudget);

  const chartData = ws.economics.map((e) => {
    const product = products.find((p) => p.id === e.productId);
    return {
      name: product?.name ?? `${e.asin || e.sku}`,
      realAcos: e.realAcos !== null ? +(e.realAcos * 100).toFixed(1) : 0,
      breakEven: e.breakEvenAcos !== null ? +(e.breakEvenAcos * 100).toFixed(1) : 0,
      profitable: e.realAcos !== null && e.breakEvenAcos !== null ? e.realAcos <= e.breakEvenAcos : null,
      hasData: e.realAcos !== null,
    };
  });

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Where should the next advertising dollar go for profitable growth?" />
      <div className="space-y-6 p-8">
        <AlignmentBanner alignment={ws.alignment} />

        {/* 1. Business Overview */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-navy-700">Business Overview</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <KpiCard label="Impressions" value={formatNumber(ws.kpis.impressions)} />
            <KpiCard label="Clicks" value={formatNumber(ws.kpis.clicks)} />
            <KpiCard label="CTR" value={formatPercent(computeCtr(ws.kpis.clicks, ws.kpis.impressions), 2)} />
            <KpiCard label="Average CPC" value={formatCurrency(computeCpc(ws.kpis.ppcSpend, ws.kpis.clicks))} />
            <KpiCard label="Attributed Sales" value={formatCurrency(ws.kpis.attributedSales)} />
            <KpiCard label="PPC Spend" value={formatCurrency(ws.kpis.ppcSpend)} />
            <KpiCard label="Orders" value={ws.kpis.orders.toLocaleString()} />
            <KpiCard
              label="ACoS"
              value={formatPercent(ws.kpis.acos)}
              sublabel={ws.kpis.acos === null ? (ws.kpis.ppcSpend > 0 ? 'No ad sales' : undefined) : undefined}
              tone={ws.kpis.acos !== null && ws.kpis.acos > settings.targetAcosDefault ? 'negative' : undefined}
            />
            <KpiCard label="Product Profit" value={formatCurrency(ws.kpis.productProfit)} tone={ws.kpis.productProfit !== null ? (ws.kpis.productProfit >= 0 ? 'positive' : 'negative') : 'neutral'} />
            <KpiCard
              label="Account Net Profit"
              value={ws.kpis.accountNetProfit !== null ? formatCurrency(ws.kpis.accountNetProfit) : '—'}
              sublabel={ws.kpis.accountNetProfit === null ? 'Not set for this period' : 'Set in Settings, period-specific'}
              tone={ws.kpis.accountNetProfit !== null ? (ws.kpis.accountNetProfit >= 0 ? 'positive' : 'negative') : 'neutral'}
            />
          </div>
        </section>

        {/* 2. Product Performance */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-navy-700">Product Performance</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {ws.economics.length === 0 && (
              <Card className="lg:col-span-4"><p className="text-sm text-navy-500">Import a Sellerboard Product Profitability report to see product economics.</p></Card>
            )}
            {ws.economics.map((e) => {
              const product = products.find((p) => p.id === e.productId);
              const strategy = ws.strategies.find((s) => s.productId === e.productId);
              const manualInputs = product ? productManualEconomics[product.id] ?? blankManualEconomics(product.id) : null;
              const manualResult = product && manualInputs ? calculateProductEconomics(product, manualInputs) : null;
              return (
                <Card key={`${e.marketplace}-${e.asin}-${e.sku}`}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-navy-900">{product?.name ?? e.asin ?? e.sku ?? 'Unmapped'}</div>
                    {strategy && <Badge tone={strategy.strategy === 'GROW_CAREFULLY' ? 'positive' : strategy.strategy === 'REDUCE_WASTE' ? 'negative' : strategy.strategy === 'FIX_ECONOMICS' ? 'watch' : 'neutral'}>{STRATEGY_LABEL[strategy.strategy]}</Badge>}
                  </div>
                  {!product && <div className="mt-1 text-xs text-negative-600">PRODUCT MAPPING REQUIRED</div>}
                  <div className="mt-3 space-y-1 text-xs text-navy-600">
                    <div className="flex justify-between"><span>Sales</span><span className="font-medium text-navy-900">{formatCurrency(e.totalSales)}</span></div>
                    <div className="flex justify-between"><span>PPC Spend</span><span className="font-medium text-navy-900">{formatCurrency(e.ppcSpend)}</span></div>
                    <div className="flex justify-between"><span>Net Profit</span><span className={`font-medium ${e.netProfit >= 0 ? 'text-positive-600' : 'text-negative-600'}`}>{formatCurrency(e.netProfit)}</span></div>
                    <div className="flex justify-between"><span>Real ACoS</span><span className="font-medium text-navy-900">{formatPercent(e.realAcos)}</span></div>
                    <div className="flex justify-between"><span>Break-even ACoS</span><span className="font-medium text-navy-900">{formatPercent(e.breakEvenAcos)}</span></div>
                  </div>
                  <div className="mt-3 space-y-1 border-t border-border-subtle pt-2 text-xs text-navy-600">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-navy-400">Manual Product Economics</div>
                    {manualResult?.complete ? (
                      <>
                        <div className="flex justify-between"><span>Break-even ACoS (manual)</span><span className="font-medium text-navy-900">{formatPercent(manualResult.breakEvenAcos)}</span></div>
                        <div className="flex justify-between"><span>Target ACoS (manual)</span><span className="font-medium text-navy-900">{manualResult.targetAcos !== null ? formatPercent(manualResult.targetAcos) : 'Set target profit'}</span></div>
                      </>
                    ) : (
                      <div className="text-navy-400">Economics incomplete{manualResult ? ` — missing: ${manualResult.missingFields.join(', ')}` : ''}</div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        {/* 3. Performance Overview chart */}
        <section>
          <Card title="Real ACoS vs Product Break-even">
            {chartData.length === 0 ? (
              <p className="text-sm text-navy-500">No product economics yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ec" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="breakEven" fill="#94a3b8" name="Break-even ACoS" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="realAcos" name="Real ACoS" radius={[4, 4, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={!d.hasData ? '#cbd5e1' : d.profitable ? '#1c8a5b' : '#cc3b3b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* 4. Recommended Actions */}
          <Card title="Recommended Actions" subtitle="Highest-spend current-period targets with a suggested change">
            {recommendedActions.length === 0 ? <p className="text-sm text-navy-500">No current-period targets need a bid change right now.</p> : (
              <ul className="space-y-2">
                {recommendedActions.map((t) => (
                  <li key={t.key} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-navy-900">{t.targetingText}</div>
                      <div className="truncate text-xs text-navy-500">{t.productName ?? 'Unmapped'} · {t.campaign}</div>
                    </div>
                    <Badge tone={actionTone(t.action.action)}>{t.action.action.replace(/_/g, ' ')}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* 5. What Needs Attention */}
          <Card title="What Needs Attention" subtitle="High risk or blocked current-period targets">
            {attentionItems.length === 0 ? <p className="text-sm text-navy-500">Nothing flagged as high risk right now.</p> : (
              <ul className="space-y-2">
                {attentionItems.map((t) => (
                  <li key={t.key} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-navy-900">{t.targetingText}</div>
                      <div className="truncate text-xs text-navy-500">{t.action.reason}</div>
                    </div>
                    <Badge tone={riskTone(t.action.risk)}>{t.action.risk}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* 6. Where should the next $10 go */}
        <Card title="Where Should the Next $10 Go?">
          {nextDollar.hold ? (
            <div className="rounded-lg bg-wait-50 p-4 text-sm font-medium text-wait-600">HOLD THE NEXT $10 — {nextDollar.holdReason}</div>
          ) : (
            <div className="space-y-3">
              {nextDollar.candidates.slice(0, 3).map((c, i) => (
                <div key={c.target.key} className="rounded-lg border border-border-subtle p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-navy-900">#{i + 1} {c.target.targetingText} — {c.target.productName}</div>
                    <Badge tone={riskTone(c.expectedRisk)}>{c.expectedRisk} risk</Badge>
                  </div>
                  <div className="mt-1 text-xs text-navy-600">{c.reason}</div>
                  <div className="mt-1 text-xs font-medium text-brand-700">Recommended incremental budget: {formatCurrency(c.recommendedIncrementalBudget)}</div>
                  <div className="mt-1 text-[11px] text-navy-500">{c.evidence.join(' · ')}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* 7. PPC Health */}
          <Card title="PPC Health">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span className="text-navy-600">Data reconciliation</span><Badge tone={ws.reconciliation.status === 'DATA_RECONCILED' ? 'positive' : ws.reconciliation.status === 'SMALL_ATTRIBUTION_DIFFERENCE' ? 'watch' : 'negative'}>{ws.reconciliation.status.replace(/_/g, ' ')}</Badge></div>
              <div className="flex items-center justify-between"><span className="text-navy-600">Current-period clicks</span><span className="font-medium text-navy-900">{formatNumber(ws.kpis.clicks)}</span></div>
              <div className="flex items-center justify-between"><span className="text-navy-600">Current-period targets</span><span className="font-medium text-navy-900">{currentTargets.length}</span></div>
              <div className="flex items-center justify-between"><span className="text-navy-600">No/Low delivery</span><span className="font-medium text-navy-900">{currentTargets.filter((t) => t.delivery === 'NO_DELIVERY' || t.delivery === 'LOW_DELIVERY').length}</span></div>
              <div className="flex items-center justify-between"><span className="text-navy-600">Blocked (mapping required)</span><span className="font-medium text-negative-600">{currentTargets.filter((t) => t.action.risk === 'BLOCKED').length}</span></div>
            </div>
          </Card>

          {/* 8. Historical Opportunities */}
          <Card title="Historical Opportunities" subtitle="Winning or promising historical search terms">
            {historicalWinners.length === 0 ? <p className="text-sm text-navy-500">No historical winners identified yet.</p> : (
              <ul className="space-y-2">
                {historicalWinners.map((s, i) => (
                  <li key={`${s.searchTerm}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-navy-900">{s.searchTerm}</div>
                      <div className="truncate text-xs text-navy-500">{s.productName ?? 'Unmapped'} · {s.orders} orders · {formatPercent(s.acos)}</div>
                    </div>
                    <Badge tone={s.classification === 'HISTORICAL_WINNER' ? 'positive' : 'watch'}>{s.classification.replace(/_/g, ' ')}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* 9. Data Status */}
        <ReportCoverage />
      </div>
    </div>
  );
}
