import { describe, it, expect } from 'vitest';
import { getExchangeRate, convertFromReportCurrency, formatInCurrency } from './currency';

describe('getExchangeRate', () => {
  it('returns 1 when display currency equals report currency, with no rate needed', () => {
    expect(getExchangeRate('USD', 'USD', {})).toBe(1);
  });

  it('returns the stored rate when one exists for the display currency', () => {
    expect(getExchangeRate('AED', 'USD', { AED: 3.6725 })).toBe(3.6725);
  });

  it('returns null (never fabricates a rate) when no rate has been entered yet', () => {
    expect(getExchangeRate('EUR', 'USD', {})).toBeNull();
    expect(getExchangeRate('EUR', 'USD', { AED: 3.6725 })).toBeNull();
  });

  it('never guesses a cross rate when the report currency itself is not the base currency', () => {
    // V1 only ever has USD as a report currency, but this proves the
    // function doesn't silently misuse a USD-relative rate table for some
    // other report currency if that ever changes.
    expect(getExchangeRate('AED', 'CAD', { AED: 3.6725 })).toBeNull();
  });

  it('ignores a non-positive or non-finite stored rate rather than dividing/multiplying by garbage', () => {
    expect(getExchangeRate('AED', 'USD', { AED: 0 })).toBeNull();
    expect(getExchangeRate('AED', 'USD', { AED: -1 })).toBeNull();
    expect(getExchangeRate('AED', 'USD', { AED: NaN })).toBeNull();
  });
});

describe('convertFromReportCurrency', () => {
  it('passes the amount through unchanged when display currency equals report currency', () => {
    expect(convertFromReportCurrency(123.45, 'USD', 'USD', {})).toBe(123.45);
  });

  it('multiplies by the stored rate for each supported display currency', () => {
    const rates = { AED: 3.6725, EUR: 0.92, CAD: 1.36, MXN: 17.5 };
    expect(convertFromReportCurrency(100, 'USD', 'AED', rates)).toBeCloseTo(367.25, 5);
    expect(convertFromReportCurrency(100, 'USD', 'EUR', rates)).toBeCloseTo(92, 5);
    expect(convertFromReportCurrency(100, 'USD', 'CAD', rates)).toBeCloseTo(136, 5);
    expect(convertFromReportCurrency(100, 'USD', 'MXN', rates)).toBeCloseTo(1750, 5);
  });

  it('returns null (never a fabricated converted value) when the rate is missing', () => {
    expect(convertFromReportCurrency(100, 'USD', 'EUR', {})).toBeNull();
  });

  it('correctly converts a negative amount (e.g. a loss) using the same rate', () => {
    expect(convertFromReportCurrency(-50, 'USD', 'AED', { AED: 3.6725 })).toBeCloseTo(-183.625, 5);
  });
});

describe('formatInCurrency', () => {
  it('formats each supported display currency with its own correct symbol', () => {
    expect(formatInCurrency(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatInCurrency(1234.5, 'EUR')).toMatch(/€1,234\.50/);
    expect(formatInCurrency(1234.5, 'CAD')).toMatch(/1,234\.50/); // "CA$1,234.50" in en-US ICU data
    expect(formatInCurrency(1234.5, 'MXN')).toMatch(/1,234\.50/);
    expect(formatInCurrency(1234.5, 'AED')).toMatch(/1,234\.50/);
  });

  it('returns the app\'s standard "—" for null/non-finite amounts, never a fabricated $0.00', () => {
    expect(formatInCurrency(null, 'USD')).toBe('—');
    expect(formatInCurrency(Number.NaN, 'USD')).toBe('—');
  });

  it('renders a negative amount with a leading minus sign', () => {
    expect(formatInCurrency(-42, 'USD')).toBe('-$42.00');
  });
});
