import type { Product, ProductEconomicsCalcResult, ProductManualEconomicsInputs } from '../../types';

// Manual, per-order Product Economics — distinct from the Sellerboard-
// derived ProductEconomics used by the PPC recommendation engine. This
// engine is intentionally NOT wired into decideTargetAction /
// decideCampaignRecommendation / classifyProductStrategy; it exists purely
// to surface break-even/target figures from operator-entered inputs.
//
// Formulas:
//   Contribution before advertising = Selling Price - COGS - Amazon Fees - Seller-Funded Discount
//   Break-even CPA                  = Contribution before advertising
//   Break-even ACoS                 = Break-even CPA / Selling Price
//   Maximum CPA for target profit   = Contribution before advertising - Target Profit per Order
//   Target ACoS                     = Maximum CPA for target profit / Selling Price
export function calculateProductEconomics(product: Product, inputs: ProductManualEconomicsInputs): ProductEconomicsCalcResult {
  const missingFields: string[] = [];
  if (product.sellingPrice === null || product.sellingPrice <= 0) missingFields.push('Selling Price');
  if (inputs.cogs === null || inputs.cogs < 0) missingFields.push('COGS');
  if (inputs.amazonFees === null) missingFields.push('Amazon Fees');
  else if (!inputs.amazonFeesConfirmed) missingFields.push('Amazon Fees (confirm)');

  if (missingFields.length > 0) {
    return {
      productId: product.id,
      complete: false,
      missingFields,
      contributionBeforeAdvertising: null,
      breakEvenCpa: null,
      breakEvenAcos: null,
      maxCpaForTargetProfit: null,
      targetAcos: null,
    };
  }

  const sellingPrice = product.sellingPrice!;
  const cogs = inputs.cogs!;
  const amazonFees = inputs.amazonFees!;
  const sellerFundedDiscount = inputs.sellerFundedDiscount ?? 0;

  const contributionBeforeAdvertising = sellingPrice - cogs - amazonFees - sellerFundedDiscount;
  const breakEvenCpa = contributionBeforeAdvertising;
  const breakEvenAcos = sellingPrice > 0 ? breakEvenCpa / sellingPrice : null;

  // Maximum CPA / Target ACoS additionally require Target Profit per Order.
  // The rest of the result stays available even when this one field is
  // missing — never blocking break-even figures on a target that hasn't
  // been set yet.
  let maxCpaForTargetProfit: number | null = null;
  let targetAcos: number | null = null;
  if (inputs.targetProfitPerOrder !== null) {
    maxCpaForTargetProfit = contributionBeforeAdvertising - inputs.targetProfitPerOrder;
    targetAcos = sellingPrice > 0 ? maxCpaForTargetProfit / sellingPrice : null;
  }

  return {
    productId: product.id,
    complete: true,
    missingFields: [],
    contributionBeforeAdvertising,
    breakEvenCpa,
    breakEvenAcos,
    maxCpaForTargetProfit,
    targetAcos,
  };
}
