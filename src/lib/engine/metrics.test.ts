import { describe, it, expect } from 'vitest';
import { computeAcos, computeCtr, computeCvr, computeCpc } from './metrics';

describe('computeAcos', () => {
  it('computes ACoS normally when there are ad sales', () => {
    expect(computeAcos(20, 100)).toBeCloseTo(0.2);
  });

  it('never returns 0% when sales are zero and spend is positive (failure mode #6)', () => {
    expect(computeAcos(50, 0)).toBeNull();
  });

  it('returns null when both spend and sales are zero', () => {
    expect(computeAcos(0, 0)).toBeNull();
  });

  it('returns null for negative/invalid sales', () => {
    expect(computeAcos(10, -5)).toBeNull();
  });
});

describe('computeCtr/computeCvr/computeCpc', () => {
  it('returns null on zero denominators instead of dividing by zero', () => {
    expect(computeCtr(5, 0)).toBeNull();
    expect(computeCvr(1, 0)).toBeNull();
    expect(computeCpc(10, 0)).toBeNull();
  });

  it('computes normally otherwise', () => {
    expect(computeCtr(10, 100)).toBeCloseTo(0.1);
    expect(computeCvr(2, 20)).toBeCloseTo(0.1);
    expect(computeCpc(20, 10)).toBeCloseTo(2);
  });
});
