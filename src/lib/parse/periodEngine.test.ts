import { describe, it, expect } from 'vitest';
import { computeAlignment } from './periodEngine';
import type { ReportImportMeta } from '../../types';

function meta(overrides: Partial<ReportImportMeta>): ReportImportMeta {
  return {
    id: crypto.randomUUID(),
    type: 'campaign',
    filename: 'x.csv',
    fileSizeBytes: 100,
    rowCount: 5,
    importedAt: new Date().toISOString(),
    requestedPeriod: null,
    observedPeriod: null,
    periodConfirmedManually: false,
    status: 'OK',
    detectedColumns: [],
    missingRequiredFields: [],
    missingOptionalFields: [],
    ...overrides,
  };
}

describe('computeAlignment', () => {
  it('reports CONFIRM_PERIOD when no reports are imported', () => {
    expect(computeAlignment([]).status).toBe('CONFIRM_PERIOD');
  });

  it('detects REPORT_SET_MISMATCH when one report spans a materially wider window than the rest (spec worked example)', () => {
    const campaign = meta({ type: 'campaign', observedPeriod: { start: '2026-08-09', end: '2026-08-12' } });
    const targeting = meta({ type: 'targeting', observedPeriod: { start: '2026-08-09', end: '2026-08-12' } });
    const searchTerm = meta({ type: 'searchTerm', observedPeriod: { start: '2026-07-13', end: '2026-08-12' } });
    const result = computeAlignment([campaign, targeting, searchTerm]);
    expect(result.status).toBe('REPORT_SET_MISMATCH');
  });

  it('reports REPORT_PERIODS_ALIGNED when all periods are confirmed and identical', () => {
    const period = { start: '2026-08-09', end: '2026-08-12' };
    const a = meta({ type: 'campaign', requestedPeriod: period, periodConfirmedManually: true });
    const b = meta({ type: 'targeting', requestedPeriod: period, periodConfirmedManually: true });
    const result = computeAlignment([a, b]);
    expect(result.status).toBe('REPORT_PERIODS_ALIGNED');
  });

  it('reports AUTO_ALIGNED_HIGH_CONFIDENCE when periods line up closely but were not manually confirmed', () => {
    const a = meta({ type: 'campaign', observedPeriod: { start: '2026-08-09', end: '2026-08-12' } });
    const b = meta({ type: 'targeting', observedPeriod: { start: '2026-08-09', end: '2026-08-12' } });
    const result = computeAlignment([a, b]);
    expect(result.status).toBe('AUTO_ALIGNED_HIGH_CONFIDENCE');
  });

  it('reports OLD_FILE_WARNING when the most recent activity is far in the past', () => {
    const a = meta({ observedPeriod: { start: '2020-01-01', end: '2020-01-05' } });
    const result = computeAlignment([a]);
    expect(result.status).toBe('OLD_FILE_WARNING');
  });

  it('reports CONFIRM_PERIOD when a report has no detectable date coverage at all', () => {
    const a = meta({ observedPeriod: { start: '2026-08-09', end: '2026-08-12' } });
    const b = meta({ observedPeriod: null, requestedPeriod: null });
    const result = computeAlignment([a, b]);
    expect(result.status).toBe('CONFIRM_PERIOD');
  });

  it('does not silently combine reports on REPORT_SET_MISMATCH (no effective period returned)', () => {
    const campaign = meta({ observedPeriod: { start: '2026-08-09', end: '2026-08-12' } });
    const searchTerm = meta({ observedPeriod: { start: '2026-06-01', end: '2026-08-12' } });
    const result = computeAlignment([campaign, searchTerm]);
    expect(result.effectivePeriod).toBeNull();
  });
});
