// READ-ONLY Amazon Ads API client.
//
// HARD RULE: this file must only ever contain GET requests against
// read-only Amazon Ads API endpoints. It must never add a POST/PUT/DELETE
// call against campaigns, ad groups, keywords, targets, negative
// targeting, bids, or budgets. Zaphira PPC Control is recommendation-only
// and the Amazon integration is READ-ONLY by architectural rule -- if a
// future feature seems to need a write call, it does not belong in this
// file, and it does not belong in this app's V1.
import { getAccessToken } from './amazonAuth.js';
import { config } from './config.js';
import { parseJsonPreservingIdFields } from './safeJson.js';

const REGION_HOSTS = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
};

export class AmazonApiError extends Error {}

function regionHost() {
  return REGION_HOSTS[config.region] ?? REGION_HOSTS.NA;
}

// GET /v2/profiles -- lists every Advertising profile this LWA account can
// access, across every marketplace. Used only to validate the configured
// AMAZON_ADS_PROFILE_ID actually belongs to a US marketplace profile.
export async function listProfiles() {
  const token = await getAccessToken();
  const res = await fetch(`${regionHost()}/v2/profiles`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Amazon-Advertising-API-ClientId': config.clientId,
    },
  });
  const text = await res.text();

  if (!res.ok) {
    let description = `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text);
      description = body.details || body.message || description;
    } catch {
      // non-JSON error body -- keep the generic HTTP status description
    }
    throw new AmazonApiError(`Amazon Ads profile list failed: ${description}`);
  }

  // profileId (and, if this client ever grows, campaignId/adGroupId/
  // keywordId) can exceed Number.MAX_SAFE_INTEGER -- see safeJson.js.
  return parseJsonPreservingIdFields(text, ['profileId']);
}
