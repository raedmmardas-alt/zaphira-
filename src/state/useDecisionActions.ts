// Shared "what should I do" decision-ranking hook. Extracted so the new
// seller-facing Home and Optimize pages can read the exact same underlying
// recommendation engine outputs (computeRisk / deriveTargetDecisionAction /
// deriveCampaignDecisionAction / rankNextDollarCandidates) that the
// technical Decision Center page uses — no PPC logic is duplicated or
// reimplemented, only the memo wiring that calls those existing, unmodified
// engine functions is shared.
import { useMemo } from 'react';
import { useWorkspace } from './useWorkspace';
import { useAppStore } from './store';
import { calculateProductEconomics } from '../lib/engine/productEconomicsManual';
import { computeRisk } from '../lib/engine/riskEngine';
import { deriveCampaignDecisionAction, deriveTargetDecisionAction } from '../lib/engine/actionEngine';
import { classifyDelivery } from '../lib/engine/delivery';
import { rankNextDollarCandidates } from '../lib/engine/nextDollar';
import { blankManualEconomics } from '../types';
import type { DecisionAction } from '../types';

const CONFIDENCE_WEIGHT: Record<string, number> = { HIGH: 1, MEDIUM: 0.6, LOW: 0.3 };

// See DecisionCenter.tsx for the identical rationale behind these two
// helpers — kept in sync deliberately rather than imported, since they are
// small, private ranking helpers, not shared engine logic.
function priorityScore(a: DecisionAction): number {
  if (a.estimatedImpact !== 0) return Math.abs(a.estimatedImpact) * (CONFIDENCE_WEIGHT[a.confidence] ?? 0.3);
  return a.currentPerformance.spend * (a.risk.overallScore / 100);
}

function hasCurrentActivity(a: DecisionAction): boolean {
  return a.currentPerformance.impressions > 0 || a.currentPerformance.clicks > 0 || a.currentPerformance.spend > 0;
}

function isRankable(a: DecisionAction): boolean {
  if (!hasCurrentActivity(a)) return false;
  if (a.scope === 'CAMPAIGN') {
    return a.action === 'INCREASE_BUDGET' || a.action === 'REDUCE_BUDGET' || a.productId === null;
  }
  return true;
}

export function useDecisionActions() {
  const ws = useWorkspace();
  const settings = useAppStore((s) => s.settings);
  const products = useAppStore((s) => s.products);
  const productManualEconomics = useAppStore((s) => s.productManualEconomics);

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

  const rankedActions = useMemo(() => {
    const all: DecisionAction[] = [...targetDecisions, ...campaignDecisions];
    return all.filter(isRankable).sort((a, b) => priorityScore(b) - priorityScore(a));
  }, [targetDecisions, campaignDecisions]);

  const riskScoreByTargetKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of targetDecisions) map[d.key] = d.risk.overallScore;
    return map;
  }, [targetDecisions]);

  const nextDollar = useMemo(
    () => rankNextDollarCandidates(ws.targets, ws.economicsById, settings.maxDailyPpcBudget, riskScoreByTargetKey),
    [ws.targets, ws.economicsById, settings.maxDailyPpcBudget, riskScoreByTargetKey],
  );

  return { ws, targetDecisions, campaignDecisions, rankedActions, nextDollar };
}
