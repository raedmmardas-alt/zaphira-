import { useMemo, useState } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge, confidenceTone, decisionActionTone, deliveryTone, riskClassificationTone } from '../components/ui/Badge';
import { useWorkspace } from '../state/useWorkspace';
import { useAppStore } from '../state/store';
import { formatCurrency, formatMatchType, formatMultiplier, formatNumber, formatPercent } from '../lib/engine/metrics';
import { calculateProductEconomics } from '../lib/engine/productEconomicsManual';
import { computeRisk } from '../lib/engine/riskEngine';
import { deriveCampaignDecisionAction, deriveTargetDecisionAction, findSearchTermNegativeCandidates } from '../lib/engine/actionEngine';
import { classifyDelivery, DELIVERY_LABEL } from '../lib/engine/delivery';
import { forecastAllHorizons } from '../lib/engine/forecastEngine';
import { buildVariantIntelligence } from '../lib/engine/variantIntelligence';
import { rankNextDollarCandidates } from '../lib/engine/nextDollar';
import { daysBetween } from '../lib/parse/dateUtils';
import { blankManualEconomics } from '../types';
import type { DecisionAction, ForecastHorizon } from '../types';

const ACTION_LABEL: Record<string, string> = {
  SCALE: 'Scale', INCREASE_BID: 'Increase Bid', KEEP: 'Keep', WATCH: 'Watch', HOLD_COLLECT_DATA: 'Hold / Collect Data',
  REDUCE_BID: 'Reduce Bid', PAUSE: 'Pause', TEST_IN_PHRASE: 'Test in Phrase', MOVE_TO_EXACT: 'Move to Exact',
  ADD_NEGATIVE: 'Add Negative', INCREASE_BUDGET: 'Increase Budget', REDUCE_BUDGET: 'Reduce Budget',
};

const CONFIDENCE_WEIGHT: Record<string, number> = { HIGH: 1, MEDIUM: 0.6, LOW: 0.3 };
const HORIZON_LABEL: Record<ForecastHorizon, string> = { NEXT_3_DAYS: 'Next 3 Days', NEXT_7_DAYS: 'Next 7 Days', NEXT_30_DAYS: 'Next 30 Days' };

// Monitoring priority for early-stage actions that don't yet have a dollar
// estimatedImpact (no orders/sales to estimate from) — driven by spend-at-
// risk and overall risk score, so higher-spend, higher-risk zero-order
// targets still surface at the top of "What should I do today?" instead of
// the section going empty just because nothing qualifies for SCALE/REDUCE.
function priorityScore(a: DecisionAction): number {
  if (a.estimatedImpact !== 0) return Math.abs(a.estimatedImpact) * (CONFIDENCE_WEIGHT[a.confidence] ?? 0.3);
  // No dollar estimate yet (no orders/sales to base one on) — fall back to
  // dollars-at-stake weighted by risk, so higher-spend, higher-risk
  // zero-order targets still surface near the top.
  return a.currentPerformance.spend * (a.risk.overallScore / 100);
}

function hasCurrentActivity(a: DecisionAction): boolean {
  return a.currentPerformance.impressions > 0 || a.currentPerformance.clicks > 0 || a.currentPerformance.spend > 0;
}

// Campaign cards summarize; the actionable recommendation lives on the
// keyword/target card(s) underneath. Ranking a campaign card alongside its
// own child target cards for the same underlying "0 orders, some spend"
// situation would double-count the same fact and crowd out other
// campaigns/targets that actually need attention. A campaign only earns a
// ranked slot when it carries a genuinely campaign-level signal that no
// target card would show: a real budget decision, or being blocked on
// product mapping (which applies account-wide, not per-keyword).
function isRankable(a: DecisionAction): boolean {
  if (!hasCurrentActivity(a)) return false;
  if (a.scope === 'CAMPAIGN') {
    return a.action === 'INCREASE_BUDGET' || a.action === 'REDUCE_BUDGET' || a.productId === null;
  }
  return true;
}

