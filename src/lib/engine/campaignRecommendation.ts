import type { Confidence, ProductEconomics, Risk } from '../../types';

export interface CampaignRecInput {
  productId: string | null;
  isCurrentPeriod: boolean;
  spend: number;
  acos: number | null;
  economics: ProductEconomics | null;
  stopLossSpend: number;
}

export interface CampaignRecommendation {
  recommendation: string;
  risk: Risk;
  confidence: Confidence;
}

export function decideCampaignRecommendation(input: CampaignRecInput): CampaignRecommendation {
  const { productId, isCurrentPeriod, spend, acos, economics, stopLossSpend } = input;

  if (!productId) {
    return { recommendation: 'PRODUCT MAPPING REQUIRED — map this campaign before evaluating performance.', risk: 'BLOCKED', confidence: 'LOW' };
  }

  if (!isCurrentPeriod) {
    return { recommendation: 'Historical campaign — no current-period action. Useful for keyword/search-term intelligence only.', risk: 'LOW', confidence: 'MEDIUM' };
  }

  if (spend <= 0) {
    return { recommendation: 'No current spend recorded for this campaign.', risk: 'LOW', confidence: 'LOW' };
  }

  const breakEven = economics?.breakEvenAcos ?? null;

  if (acos === null) {
    if (spend > stopLossSpend) {
      return { recommendation: `$${spend.toFixed(2)} spent with no attributed sales — review immediately.`, risk: 'HIGH', confidence: 'MEDIUM' };
    }
    return { recommendation: 'Spend recorded but no ad-attributed sales yet — monitor.', risk: 'MEDIUM', confidence: 'LOW' };
  }

  if (breakEven === null) {
    return { recommendation: 'No product economics available — cannot evaluate profitability. Upload a current Sellerboard report.', risk: 'MEDIUM', confidence: 'LOW' };
  }

  if (acos > breakEven) {
    return { recommendation: `ACoS (${(acos * 100).toFixed(1)}%) exceeds this product's break-even (${(breakEven * 100).toFixed(1)}%) — review keyword-level bids.`, risk: acos > breakEven * 1.5 ? 'HIGH' : 'MEDIUM', confidence: 'MEDIUM' };
  }

  if (acos <= breakEven * 0.85) {
    return { recommendation: `Efficient — ACoS (${(acos * 100).toFixed(1)}%) is comfortably below break-even (${(breakEven * 100).toFixed(1)}%).`, risk: 'LOW', confidence: 'HIGH' };
  }

  return { recommendation: `Within target — ACoS (${(acos * 100).toFixed(1)}%) is at or near break-even. Maintain.`, risk: 'LOW', confidence: 'MEDIUM' };
}
