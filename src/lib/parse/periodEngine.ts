import type { DateRange, PeriodAlignmentStatus, ReportImportMeta, ReportType } from '../../types';
import { daysBetween, maxDate, minDate, today } from './dateUtils';

// Overlap ratio between two ranges, 0..1 relative to the shorter range's length.
function overlapRatio(a: DateRange, b: DateRange): number {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  const overlapDays = daysBetween(start, end) + 1;
  if (overlapDays <= 0) return 0;
  const lenA = daysBetween(a.start, a.end) + 1;
  const lenB = daysBetween(b.start, b.end) + 1;
  const shorter = Math.min(lenA, lenB);
  return Math.max(0, Math.min(1, overlapDays / shorter));
}

// A report whose date range is materially wider than another's (e.g. a
// 30-day cumulative search-term export vs. a 4-day campaign export) is a
// mismatch even when the shorter range sits entirely inside the longer one
// — overlapRatio alone reports "1.0" for that case, which would silently
// combine a historical-scale report with a current-scale one. This is the
// exact "Search Term: Jul 13-Aug 12" vs "Campaign: Aug 9-Aug 12" case
// called out as REPORT_SET_MISMATCH in the spec.
function durationMismatch(a: DateRange, b: DateRange): boolean {
  const lenA = daysBetween(a.start, a.end) + 1;
  const lenB = daysBetween(b.start, b.end) + 1;
  const longer = Math.max(lenA, lenB);
  const shorter = Math.min(lenA, lenB);
  return longer / shorter > 3 && longer - shorter > 5;
}

export interface AlignmentResult {
  status: PeriodAlignmentStatus;
  message: string;
  effectivePeriod: DateRange | null;
  mismatchedReports: string[]; // report ids
}

// Cross-validate all uploaded, active reports and determine an overall alignment status.
export function computeAlignment(reports: ReportImportMeta[]): AlignmentResult {
  const usable = reports.filter((r) => r.status !== 'FORMAT_NOT_RECOGNIZED');
  if (usable.length === 0) {
    return { status: 'CONFIRM_PERIOD', message: 'No reports imported yet.', effectivePeriod: null, mismatchedReports: [] };
  }

  const periods = usable
    .map((r) => ({ id: r.id, period: r.requestedPeriod ?? r.observedPeriod, confirmed: r.periodConfirmedManually || !!r.requestedPeriod }))
    .filter((p): p is { id: string; period: DateRange; confirmed: boolean } => !!p.period);

  if (periods.length < usable.length) {
    return {
      status: 'CONFIRM_PERIOD',
      message: 'One or more reports have no detectable date coverage. Please confirm the report period manually.',
      effectivePeriod: null,
      mismatchedReports: usable.filter((r) => !r.requestedPeriod && !r.observedPeriod).map((r) => r.id),
    };
  }

  // Old file check: latest date across all reports is more than 45 days in the past.
  let latestOverall: string | null = null;
  for (const p of periods) latestOverall = maxDate(latestOverall, p.period.end);
  if (latestOverall && daysBetween(latestOverall, today()) > 45) {
    return {
      status: 'OLD_FILE_WARNING',
      message: `The most recent activity across imported reports is ${latestOverall}, more than 45 days old. Verify these are the intended files before relying on recommendations.`,
      effectivePeriod: null,
      mismatchedReports: [],
    };
  }

  // Compare each pair; find worst overlap.
  let worst = 1;
  const mismatched = new Set<string>();
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      const ratio = overlapRatio(periods[i].period, periods[j].period);
      if (ratio < worst) worst = ratio;
      if (ratio < 0.5 || durationMismatch(periods[i].period, periods[j].period)) {
        mismatched.add(periods[i].id);
        mismatched.add(periods[j].id);
      }
    }
  }

  const allConfirmed = periods.every((p) => p.confirmed);

  let overallStart: string | null = null;
  let overallEnd: string | null = null;
  for (const p of periods) {
    overallStart = minDate(overallStart, p.period.start);
    overallEnd = maxDate(overallEnd, p.period.end);
  }
  const effectivePeriod: DateRange | null = overallStart && overallEnd ? { start: overallStart, end: overallEnd } : null;

  if (mismatched.size > 0) {
    return {
      status: 'REPORT_SET_MISMATCH',
      message: 'Imported reports cover materially different date ranges. Combining them would confuse historical and current-period data. Review before analysis.',
      effectivePeriod: null,
      mismatchedReports: Array.from(mismatched),
    };
  }

  if (worst < 0.85) {
    return {
      status: 'POSSIBLE_DATE_MISMATCH',
      message: 'Report periods overlap but are not identical. Recommendations may mix slightly different windows.',
      effectivePeriod,
      mismatchedReports: [],
    };
  }

  if (allConfirmed) {
    return { status: 'REPORT_PERIODS_ALIGNED', message: 'All report periods match a confirmed range.', effectivePeriod, mismatchedReports: [] };
  }

  return {
    status: 'AUTO_ALIGNED_HIGH_CONFIDENCE',
    message: 'Report periods were not explicitly confirmed but observed activity coverage lines up closely across all files.',
    effectivePeriod,
    mismatchedReports: [],
  };
}

export function periodKey(period: DateRange): string {
  return `${period.start}_${period.end}`;
}

export function combineObserved(a: DateRange | null, b: DateRange | null): DateRange | null {
  if (!a) return b;
  if (!b) return a;
  const start = minDate(a.start, b.start)!;
  const end = maxDate(a.end, b.end)!;
  return { start, end };
}

export function reportPeriodFromMeta(meta: ReportImportMeta | undefined): DateRange | null {
  if (!meta) return null;
  return meta.requestedPeriod ?? meta.observedPeriod;
}

// The current reporting period is driven by whichever of these report
// types are loaded (Campaign/Targeting/Advertised Product) — same set
// deriveWorkspace.getCurrentPeriod and UploadData's PERIOD_DRIVING_REPORT_TYPES
// already use. Extracted here (rather than kept private to deriveWorkspace.ts)
// so it can be reused wherever a marketplace/period's "confirmed period" needs
// to be determined from a reportMeta map — e.g. deciding which saved report
// snapshot a set of uploads belongs to — without duplicating this logic or
// creating a circular import between state/store.ts and state/deriveWorkspace.ts.
export function deriveCurrentPeriod(reportMeta: Partial<Record<ReportType, ReportImportMeta>>): DateRange | null {
  let period: DateRange | null = null;
  for (const type of ['campaign', 'targeting', 'advertisedProduct'] as ReportType[]) {
    const p = reportPeriodFromMeta(reportMeta[type]);
    if (p) period = combineObserved(period, p);
  }
  return period;
}
