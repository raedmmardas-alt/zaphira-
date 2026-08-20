// Custom date-range filtering for the Reporting Period picker — a PURE,
// additive data-selection step that runs BEFORE deriveWorkspace.buildWorkspace,
// never inside it. buildWorkspace, the period-alignment engine, and every
// Amazon/Sellerboard parser are completely untouched by this file; it only
// narrows the row arrays (and the requestedPeriod on the period-driving
// report types) that get passed in, reusing 100% of the existing
// reconciliation/aggregation formulas against a smaller dataset.
//
// Never fabricates or guesses: a row can only be attributed to a custom
// range when its OWN date span is fully contained within that range. A row
// with no date info at all, or one whose span is wider than / straddles the
// requested range, means that report type cannot be safely subdivided —
// the whole custom-range request is then rejected with an explicit
// explanation rather than silently mixing full-period and sub-range data.
import type { DateRange, ReportImportMeta, ReportType } from '../../types';
import type { ReportRowsByType } from '../../state/store';

interface DatedRow {
  activityStart?: DateRange['start'];
  activityEnd?: DateRange['end'];
}

const PERIOD_DRIVING_TYPES: ReportType[] = ['campaign', 'targeting', 'advertisedProduct'];

function rowVerdict(row: DatedRow, range: DateRange): 'INSIDE' | 'OUTSIDE' | 'UNSUPPORTED' {
  if (!row.activityStart || !row.activityEnd) return 'UNSUPPORTED';
  if (row.activityEnd < range.start || row.activityStart > range.end) return 'OUTSIDE';
  if (row.activityStart >= range.start && row.activityEnd <= range.end) return 'INSIDE';
  return 'UNSUPPORTED'; // partially overlaps the boundary — can't be safely subdivided
}

function widenRange(a: DateRange | null, row: DatedRow): DateRange | null {
  if (!row.activityStart || !row.activityEnd) return a;
  if (!a) return { start: row.activityStart, end: row.activityEnd };
  return {
    start: row.activityStart < a.start ? row.activityStart : a.start,
    end: row.activityEnd > a.end ? row.activityEnd : a.end,
  };
}

function assessDatedRows(rows: DatedRow[], range: DateRange): { unsupported: boolean; widest: DateRange | null } {
  let unsupported = false;
  let widest: DateRange | null = null;
  for (const row of rows) {
    if (rowVerdict(row, range) === 'UNSUPPORTED') {
      unsupported = true;
      widest = widenRange(widest, row);
    }
  }
  return { unsupported, widest };
}

export interface CustomRangeAssessment {
  supported: boolean;
  // User-friendly explanation when unsupported — always present together
  // with `supported: false`, always null when supported.
  reason: string | null;
}

// Checks every currently-loaded report type with row-level date info.
// Sellerboard Product rows (true one-row-per-day data) are also checked via
// their own single `date` field. A type with zero rows loaded is skipped —
// it simply contributes nothing either way.
export function assessCustomRangeSupport(reportRows: ReportRowsByType, range: DateRange): CustomRangeAssessment {
  const datedGroups: { label: string; rows: DatedRow[] }[] = [
    { label: 'Campaign', rows: reportRows.campaign },
    { label: 'Targeting', rows: reportRows.targeting },
    { label: 'Search Term', rows: reportRows.searchTerm },
    { label: 'Advertised Product', rows: reportRows.advertisedProduct },
    { label: 'Sellerboard Keyword', rows: reportRows.sellerboardKeyword },
  ];

  for (const g of datedGroups) {
    if (g.rows.length === 0) continue;
    const { unsupported, widest } = assessDatedRows(g.rows, range);
    if (unsupported) {
      const widestLabel = widest ? `${widest.start} to ${widest.end}` : 'a wider period';
      return {
        supported: false,
        reason: `This report covers ${widestLabel} as one aggregated period. Upload a daily report to analyze individual dates.`,
      };
    }
  }

  // Sellerboard Product rows carry a single `date` (real daily granularity)
  // rather than a range — a row with date === null can't be attributed
  // anywhere, so it's treated the same as an "unsupported" dated row.
  const sellerboardProductRows = reportRows.sellerboardProduct;
  if (sellerboardProductRows.some((r) => r.date === null)) {
    return {
      supported: false,
      reason: 'One or more Sellerboard rows have no date, so they cannot be safely placed inside a custom date range. Upload a daily Sellerboard export to analyze individual dates.',
    };
  }

  return { supported: true, reason: null };
}

// Applies the range filter — only ever called after assessCustomRangeSupport
// has already returned supported: true, so every row here is guaranteed to
// have real date info fully containable within `range`.
export function filterReportRowsToRange(reportRows: ReportRowsByType, range: DateRange): ReportRowsByType {
  const insideDated = <T extends DatedRow>(rows: T[]): T[] => rows.filter((r) => rowVerdict(r, range) === 'INSIDE');
  return {
    campaign: insideDated(reportRows.campaign),
    targeting: insideDated(reportRows.targeting),
    searchTerm: insideDated(reportRows.searchTerm),
    advertisedProduct: insideDated(reportRows.advertisedProduct),
    sellerboardKeyword: insideDated(reportRows.sellerboardKeyword),
    sellerboardProduct: reportRows.sellerboardProduct.filter((r) => r.date !== null && r.date >= range.start && r.date <= range.end),
  };
}

// Overrides the period-driving report types' requestedPeriod to the custom
// range so buildWorkspace's own (unmodified) getCurrentPeriod/isCurrentPeriod
// logic naturally treats `range` as the current period — no changes to
// deriveWorkspace.ts or the period-alignment engine required.
export function buildCustomRangeReportMeta(
  reportMeta: Partial<Record<ReportType, ReportImportMeta>>,
  range: DateRange,
): Partial<Record<ReportType, ReportImportMeta>> {
  const next = { ...reportMeta };
  for (const type of PERIOD_DRIVING_TYPES) {
    const meta = next[type];
    if (!meta) continue;
    next[type] = { ...meta, requestedPeriod: range, periodConfirmedManually: true };
  }
  return next;
}
