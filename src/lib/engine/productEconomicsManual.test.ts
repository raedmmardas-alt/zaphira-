import { describe, it, expect } from 'vitest';
import { calculateProductEconomics } from './productEconomicsManual';
import { blankManualEconomics } from '../../types';
import type { Product } from '../../types';

function product(overrides: Partial<Product> = {}): Product {
  return { id: 'rose', name: 'Rose', asin: 'B0GZVBBRZP', sku: '', sellingPrice: 19.99, aliases: [], campaignAliases: [], adGroupAliases: [], ...overrides };
}

describe('calculateProductEconomics', () => {
  it('is incomplete (never guesses) when Amazon Fees have not been entered', () => {
    const inputs = { ...blankManualEconomics('rose'), cogs: 2.91 };
    const result = calculateProductEconomics(product(), inputs);
    expect(result.complete).toBe(false);
    expect(result.missingFields).toContain('Amazon Fees');
    expect(result.contributionBeforeAdvertising).toBeNull();
    expect(result.breakEvenAcos).toBeNull();
  });

  it('is incomplete when Amazon Fees are entered but NOT confirmed — fees are never assumed', () => {
    const inputs = { ...blankManualEconomics('rose'), cogs: 2.91, amazonFees: 3.5, amazonFeesConfirmed: false };
    const result = calculateProductEconomics(product(), inputs);
    expect(result.complete).toBe(false);
    expect(result.missingFields).toContain('Amazon Fees (confirm)');
  });

  it('is incomplete when Selling Price is missing', () => {
    const inputs = { ...blankManualEconomics('rose'), cogs: 2.91, amazonFees: 3.5, amazonFeesConfirmed: true };
    const result = calculateProductEconomics(product({ sellingPrice: null }), inputs);
    expect(result.complete).toBe(false);
    expect(result.missingFields).toContain('Selling Price');
  });

  it('is incomplete when COGS is missing', () => {
    const inputs = { ...blankManualEconomics('rose'), amazonFees: 3.5, amazonFeesConfirmed: true };
    const result = calculateProductEconomics(product(), inputs);
    expect(result.complete).toBe(false);
    expect(result.missingFields).toContain('COGS');
  });

  it('computes contribution before advertising, break-even CPA, and break-even ACoS once Selling Price/COGS/confirmed Amazon Fees are present', () => {
    // Selling Price 19.99, COGS 2.91, Amazon Fees 3.50, no discount.
    const inputs = { ...blankManualEconomics('rose'), cogs: 2.91, amazonFees: 3.50, amazonFeesConfirmed: true, sellerFundedDiscount: 0 };
    const result = calculateProductEconomics(product(), inputs);
    expect(result.complete).toBe(true);
    expect(result.contributionBeforeAdvertising).toBeCloseTo(19.99 - 2.91 - 3.50);
    expect(result.breakEvenCpa).toBeCloseTo(13.58);
    expect(result.breakEvenAcos).toBeCloseTo(13.58 / 19.99);
  });

  it('subtracts the seller-funded discount from contribution before advertising', () => {
    const inputs = { ...blankManualEconomics('rose'), cogs: 2.91, amazonFees: 3.50, amazonFeesConfirmed: true, sellerFundedDiscount: 2.00 };
    const result = calculateProductEconomics(product(), inputs);
    expect(result.contributionBeforeAdvertising).toBeCloseTo(19.99 - 2.91 - 3.50 - 2.00);
  });

  it('leaves Maximum CPA and Target ACoS null (not guessed) when Target Profit per Order is not set, even though the product is otherwise complete', () => {
    const inputs = { ...blankManualEconomics('rose'), cogs: 2.91, amazonFees: 3.50, amazonFeesConfirmed: true };
    const result = calculateProductEconomics(product(), inputs);
    expect(result.complete).toBe(true);
    expect(result.maxCpaForTargetProfit).toBeNull();
    expect(result.targetAcos).toBeNull();
    // Break-even figures remain available.
    expect(result.breakEvenAcos).not.toBeNull();
  });

  it('computes Maximum CPA and Target ACoS once Target Profit per Order is set', () => {
    const inputs = { ...blankManualEconomics('rose'), cogs: 2.91, amazonFees: 3.50, amazonFeesConfirmed: true, targetProfitPerOrder: 5.00 };
    const result = calculateProductEconomics(product(), inputs);
    const contribution = 19.99 - 2.91 - 3.50;
    expect(result.maxCpaForTargetProfit).toBeCloseTo(contribution - 5.00);
    expect(result.targetAcos).toBeCloseTo((contribution - 5.00) / 19.99);
  });

  it('does not hide a negative contribution (unprofitable even at $0 ad spend) — reveals it rather than blocking', () => {
    // Fees + COGS exceed selling price.
    const inputs = { ...blankManualEconomics('rose'), cogs: 5, amazonFees: 20, amazonFeesConfirmed: true };
    const result = calculateProductEconomics(product({ sellingPrice: 19.99 }), inputs);
    expect(result.complete).toBe(true);
    expect(result.contributionBeforeAdvertising).toBeLessThan(0);
    expect(result.breakEvenAcos).toBeLessThan(0);
  });
});
