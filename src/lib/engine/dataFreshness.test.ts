import { describe, it, expect } from 'vitest';
import { classifyFreshnessDays, computeDataFreshness } from './dataFreshness';

describe('classifyFreshnessDays', () => {
  it('classifies 0 and 1 days old as FRESH', () => {
    expect(classifyFreshnessDays(0)).toBe('FRESH');
    expect(classifyFreshnessDays(1)).toBe('FRESH');
  });
  it('classifies 2 and 3 days old as UPDATE_RECOMMENDED', () => {
    expect(classifyFreshnessDays(2)).toBe('UPDATE_RECOMMENDED');
    expect(classifyFreshnessDays(3)).toBe('UPDATE_RECOMMENDED');
  });
  it('classifies 4+ days old as STALE', () => {
    expect(classifyFreshnessDays(4)).toBe('STALE');
    expect(classifyFreshnessDays(10)).toBe('STALE');
  });
});

describe('computeDataFreshness — calculated from the confirmed reporting period end date, not upload time', () => {
  it('0-day: period ends today', () => {
    const f = computeDataFreshness('2026-08-19', '2026-08-19');
    expect(f.daysOld).toBe(0);
    expect(f.status).toBe('FRESH');
  });

  it('1-day: period ended yesterday', () => {
    const f = computeDataFreshness('2026-08-18', '2026-08-19');
    expect(f.daysOld).toBe(1);
    expect(f.status).toBe('FRESH');
  });

  it('2-day: UPDATE_RECOMMENDED', () => {
    const f = computeDataFreshness('2026-08-17', '2026-08-19');
    expect(f.daysOld).toBe(2);
    expect(f.status).toBe('UPDATE_RECOMMENDED');
  });

  it('3-day: still UPDATE_RECOMMENDED', () => {
    const f = computeDataFreshness('2026-08-16', '2026-08-19');
    expect(f.daysOld).toBe(3);
    expect(f.status).toBe('UPDATE_RECOMMENDED');
  });

  it('4-day: STALE', () => {
    const f = computeDataFreshness('2026-08-15', '2026-08-19');
    expect(f.daysOld).toBe(4);
    expect(f.status).toBe('STALE');
  });

  it('much older period: STALE with the real day count, not capped or hidden', () => {
    const f = computeDataFreshness('2026-07-01', '2026-08-19');
    expect(f.daysOld).toBe(49);
    expect(f.status).toBe('STALE');
  });

  it('exact V1 example: uploaded Aug 19 but reporting period ends Aug 14 -> 5 days old, STALE (upload timestamp plays no part)', () => {
    // The "uploaded today" fact is deliberately never passed into this
    // function at all — only the confirmed period end and today's date.
    const f = computeDataFreshness('2026-08-14', '2026-08-19');
    expect(f.daysOld).toBe(5);
    expect(f.status).toBe('STALE');
  });

  it('never reports a negative age for a period end that is still in the future — floors at 0 (FRESH)', () => {
    const f = computeDataFreshness('2026-08-25', '2026-08-19');
    expect(f.daysOld).toBe(0);
    expect(f.status).toBe('FRESH');
  });
});
