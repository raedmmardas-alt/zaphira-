// READ-ONLY Amazon Ads API: live Sponsored Products keyword + product/
// category targeting state (current bid/status), plus ad group names for
// display. Analogous to amazonCampaigns.js.
//
// Amazon models "keywords" and "targeting clauses" (product/category
// targeting) as two separate object types, each with its own list
// endpoint. The app's internal TargetingRow model (src/types/index.ts)
// and the existing Targeting CSV importer/Keywords page treat them as a
// single "targeting" concept, so listSpTargeting() below merges both into
// one array in a shared shape -- this is normalization, not a second data
// model.
//
// HARD RULE: this file must only ever call Amazon's "list" (retrieval)
// endpoints. Amazon Ads API v3's list/search endpoints use
// POST-with-a-filter-body as their convention (not GET+querystring), but
// this is still a read operation -- it never creates, updates, pauses, or
// deletes a keyword/target/ad group, and never changes a bid.
import { getAccessToken } from './amazonAuth.js';
import { config } from './config.js';
import { parseJsonPreservingIdFields } from './safeJson.js';

const REGION_HOSTS = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
};

function regionHost() {
  return REGION_HOSTS[config.region] ?? REGION_HOSTS.NA;
}

export class AmazonTargetingError extends Error {}

function extractBid(raw) {
  if (typeof raw?.bid === 'number') return raw.bid;
  if (raw?.bid && typeof raw.bid.bid === 'number') return raw.bid.bid;
  return undefined;
}

// Product/category targeting clauses don't have a plain-text "keyword" --
// Amazon represents them as an `expression` (e.g.
// [{ type: 'ASIN_SAME_AS', value: 'B0EXAMPLE' }]). This renders a
// readable text form; it never fabricates a value when the expression is
// missing (the row is dropped downstream instead, same as the CSV
// importer's own "never fabricate a blank target" behavior).
function expressionText(expression) {
  if (!Array.isArray(expression) || expression.length === 0) return '';
  return expression.map((e) => `${e?.type ?? ''}=${e?.value ?? ''}`).join(' ').trim();
}

async function listPaged(path, contentType, idFields) {
  const items = [];
  let nextToken;
  do {
    const token = await getAccessToken();
    const res = await fetch(`${regionHost()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Amazon-Advertising-API-ClientId': config.clientId,
        'Amazon-Advertising-API-Scope': config.profileId,
        'Content-Type': contentType,
        Accept: contentType,
      },
      body: JSON.stringify({ maxResults: 100, ...(nextToken ? { nextToken } : {}) }),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new AmazonTargetingError(`Amazon targeting list failed (HTTP ${res.status}) for ${path}: ${text.slice(0, 300)}`);
    }
    const data = parseJsonPreservingIdFields(text, idFields);
    const listKey = Object.keys(data).find((k) => Array.isArray(data[k]));
    items.push(...(listKey ? data[listKey] : []));
    nextToken = data.nextToken;
  } while (nextToken);
  return items;
}

// Every Sponsored Products KEYWORD target's CURRENT live state, match
// type, and bid -- authoritative for "is this live right now," never
// inferred from historical impressions/clicks.
export async function listSpKeywords() {
  const raw = await listPaged('/sp/keywords/list', 'application/vnd.spKeyword.v3+json', ['keywordId', 'campaignId', 'adGroupId']);
  return raw.map((k) => ({
    id: String(k.keywordId),
    campaignId: k.campaignId !== undefined && k.campaignId !== null ? String(k.campaignId) : undefined,
    adGroupId: k.adGroupId !== undefined && k.adGroupId !== null ? String(k.adGroupId) : undefined,
    targetingText: k.keywordText ?? '',
    matchType: k.matchType ?? 'unknown',
    state: k.state ?? undefined,
    bid: extractBid(k),
  }));
}

// Every Sponsored Products PRODUCT/CATEGORY targeting clause's CURRENT
// live state and bid, in the same shape as listSpKeywords() so merge code
// can treat "targeting" as one concept.
export async function listSpTargets() {
  const raw = await listPaged('/sp/targets/list', 'application/vnd.spTargetingClause.v3+json', ['targetId', 'campaignId', 'adGroupId']);
  return raw.map((t) => ({
    id: String(t.targetId),
    campaignId: t.campaignId !== undefined && t.campaignId !== null ? String(t.campaignId) : undefined,
    adGroupId: t.adGroupId !== undefined && t.adGroupId !== null ? String(t.adGroupId) : undefined,
    targetingText: expressionText(t.expression),
    matchType: 'TARGETING_EXPRESSION',
    state: t.state ?? undefined,
    bid: extractBid(t),
  }));
}

// The unified live-state list: every current keyword AND product/category
// target, in one array -- what targetingSync.js joins against the
// performance report by `id`.
export async function listSpTargeting() {
  const [keywords, targets] = await Promise.all([listSpKeywords(), listSpTargets()]);
  return [...keywords, ...targets];
}

// Ad group id -> name, needed because the keyword/target list endpoints
// above only return IDs -- names are resolved here the same way
// campaignSync.js resolves campaign names from listSpCampaigns().
export async function listSpAdGroups() {
  const raw = await listPaged('/sp/adGroups/list', 'application/vnd.spAdGroup.v3+json', ['adGroupId', 'campaignId']);
  return raw.map((g) => ({
    adGroupId: String(g.adGroupId),
    campaignId: g.campaignId !== undefined && g.campaignId !== null ? String(g.campaignId) : undefined,
    name: g.name ?? '',
    state: g.state ?? undefined,
  }));
}