export function DecisionCenter() {
  const ws = useWorkspace();
  const settings = useAppStore((s) => s.settings);
  const products = useAppStore((s) => s.products);
  const productManualEconomics = useAppStore((s) => s.productManualEconomics);
  const saveShadowSnapshotBatch = useAppStore((s) => s.saveShadowSnapshotBatch);
  const [forecastProductId, setForecastProductId] = useState('');

  const manualResults = useMemo(() => {
    const map: Record<string, ReturnType<typeof calculateProductEconomics>> = {};
    for (const p of products) map[p.id] = calculateProductEconomics(p, productManualEconomics[p.id] ?? blankManualEconomics(p.id));
    return map;
  }, [products, productManualEconomics]);

  function resolveBreakEven(productId: string | null): number | null {
    if (!productId) return null;
    const sellerboard = ws.economicsById[productId]?.breakEvenAcos;
    if (sellerboard !== null && sellerboard !== undefined) return sellerboard;
    const manual = manualResults[productId];
    return manual?.complete ? manual.breakEvenAcos : null;
  }

  // --- Target-level decisions ---
  const targetDecisions = useMemo(() => {
    return ws.targets
      .filter((t) => t.isCurrentPeriod)
      .map((t) => {
        const breakEven = resolveBreakEven(t.productId);
        const manualEconomics = t.productId ? manualResults[t.productId] ?? null : null;
        const risk = computeRisk({
          clicks: t.clicks, orders: t.orders, spend: t.spend, acos: t.acos, delivery: t.delivery,
          mappingConfident: t.productId !== null,
          productEconomics: t.productId ? ws.economicsById[t.productId] ?? null : null,
          manualEconomics,
          settings,
        });
        return deriveTargetDecisionAction(t, risk, breakEven, settings, manualEconomics);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.targets, ws.economicsById, manualResults, settings]);

  // --- Campaign-level (budget) decisions ---
  const campaignDecisions = useMemo(() => {
    return ws.campaigns
      .filter((c) => c.isCurrentPeriod)
      .map((c) => {
        const breakEven = resolveBreakEven(c.productId);
        const delivery = classifyDelivery(c.impressions, c.clicks, settings.deliveryThresholds);
        const manualEconomics = c.productId ? manualResults[c.productId] ?? null : null;
        const risk = computeRisk({
          clicks: c.clicks, orders: c.orders, spend: c.spend, acos: c.acos, delivery,
          mappingConfident: c.productId !== null,
          productEconomics: c.productId ? ws.economicsById[c.productId] ?? null : null,
          manualEconomics,
          settings,
        });
        return deriveCampaignDecisionAction(c, risk, breakEven, delivery, manualEconomics);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.campaigns, ws.economicsById, manualResults, settings]);

  const negativeCandidates = useMemo(() => findSearchTermNegativeCandidates(ws.searchTerms, settings), [ws.searchTerms, settings]);

  // --- Ranked "what should I do today" list ---
  // Includes both dollar-quantified actions (SCALE/REDUCE/PAUSE etc., which
  // have a nonzero estimatedImpact) and early-stage monitoring actions that
  // don't have enough conversions for a dollar estimate yet — so this list
  // stays useful even in a zero-order period, instead of going empty just
  // because nothing qualifies for scaling. Campaign-scope entries are
  // excluded unless they carry a genuine budget-level signal, so a
  // campaign's card never just restates its own child target card.
  const rankedActions = useMemo(() => {
    const all: DecisionAction[] = [...targetDecisions, ...campaignDecisions];
    const actionable = all.filter(isRankable);
    return actionable
      .sort((a, b) => priorityScore(b) - priorityScore(a))
      .slice(0, 10);
  }, [targetDecisions, campaignDecisions]);

  // --- Risk score per product, for variant intelligence ---
  const riskScoreByTargetKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of targetDecisions) map[d.key] = d.risk.overallScore;
    return map;
  }, [targetDecisions]);

  const riskScoreByProductId = useMemo(() => {
    const sums: Record<string, { total: number; count: number }> = {};
    for (const d of targetDecisions) {
      if (!d.productId) continue;
      const entry = sums[d.productId] ?? { total: 0, count: 0 };
      entry.total += d.risk.overallScore;
      entry.count += 1;
      sums[d.productId] = entry;
    }
    const result: Record<string, number> = {};
    for (const [id, { total, count }] of Object.entries(sums)) result[id] = Math.round(total / count);
    return result;
  }, [targetDecisions]);

  const nextDollar = rankNextDollarCandidates(ws.targets, ws.economicsById, settings.maxDailyPpcBudget, riskScoreByTargetKey);

  // --- Variant Intelligence ---
  const productPerformanceRows = useMemo(() => {
    return products.map((p) => {
      const rows = ws.campaigns.filter((c) => c.isCurrentPeriod && c.productId === p.id);
      const impressions = rows.reduce((a, c) => a + c.impressions, 0);
      const clicks = rows.reduce((a, c) => a + c.clicks, 0);
      const spend = rows.reduce((a, c) => a + c.spend, 0);
      const orders = rows.reduce((a, c) => a + c.orders, 0);
      const sales = rows.reduce((a, c) => a + c.sales, 0);
      return {
        productId: p.id, productName: p.name, asin: p.asin, impressions, clicks, spend, orders, sales,
        cpc: clicks > 0 ? spend / clicks : null,
        acos: sales > 0 ? spend / sales : null,
        roas: spend > 0 ? sales / spend : null,
      };
    });
  }, [products, ws.campaigns]);

  const variantIntelligence = useMemo(
    () => buildVariantIntelligence(productPerformanceRows, ws.economicsById, riskScoreByProductId),
    [productPerformanceRows, ws.economicsById, riskScoreByProductId],
  );

  // --- Forecast (per product) ---
  const observedDays = ws.currentPeriod ? daysBetween(ws.currentPeriod.start, ws.currentPeriod.end) + 1 : 0;
  const forecastProduct = productPerformanceRows.find((r) => r.productId === forecastProductId) ?? null;
  const forecasts = forecastProduct
    ? forecastAllHorizons({
        observedDays, spend: forecastProduct.spend, clicks: forecastProduct.clicks, orders: forecastProduct.orders,
        sales: forecastProduct.sales, manualEconomics: manualResults[forecastProduct.productId] ?? null,
      })
    : null;

  function saveActionsAsShadowSnapshots() {
    if (!ws.currentPeriod) return;
    const savedAt = new Date().toISOString();
    const currentTargetsByKey = new Map(ws.targets.filter((t) => t.isCurrentPeriod).map((t) => [t.key, t]));
    const snapshots = rankedActions
      .filter((a) => a.scope === 'TARGET')
      .map((a) => currentTargetsByKey.get(a.key))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({
        id: crypto.randomUUID(), savedAt, reportPeriod: ws.currentPeriod, targetKey: t.key, targetingText: t.targetingText,
        matchType: t.matchType, productId: t.productId, productName: t.productName, asin: t.asin, campaign: t.campaign,
        adGroup: t.adGroup, currentBid: t.currentBid, recommendedAction: t.action.action, recommendedBid: t.action.recommendedBid,
        risk: t.action.risk, confidence: t.action.confidence, delivery: t.delivery,
        beforeMetrics: { impressions: t.impressions, clicks: t.clicks, spend: t.spend, orders: t.orders, sales: t.sales, acos: t.acos, cvr: t.cvr },
        appliedManually: false, appliedAt: null, status: 'PENDING' as const, statusUpdatedAt: null,
      }));
    if (snapshots.length > 0) saveShadowSnapshotBatch(snapshots);
  }

  return (
    <div>
      <PageHeader title="Decision Center" subtitle="Recommendation-only. Zaphira never changes Amazon campaigns automatically." />
      <div className="space-y-6 p-8">
        <Card className="border-brand-600/20 bg-brand-600/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-navy-900">WHAT SHOULD I DO TODAY?</h1>
              <p className="mt-1 text-sm text-navy-600">
                The {rankedActions.length} highest-impact, risk-weighted actions across your current-period campaigns and keywords — ranked so you don't have to read a table.
              </p>
            </div>
            {rankedActions.length > 0 && (
              <button onClick={saveActionsAsShadowSnapshots} className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Save These as a Shadow Snapshot
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-navy-500">
            "Current bid" reflects the most recently uploaded report, not a live Amazon pull — Zaphira has no Amazon API connection. Verify against Seller Central before changing anything.
          </p>
        </Card>

        {rankedActions.length === 0 ? (
          <Card>
            <p className="text-sm text-navy-500">No current-period impressions, clicks, or spend recorded yet for any campaign or keyword — upload current Amazon Ads reports to see monitoring and scaling actions here.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {rankedActions.map((a, i) => (
              <Card key={`${a.scope}-${a.key}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-navy-400">
                      #{i + 1} · {a.productName ?? 'Unmapped product'} {a.scope === 'CAMPAIGN' && <span className="text-navy-300">· CAMPAIGN SUMMARY</span>}
                    </div>
                    <div className="truncate text-sm font-semibold text-navy-900">
                      {a.scope === 'TARGET' ? `${a.targetingText} (${formatMatchType(a.matchType)})` : a.campaign}
                    </div>
                    {a.scope === 'TARGET' && <div className="truncate text-xs text-navy-500">{a.campaign} · {a.adGroup || '—'}</div>}
                  </div>
                  <Badge tone={decisionActionTone(a.action)}>{ACTION_LABEL[a.action]}</Badge>
                </div>

                <div className="mt-2 rounded-lg bg-navy-900/[0.04] px-3 py-1.5 text-xs font-semibold tracking-wide text-navy-800">
                  {a.checkpointLabel}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-navy-600">
                  <div>Impressions <span className="float-right font-medium text-navy-900">{formatNumber(a.currentPerformance.impressions)}</span></div>
                  <div>Clicks <span className="float-right font-medium text-navy-900">{formatNumber(a.currentPerformance.clicks)}</span></div>
                  <div>Spend <span className="float-right font-medium text-navy-900">{formatCurrency(a.currentPerformance.spend)}</span></div>
                  <div>Orders <span className="float-right font-medium text-navy-900">{formatNumber(a.currentPerformance.orders)}</span></div>
                  <div>Sales <span className="float-right font-medium text-navy-900">{formatCurrency(a.currentPerformance.sales)}</span></div>
                  <div>ACoS <span className="float-right font-medium text-navy-900">{formatPercent(a.currentPerformance.acos)}</span></div>
                </div>

                {a.scope === 'TARGET' ? (
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border-subtle pt-2 text-xs text-navy-600">
                    <div>
                      Remaining to Target CPA Review
                      <span className="float-right font-medium text-navy-900">
                        {a.remainingToTargetCpaReview !== null ? formatCurrency(a.remainingToTargetCpaReview) : a.currentPerformance.orders > 0 ? 'N/A (has orders)' : 'Set target profit'}
                      </span>
                    </div>
                    <div>
                      Remaining to Break-even Stop
                      <span className="float-right font-medium text-navy-900">
                        {a.remainingToBreakEvenStop !== null ? formatCurrency(a.remainingToBreakEvenStop) : a.currentPerformance.orders > 0 ? 'N/A (has orders)' : 'Economics incomplete'}
                      </span>
                    </div>
                    <div>Traffic / Delivery <span className="float-right font-medium text-navy-900">{DELIVERY_LABEL[a.delivery]}</span></div>
                    <div>Conversion Evidence <span className="float-right font-medium text-navy-900">{a.conversionEvidence}</span></div>
                  </div>
                ) : (
                  <div className="mt-3 border-t border-border-subtle pt-2 text-xs text-navy-500">
                    Campaign-level budget summary — the specific recommendation for this campaign's keywords/targets is on their own cards above.
                  </div>
                )}

                {(a.recommendedBid !== null || a.recommendedBudget !== null) && (
                  <div className="mt-3 rounded-lg bg-navy-900/[0.03] px-3 py-2 text-sm font-medium text-navy-900">
                    {a.recommendedBid !== null ? `${formatCurrency(a.currentBid)} → ${formatCurrency(a.recommendedBid)} bid` : `${formatCurrency(a.currentBudget)} → ${formatCurrency(a.recommendedBudget)} budget`}
                  </div>
                )}

                <p className="mt-3 text-xs text-navy-600">{a.reason}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge tone={riskClassificationTone(a.risk.classification)}>{a.risk.classification} RISK ({a.risk.overallScore})</Badge>
                  <Badge tone={confidenceTone(a.confidence)}>{a.confidence} CONFIDENCE</Badge>
                  <Badge tone={deliveryTone(a.delivery)}>{DELIVERY_LABEL[a.delivery]}</Badge>
                  {a.estimatedImpact !== 0 && (
                    <span className={`text-xs font-semibold ${a.estimatedImpact >= 0 ? 'text-positive-600' : 'text-negative-600'}`}>
                      {a.estimatedImpact >= 0 ? '+' : ''}{formatCurrency(a.estimatedImpact)} expected impact
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {negativeCandidates.length > 0 && (
          <Card title="Search Terms to Add as Negative" subtitle="Current-period search terms with meaningful spend and zero conversions.">
            <Table>
              <thead><tr><Th>Search Term</Th><Th>Matched Target</Th><Th>Product</Th><Th>Campaign</Th><Th>Clicks</Th><Th>Spend</Th></tr></thead>
              <tbody>
                {negativeCandidates.map((c, i) => (
                  <tr key={`${c.searchTerm}-${i}`}>
                    <Td className="font-medium text-navy-900">{c.searchTerm}</Td>
                    <Td className="text-xs text-navy-600">{c.matchedTarget}</Td>
                    <Td>{c.productName ?? 'Unmapped'}</Td>
                    <Td className="text-xs text-navy-600">{c.campaign}</Td>
                    <Td>{c.clicks}</Td>
                    <Td>{formatCurrency(c.spend)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}

        <Card title="Where Should the Next $10 Go?" subtitle="Ranked by profitability headroom, conversion evidence, traffic, confidence, and risk.">
          {nextDollar.hold ? (
            <div className="rounded-lg bg-wait-50 p-4 text-sm font-medium text-wait-600">HOLD THE NEXT $10 — {nextDollar.holdReason}</div>
          ) : (
            <div className="space-y-3">
              {nextDollar.candidates.slice(0, 3).map((c, i) => (
                <div key={c.target.key} className="rounded-lg border border-border-subtle p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-navy-900">#{i + 1} {c.target.targetingText} — {c.target.productName}</div>
                    <Badge tone={riskClassificationTone(c.expectedRisk === 'LOW' ? 'LOW' : c.expectedRisk === 'MEDIUM' ? 'MODERATE' : 'HIGH')}>{c.expectedRisk} risk</Badge>
                  </div>
                  <div className="mt-1 text-xs text-navy-600">{c.reason}</div>
                  <div className="mt-1 text-xs font-medium text-brand-700">Recommended incremental budget: {formatCurrency(c.recommendedIncrementalBudget)}</div>
                  <div className="mt-1 text-[11px] text-navy-500">{c.evidence.join(' · ')}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Variant Intelligence" subtitle="Coconut, Rose, Vanilla, and Mango compared head-to-head on current-period data.">
          <Table>
            <thead><tr><Th>Product</Th><Th>Impr.</Th><Th>Clicks</Th><Th>CTR</Th><Th>Orders</Th><Th>CVR</Th><Th>CPA</Th><Th>ACoS</Th><Th>ROAS</Th><Th>Net Profit</Th><Th>Risk</Th></tr></thead>
            <tbody>
              {variantIntelligence.rows.map((r) => (
                <tr key={r.productId}>
                  <Td className="font-medium text-navy-900">
                    {r.productName}
                    {r.productId === variantIntelligence.strongestTraffic && <Badge tone="brand">Traffic</Badge>}
                    {r.productId === variantIntelligence.bestCtr && <Badge tone="positive">Best CTR</Badge>}
                    {r.productId === variantIntelligence.bestConversion && <Badge tone="positive">Best CVR</Badge>}
                    {r.productId === variantIntelligence.bestCpa && <Badge tone="positive">Best CPA</Badge>}
                    {r.productId === variantIntelligence.bestProfitability && <Badge tone="positive">Most Profitable</Badge>}
                    {r.productId === variantIntelligence.strongestScalingOpportunity && <Badge tone="brand">Scale Candidate</Badge>}
                    {r.productId === variantIntelligence.highestRisk && <Badge tone="negative">Highest Risk</Badge>}
                  </Td>
                  <Td>{formatNumber(r.impressions)}</Td>
                  <Td>{formatNumber(r.clicks)}</Td>
                  <Td>{formatPercent(r.ctr, 2)}</Td>
                  <Td>{formatNumber(r.orders)}</Td>
                  <Td>{formatPercent(r.cvr)}</Td>
                  <Td>{formatCurrency(r.cpa)}</Td>
                  <Td>{formatPercent(r.acos)}</Td>
                  <Td>{formatMultiplier(r.roas)}</Td>
                  <Td className={r.netProfit !== null ? (r.netProfit >= 0 ? 'text-positive-600' : 'text-negative-600') : ''}>{r.netProfit !== null ? formatCurrency(r.netProfit) : '—'}</Td>
                  <Td>{r.riskScore !== null ? r.riskScore : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card
          title="Prediction"
          subtitle="Conservative, small-sample forecasts — always a range, never a guarantee."
          actions={
            <select value={forecastProductId} onChange={(e) => setForecastProductId(e.target.value)} className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm">
              <option value="">Select a product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          }
        >
          {!forecasts ? (
            <p className="text-sm text-navy-500">Select a product to see its forecast.</p>
          ) : observedDays < 1 ? (
            <p className="text-sm text-navy-500">No confirmed current period yet — a forecast needs at least one day of observed activity.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {(['NEXT_3_DAYS', 'NEXT_7_DAYS', 'NEXT_30_DAYS'] as ForecastHorizon[]).map((h) => {
                const f = forecasts[h];
                return (
                  <div key={h} className="rounded-lg border border-border-subtle p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-navy-900">{HORIZON_LABEL[h]}</div>
                      <Badge tone={confidenceTone(f.confidence)}>{f.confidence}</Badge>
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-navy-600">
                      <div>Spend <span className="float-right font-medium text-navy-900">{formatCurrency(f.spend.low)}–{formatCurrency(f.spend.high)}</span></div>
                      <div>Clicks <span className="float-right font-medium text-navy-900">{formatNumber(f.clicks.low)}–{formatNumber(f.clicks.high)}</span></div>
                      <div>Orders <span className="float-right font-medium text-navy-900">{formatNumber(f.orders.low)}–{formatNumber(f.orders.high)}</span></div>
                      <div>Sales <span className="float-right font-medium text-navy-900">{formatCurrency(f.sales.low)}–{formatCurrency(f.sales.high)}</span></div>
                      <div>CPA <span className="float-right font-medium text-navy-900">{f.cpa !== null ? formatCurrency(f.cpa) : '—'}</span></div>
                      <div>ACoS <span className="float-right font-medium text-navy-900">{f.acos !== null ? formatPercent(f.acos) : '—'}</span></div>
                      {f.estimatedProfit ? (
                        <div>Est. Profit <span className={`float-right font-medium ${f.estimatedProfit.expected >= 0 ? 'text-positive-600' : 'text-negative-600'}`}>{formatCurrency(f.estimatedProfit.low)} to {formatCurrency(f.estimatedProfit.high)}</span></div>
                      ) : (
                        <div className="text-navy-400">Economics incomplete — no profit estimate</div>
                      )}
                    </div>
                    <div className="mt-2 text-[11px] italic text-navy-400">{f.disclaimer}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
