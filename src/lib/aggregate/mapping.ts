import type { AdvertisedProductRow, MappingSource, Product, ProductMappingResult, SavedAdGroupMapping } from '../../types';

export interface MappingContext {
  asin?: string | null;
  sku?: string | null;
  campaign: string;
  adGroup?: string | null;
}

export interface MappingIndexes {
  products: Product[];
  advertisedProductIndex: Map<string, string>; // `${campaign}|${adGroup}` -> asin
  savedMappings: SavedAdGroupMapping[];
}

export function buildAdvertisedProductIndex(rows: AdvertisedProductRow[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const r of rows) {
    const key = `${r.campaign}|${r.adGroup}`;
    if (!index.has(key) && r.asin) index.set(key, r.asin);
  }
  return index;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// True word/phrase-boundary containment — plain substring `includes` would
// let alias "rose" false-positive-match inside "Rosewood", "Primrose", etc.,
// and (being treated as a confident, operator-approved match) silently
// attribute an unrelated campaign's spend/sales to the wrong product.
function containsAsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const h = norm(haystack);
  const n = norm(needle);
  if (!n) return false;
  const pattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(n)}(?:$|[^a-z0-9])`, 'i');
  return pattern.test(h);
}

// Resolves a campaign/ad-group/target row to a product using the mandated
// mapping hierarchy. Never silently guesses on weak evidence — name inference
// is returned with confident=false so callers can block economics decisions.
export function resolveProductMapping(ctx: MappingContext, idx: MappingIndexes): ProductMappingResult {
  const asin = norm(ctx.asin);
  const sku = norm(ctx.sku);

  // 1. ASIN
  if (asin) {
    const byAsin = idx.products.find((p) => norm(p.asin) === asin);
    if (byAsin) return { productId: byAsin.id, source: 'ASIN', confident: true };
  }

  // 2. SKU
  if (sku) {
    const bySku = idx.products.find((p) => p.sku && norm(p.sku) === sku);
    if (bySku) return { productId: bySku.id, source: 'SKU', confident: true };
  }

  // 3. Advertised Product report mapping (campaign+adGroup -> ASIN -> product)
  const groupKey = `${ctx.campaign}|${ctx.adGroup ?? ''}`;
  const advAsin = idx.advertisedProductIndex.get(groupKey);
  if (advAsin) {
    const byAdvAsin = idx.products.find((p) => norm(p.asin) === norm(advAsin));
    if (byAdvAsin) return { productId: byAdvAsin.id, source: 'ADVERTISED_PRODUCT_REPORT', confident: true };
  }

  // 4. Saved ad-group mapping (operator-confirmed, persisted locally)
  const savedSpecific = idx.savedMappings.find(
    (m) => norm(m.campaignName) === norm(ctx.campaign) && norm(m.adGroupName) === norm(ctx.adGroup),
  );
  if (savedSpecific) return { productId: savedSpecific.productId, source: 'SAVED_AD_GROUP_MAPPING', confident: true };
  const savedCampaignLevel = idx.savedMappings.find(
    (m) => norm(m.campaignName) === norm(ctx.campaign) && m.adGroupName === null,
  );
  if (savedCampaignLevel) return { productId: savedCampaignLevel.productId, source: 'SAVED_AD_GROUP_MAPPING', confident: true };

  // 5. Explicit known aliases (operator-entered, so treated as confident)
  for (const p of idx.products) {
    const hay = `${ctx.campaign} ${ctx.adGroup ?? ''}`;
    for (const alias of p.aliases) {
      if (containsAsWord(hay, alias)) return { productId: p.id, source: 'EXPLICIT_ALIAS', confident: true };
    }
    for (const alias of p.campaignAliases) {
      if (containsAsWord(ctx.campaign, alias)) return { productId: p.id, source: 'EXPLICIT_ALIAS', confident: true };
    }
    for (const alias of p.adGroupAliases) {
      if (containsAsWord(ctx.adGroup ?? '', alias)) return { productId: p.id, source: 'EXPLICIT_ALIAS', confident: true };
    }
  }

  // 6. Campaign/ad-group name inference (weak signal — never confident)
  for (const p of idx.products) {
    const hay = `${ctx.campaign} ${ctx.adGroup ?? ''}`;
    if (containsAsWord(hay, p.name)) return { productId: p.id, source: 'NAME_INFERENCE', confident: false };
  }

  // 7. Unmapped — economics/bid decisions must block on this.
  return { productId: null, source: 'UNMAPPED', confident: false };
}

export const MAPPING_SOURCE_LABEL: Record<MappingSource, string> = {
  ASIN: 'Mapped by ASIN',
  SKU: 'Mapped by SKU',
  ADVERTISED_PRODUCT_REPORT: 'Mapped via Advertised Product report',
  SAVED_AD_GROUP_MAPPING: 'Mapped via saved ad-group mapping',
  EXPLICIT_ALIAS: 'Mapped via known alias',
  NAME_INFERENCE: 'Inferred from campaign/ad-group name (low confidence)',
  UNMAPPED: 'PRODUCT MAPPING REQUIRED',
};
