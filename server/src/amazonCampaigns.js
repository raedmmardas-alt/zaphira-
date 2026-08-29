// READ-ONLY Sponsored Products campaign list.
//
// HARD RULE: this file must only ever call Amazon's "list" (retrieval)
// endpoint for campaigns. Amazon Ads API v3's list/search endpoints use
// POST-with-a-filter-body as their convention (not GET+querystring), but
// this is still a read operation -- it returns existing campaigns and
// never creates, updates, or deletes one. This file must never add a call
// that creates a campaign, changes its state (enable/pause/archive),
// changes its budget, or changes a bid.
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

export class AmazonCampaignsError extends Error {}

// Returns every Sponsored Products campaign's CURRENT live state
// (ENABLED/PAUSED/ARCHIVED) and daily budget -- authoritative for "is this
// campaign live right now," never inferred from historical
// impressions/clicks. Paginates via nextToken until exhausted.
export async function listSpCampaigns() {
  const campaigns = [];
  let nextToken;
  do {
    const token = await getAccessToken();
    const res = await fetch(`${regionHost()}/sp/campaigns/list`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Amazon-Advertising-API-ClientId': config.clientId,
        'Amazon-Advertising-API-Scope': config.profileId,
        'Content-Type': 'application/vnd.spCampaign.v3+json',
        Accept: 'application/vnd.spCampaign.v3+json',
      },
      body: JSON.stringify({ maxResults: 100, ...(nextToken ? { nextToken } : {}) }),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new AmazonCampaignsError(`Amazon campaign list failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }

    // campaignId can exceed Number.MAX_SAFE_INTEGER -- see safeJson.js.
    const data = parseJsonPreservingIdFields(text, ['campaignId']);
    campaigns.push(...(data.campaigns ?? []));
    nextToken = data.nextToken;
  } while (nextToken);

  return campaigns;
}
