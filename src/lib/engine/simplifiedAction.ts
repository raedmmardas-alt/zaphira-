// Presentation-only mapping from the full DecisionActionType/RiskClassification
// vocabularies to the simplified 6-word action vocabulary and 3-word risk
// vocabulary shown on the seller-facing Home/Optimize pages. This changes
// display labels only — it never alters a.action, a.risk, or any other
// underlying decision-engine value, and the technical Decision Center page
// continues to show the full, unmapped vocabulary.
import type { BadgeTone } from '../../components/ui/Badge';
import type { DecisionActionType, RiskClassification } from '../../types';

export type SimpleAction = 'INCREASE' | 'HOLD' | 'REDUCE' | 'PAUSE' | 'TEST' | 'OBSERVE';

export const SIMPLE_ACTION_LABEL: Record<DecisionActionType, SimpleAction> = {
  SCALE: 'INCREASE',
  INCREASE_BID: 'INCREASE',
  INCREASE_BUDGET: 'INCREASE',
  KEEP: 'HOLD',
  HOLD_COLLECT_DATA: 'HOLD',
  WATCH: 'OBSERVE',
  REDUCE_BID: 'REDUCE',
  REDUCE_BUDGET: 'REDUCE',
  PAUSE: 'PAUSE',
  ADD_NEGATIVE: 'PAUSE',
  TEST_IN_PHRASE: 'TEST',
  MOVE_TO_EXACT: 'TEST',
};

export function simpleActionTone(action: DecisionActionType): BadgeTone {
  switch (SIMPLE_ACTION_LABEL[action]) {
    case 'INCREASE': return 'positive';
    case 'HOLD': return 'brand';
    case 'OBSERVE': return 'watch';
    case 'REDUCE': return 'watch';
    case 'PAUSE': return 'negative';
    case 'TEST': return 'positive';
    default: return 'neutral';
  }
}

export type SimpleRisk = 'Low' | 'Medium' | 'High';

export const SIMPLE_RISK_LABEL: Record<RiskClassification, SimpleRisk> = {
  LOW: 'Low',
  MODERATE: 'Medium',
  HIGH: 'High',
  CRITICAL: 'High',
};

export function simpleRiskTone(classification: RiskClassification): BadgeTone {
  switch (classification) {
    case 'LOW': return 'positive';
    case 'MODERATE': return 'watch';
    case 'HIGH': return 'negative';
    case 'CRITICAL': return 'negative';
    default: return 'neutral';
  }
}
