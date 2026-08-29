// READ-ONLY Amazon Ads Reporting API (v3, async reports) for Sponsored
// Products SEARCH TERM performance. Search terms are period-performance
// data only -- Amazon exposes no "live status" object for a customer
// search query, so unlike targeting there is no companion list endpoint
// here; this file only ever requests and downloads a report. Reuses the
// exact same polling/download mechanics already validated against a real
// Amazon account for campaign/targeting sync (waitForReportUrl,
// downloadReport, both from amazonReporting.js) -- campaign and targeting
// sync's own request-building code is completely untouched.
//
// HARD RULE: this file must only ever be used to REQUEST and DOWNLOAD a
// performance report. It must never gain a call that creates, updates,
// pauses, or deletes a keyword, targeting clause, or bid.
//
// reportTypeId note: Amazon's v3 Reporting API follows a consistent
// "sp<Concept>" naming scheme confirmed against real, working requests
// for spCampaigns (groupBy ["campaign"]) and spTargeting
// (groupBy ["targeting"]) -- both already validated live against this
// project's own Amazon account. spSearchTerm / groupBy ["searchTerm"]
// follows that same pattern and matches Amazon's own "Search term
// reports" documentation page title, but -- unlike spCampaigns/
// spTargeting -- could not be independently confirmed against a real
// example request during development. If Amazon rejects this request,
// AmazonReportingError below carries Amazon's own rejection message
// through to the sync's lastSyncError unchanged, so the exact problem is
// visible rather than silently swallowed; this is the one Phase 2C/2D
// report type most likely to need a follow-up column/groupBy correction
// once tested against a real account.
import { getAccessToken } from './amazonAuth.js';
import { config } from './config.js';
import { logInfo, sanitize } from './logger.js';
import { AmazonReportingError, waitForReportUrl, downloadReport } from './amazonReporting.js';

const REGION_HOSTS = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
};

function regionHost() {
  return REGION_HOSTS[config.region] ?? REGION_HOSTS.NA;
}

function snippet(text) {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export async function requestSearchTermReport(startDate, endDate) {
  const token = await getAccessToken();
  const res = await fetch(`${regionHost()}/reporting/reports`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Amazon-Advertising-API-ClientId': config.clientId,
      'Amazon-Advertising-API-Scope': config.profileId,
      'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
    },
    body: JSON.stringify({
      name: 'Zaphira SP search term performance report',
      startDate,
      endDate,
      configuration: {
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['searchTerm'],
        columns: ['campaignId', 'adGroupId', 'keywordId', 'matchType', 'keyword', 'searchTerm', 'impressions', 'clicks', 'cost', 'purchases1d', 'sales1d'],
        reportTypeId: 'spSearchTerm',
        timeUnit: 'SUMMARY',
        format: 'GZIP_JSON',
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new AmazonReportingError(`Amazon search term report request failed (HTTP ${res.status}): ${snippet(text)}`);
  }
  const data = JSON.parse(text);
  if (!data.reportId) throw new AmazonReportingError('Amazon search term report request did not return a reportId.');
  return data.reportId;
}

// Requests, waits for, and downloads a Sponsored Products search term
// performance report for [startDate, endDate] (both YYYY-MM-DD). `deps`
// allows tests to inject a fake `sleep`/short `maxDurationMs`, and lets
// the caller pass `onPoll` for live progress -- see amazonReporting.js's
// waitForReportUrl, which this reuses unchanged.
export async function fetchSearchTermPerformanceReport(startDate, endDate, deps = {}) {
  const reportId = await requestSearchTermReport(startDate, endDate);
  logInfo('Amazon search term report requested', sanitize({ reportId }));
  const url = await waitForReportUrl(reportId, deps);
  return downloadReport(url);
}
