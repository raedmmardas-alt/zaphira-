import type { ISODate, DateRange } from '../../types';

// Parse a variety of date formats found in Amazon/Sellerboard exports into ISODate (YYYY-MM-DD).
export function parseFlexibleDate(raw: unknown): ISODate | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return toISODate(raw);
  }
  const s = String(raw).trim();
  if (!s) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return isoFromParts(+m[1], +m[2], +m[3]);

  // MM/DD/YYYY
  m = s.match(/^(\d{1,2})[/](\d{1,2})[/](\d{4})$/);
  if (m) return isoFromParts(+m[3], +m[1], +m[2]);

  // DD.MM.YYYY or DD_MM_YYYY (Sellerboard filenames use this)
  m = s.match(/^(\d{1,2})[._](\d{1,2})[._](\d{4})$/);
  if (m) return isoFromParts(+m[3], +m[2], +m[1]);

  // Month DD, YYYY  (e.g. "Aug 9, 2026")
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (month) return isoFromParts(+m[3], month, +m[2]);
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return toISODate(d);
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isoFromParts(y: number, mo: number, d: number): ISODate | null {
  if (!y || !mo || !d) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y.toString().padStart(4, '0')}-${mo.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

function toISODate(d: Date): ISODate {
  return `${d.getFullYear().toString().padStart(4, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

// Parse "Aug 9-Aug 12, 2026" or "2026-08-09 - 2026-08-12" style date-range column values.
export function parseDateRangeValue(raw: unknown): DateRange | null {
  if (!raw) return null;
  const s = String(raw).trim();

  // Amazon-style "Aug 9-Aug 12, 2026" or "Aug 9, 2026-Aug 12, 2026" — a
  // trailing year applies to both sides, and must NOT be split by the
  // generic hyphen splitter below (it would butcher "Aug 9-Aug 12").
  const monthRange = s.match(/^([A-Za-z]{3,9}\s+\d{1,2})(?:,\s*\d{4})?\s*(?:-|–|to)\s*([A-Za-z]{3,9}\s+\d{1,2}),?\s*(\d{4})$/i);
  if (monthRange) {
    const start = parseFlexibleDate(`${monthRange[1]}, ${monthRange[3]}`);
    const end = parseFlexibleDate(`${monthRange[2]}, ${monthRange[3]}`);
    if (start && end) return { start, end };
  }

  // MM/DD/YYYY-MM/DD/YYYY (no internal hyphens to worry about — safe to split tight)
  const slashRange = s.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})$/);
  if (slashRange) {
    const start = parseFlexibleDate(slashRange[1]);
    const end = parseFlexibleDate(slashRange[2]);
    if (start && end) return { start, end };
  }

  // Numeric-only ranges (YYYY-MM-DD - YYYY-MM-DD, MM/DD/YYYY-MM/DD/YYYY) —
  // split only on a hyphen/en-dash/"to" that has whitespace on both sides,
  // so the hyphens inside YYYY-MM-DD itself are never treated as separators.
  const parts = s.split(/\s+(?:-|–|to)\s+/i);
  if (parts.length === 2) {
    const start = parseFlexibleDate(parts[0]);
    const end = parseFlexibleDate(parts[1]);
    if (start && end) return { start, end };
  }
  const single = parseFlexibleDate(s);
  if (single) return { start: single, end: single };
  return null;
}

// Parse a Sellerboard-style filename range like "09_08_2026-12_08_2026" (DD_MM_YYYY-DD_MM_YYYY).
export function parseFilenameDateRange(filename: string): DateRange | null {
  const m = filename.match(/(\d{2})_(\d{2})_(\d{4})\s*-\s*(\d{2})_(\d{2})_(\d{4})/);
  if (m) {
    const start = isoFromParts(+m[3], +m[2], +m[1]);
    const end = isoFromParts(+m[6], +m[5], +m[4]);
    if (start && end) return { start, end };
  }
  // YYYY-MM-DD_to_YYYY-MM-DD or YYYYMMDD-YYYYMMDD
  const m2 = filename.match(/(\d{4}-\d{2}-\d{2}).{0,5}(\d{4}-\d{2}-\d{2})/);
  if (m2) {
    return { start: m2[1], end: m2[2] };
  }
  return null;
}

export function minDate(a: ISODate | null, b: ISODate | null): ISODate | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

export function maxDate(a: ISODate | null, b: ISODate | null): ISODate | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db - da) / 86400000);
}

export function today(): ISODate {
  return toISODate(new Date());
}
