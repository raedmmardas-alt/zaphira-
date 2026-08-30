// READ-ONLY Amazon Ads Reporting API (v3, async reports) for Sponsored
// Products TARGETING performance. Reuses the exact same polling/download
// mechanics already validated against a real Amazon account for campaign
// sync (waitForReportUrl, downloadReport, both from amazonReporting.js) --
// this file only adds the targeting-specific report request body, so
// campaign sync's own request-building code is completely untouched.
//
// HARD RULE: this file must only ever be used to REQUEST and DOWNLOAD a
// performance report. It must never gain a call that creates, updates,
// pauses, or deletes a keyword, targeting clause, or bid.
//
// Column choice: campaignId, adGroupId, keywordId, matchType, keyword,
// impressions, clicks, cost, purchases1d match Amazon's own documented
// spTargeting report example exactly; sales1d is the same universal sales
// metric column already proven against the real account for the
// spCampaigns report. Deliberately no `keywordType` filter, so BOTH
// keyword targets and product/category targeting clauses come back in
// one report (Amazon's v3 spTargeting report type covers both under one
// reportTypeId/groupBy).
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

export async function requestTargetingReport(startDate, endDate) {
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
      name: 'Zaphira SP targeting performance report',
      startDate,
      endDate,
      configuration: {
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['targeting'],
        columns: ['campaignId', 'adGroupId', 'keywordId', 'matchType', 'keyword', 'impressions', 'clicks', 'cost', 'purchases1d', 'sales1d'],
        reportTypeId: 'spTargeting',
        timeUnit: 'SUMMARY',
        format: 'GZIP_JSON',
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new AmazonReportingError(`Amazon targeting report request failed (HTTP ${res.status}): ${snippet(text)}`);
  }
  const data = JSON.parse(text);
  if (!data.reportId) throw new AmazonReportingError('Amazon targeting report request did not return a reportId.');
  return data.reportId;
}

// Requests, waits for, and downloads a Sponsored Products targeting
// performance report for [startDate, endDate] (both YYYY-MM-DD). `deps`
// allows tests to inject a fake `sleep`/short `maxDurationMs`, and lets
// the caller pass `onPoll` for live progress -- see amazonReporting.js's
// waitForReportUrl, which this reuses unchanged.
export async function fetchTargetingPerformanceReport(startDate, endDate, deps = {}) {
  const reportId = await requestTargetingReport(startDate, endDate);
  logInfo('Amazon targeting report requested', sanitize({ reportId }));
  const url = await waitForReportUrl(reportId, deps);
  return downloadReport(url);
}
