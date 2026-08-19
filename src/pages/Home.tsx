import { Link } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { KpiCard } from '../components/ui/KpiCard';
import { Badge } from '../components/ui/Badge';
import { useDecisionActions } from '../state/useDecisionActions';
import { useAppStore } from '../state/store';
import { formatCurrency, formatMatchType, formatNumber, formatPercent } from '../lib/engine/metrics';
import { buildProductPerformanceRows } from '../lib/engine/ppcPerformanceSeries';
import { SIMPLE_ACTION_LABEL, SIMPLE_RISK_LABEL, simpleActionTone } from '../lib/engine/simplifiedAction';
import { deriveBudgetGuidance, deriveOverallStatus, deriveProductOverviewStatus, overallStatusLabel, overallStatusTone, productOverviewStatusTone } from '../lib/engine/homeRollups';
import { computeDataFreshness, formatPeriodEndDate, freshnessStatusTone, FRESHNESS_STATUS_LABEL } from '../lib/engine/dataFreshness';

export function Home() {
  const { ws, campaignDecisions, rankedActions, nextDollar } = useDecisionActions();
  const products = useAppStore((s) => s.products);
  const settings = useAppStore((s) => s.settings);

  const overallStatus = deriveOverallStatus(ws.reconciliation.status, rankedActions);
  const budget = deriveBudgetGuidance(campaignDecisions, nextDollar, settings.maxDailyPpcBudget);
  const productRows = buildProductPerformanceRows(ws.campaigns, products);
  const todayActions = rankedActions.slice(0, 6);
  const freshness = ws.currentPeriod ? computeDataFreshness(ws.currentPeriod.end) : null;

  return (
    <div>
      <div className="border-b border-border-subtle bg-surface px-8 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Zaphira PPC Control</h1>
            <p className="mt-1 text-sm text-navy-500">Your Amazon advertising command center</p>
            {freshness && (
              <div className="mt-1.5 flex items-center gap-2 text-xs text-navy-500">
                <span>Data through {formatPeriodEndDate(freshness.periodEnd)}</span>
                <Badge tone={freshnessStatusTone(freshness.status)}>{FRESHNESS_STATUS_LABEL[freshness.status]}</Badge>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-border-subtle bg-canvas px-4 py-2.5">
            <span className="text-xs font-medium uppercase tracking-wide text-navy-500">Overall status</span>
            <Badge tone={overallStatusTone(overallStatus)}>{overallStatusLabel(overallStatus)}</Badge>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-8">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Sales" value={formatCurrency(ws.kpis.attributedSales)} />
          <KpiCard label="PPC Spend" value={formatCurrency(ws.kpis.ppcSpend)} />
          <KpiCard label="Orders" value={formatNumber(ws.kpis.orders)} />
          <KpiCard
            label="Profit"
            value={ws.kpis.productProfit !== null ? formatCurrency(ws.kpis.productProfit) : '—'}
            tone={ws.kpis.productProfit !== null ? (ws.kpis.productProfit >= 0 ? 'positive' : 'negative') : 'neutral'}
          />
          <KpiCard
            label="ACoS"
            value={formatPercent(ws.kpis.acos)}
            sublabel={ws.kpis.acos === null ? (ws.kpis.ppcSpend > 0 ? 'No ad sales' : undefined) : undefined}
          />
          <KpiCard label="Clicks" value={formatNumber(ws.kpis.clicks)} />
        </div>

        {/* What should I do today */}
        <Card
          title="What should I do today?"
          subtitle="Your highest-priority recommendations, ranked automatically. Zaphira never changes Amazon campaigns — you decide."
          actions={<Link to="/optimize" className="text-xs font-medium text-brand-700 hover:underline">See all recommendations →</Link>}
        >
          {todayActions.length === 0 ? (
            <p className="text-sm text-navy-500">No changes recommended today. Keep collecting data.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {todayActions.map((a) => (
                <div key={`${a.scope}-${a.key}`} className="rounded-2xl border border-border-subtle p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-navy-400">{a.productName ?? 'Unmapped'}</div>
                    <Badge tone={simpleActionTone(a.action)}>{SIMPLE_ACTION_LABEL[a.action]}</Badge>
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold text-navy-900">
                    {a.scope === 'TARGET' ? `${a.targetingText} (${formatMatchType(a.matchType)})` : a.campaign}
                  </div>
                  {(a.recommendedBid !== null || a.recommendedBudget !== null) && (
                    <div className="mt-2 rounded-lg bg-navy-900/[0.04] px-2.5 py-1.5 text-sm font-medium text-navy-900">
                      {a.recommendedBid !== null ? `${formatCurrency(a.currentBid)} → ${formatCurrency(a.recommendedBid)}` : `${formatCurrency(a.currentBudget)} → ${formatCurrency(a.recommendedBudget)}`}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-navy-600">{a.reason}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-navy-500">Risk: <span className="font-medium text-navy-800">{SIMPLE_RISK_LABEL[a.risk.classification]}</span></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Budget guidance */}
        <Card title="Recommended PPC Budget">
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-navy-500">Today</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums text-navy-900">{formatCurrency(budget.today)}<span className="text-sm font-normal text-navy-400">/day</span></div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-navy-500">Current</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-navy-600">{formatCurrency(budget.current)}<span className="text-sm font-normal text-navy-400">/day</span></div>
            </div>
            <Badge tone={budget.recommendation === 'Increase' ? 'positive' : budget.recommendation === 'Reduce' ? 'watch' : 'brand'}>{budget.recommendation.toUpperCase()}</Badge>
          </div>
          <p className="mt-3 text-xs text-navy-600">{budget.reason}</p>
        </Card>

        {/* Product overview */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-navy-700">Products</h2>
            <Link to="/advanced" className="text-xs font-medium text-brand-700 hover:underline">Full details →</Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {productRows.map((r) => {
              const strategy = ws.strategies.find((s) => s.productId === r.productId)?.strategy;
              const status = deriveProductOverviewStatus(strategy, r.spend);
              return (
                <Link key={r.productId} to={`/optimize?product=${r.productId}`} className="block rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm transition-colors hover:border-brand-600/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-navy-900">{r.productName}</div>
                    <Badge tone={productOverviewStatusTone(status)}>{status}</Badge>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-navy-600">
                    <div className="flex justify-between"><span>Spend</span><span className="font-medium text-navy-900">{formatCurrency(r.spend)}</span></div>
                    <div className="flex justify-between"><span>Orders</span><span className="font-medium text-navy-900">{formatNumber(r.orders)}</span></div>
                    <div className="flex justify-between"><span>Sales</span><span className="font-medium text-navy-900">{formatCurrency(r.sales)}</span></div>
                    <div className="flex justify-between"><span>ACoS</span><span className="font-medium text-navy-900">{r.acos !== null ? formatPercent(r.acos) : <span className="text-navy-400">{r.spend > 0 ? 'No ad sales' : '—'}</span>}</span></div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
