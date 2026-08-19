import { describe, it, expect } from 'vitest';
import { SIMPLE_ACTION_LABEL, SIMPLE_RISK_LABEL } from './simplifiedAction';
import type { DecisionActionType, RiskClassification } from '../../types';

const ALL_ACTIONS: DecisionActionType[] = [
  'SCALE', 'INCREASE_BID', 'KEEP', 'WATCH', 'HOLD_COLLECT_DATA', 'REDUCE_BID', 'PAUSE',
  'TEST_IN_PHRASE', 'MOVE_TO_EXACT', 'ADD_NEGATIVE', 'INCREASE_BUDGET', 'REDUCE_BUDGET',
];

const ALL_RISKS: RiskClassification[] = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

describe('SIMPLE_ACTION_LABEL', () => {
  it('maps every DecisionActionType to one of the six seller-facing action words', () => {
    const allowed = new Set(['INCREASE', 'HOLD', 'REDUCE', 'PAUSE', 'TEST', 'OBSERVE']);
    for (const a of ALL_ACTIONS) {
      expect(allowed.has(SIMPLE_ACTION_LABEL[a])).toBe(true);
    }
  });

  it('never maps a technical action to an empty or undefined label', () => {
    for (const a of ALL_ACTIONS) {
      expect(SIMPLE_ACTION_LABEL[a]).toBeTruthy();
    }
  });
});

describe('SIMPLE_RISK_LABEL', () => {
  it('maps every RiskClassification to Low/Medium/High, collapsing CRITICAL into High', () => {
    expect(SIMPLE_RISK_LABEL.LOW).toBe('Low');
    expect(SIMPLE_RISK_LABEL.MODERATE).toBe('Medium');
    expect(SIMPLE_RISK_LABEL.HIGH).toBe('High');
    expect(SIMPLE_RISK_LABEL.CRITICAL).toBe('High');
    for (const r of ALL_RISKS) {
      expect(['Low', 'Medium', 'High']).toContain(SIMPLE_RISK_LABEL[r]);
    }
  });
});
