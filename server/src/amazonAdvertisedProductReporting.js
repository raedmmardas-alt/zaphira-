// READ-ONLY Amazon Ads Reporting API (v3, async reports) for Sponsored
// Products ADVERTISED PRODUCT performance. Like search terms, this is
// period-performance data only -- reuses the exact same polling/download
// mechanics already validated for campaign/targeting sync
// (waitForReportUrl, downloadReport, both from amazonReporting.js), so no
// other sync's request-building code is touched.
//
// HARD RULE: this file must only ever be used to REQUEST and DOWNLOAD a
// performance report. It must never gain a call that creates, updates,
// pauses, or deletes a product ad, campaign, ad group, keyword, or bid.
//
// Column/reportTypeId choice: reportTypeId "spAdvertisedProduct" with
// groupBy ["advertiser"] and the advertisedAsin/advertisedSku field names
// match a real, confirmed Amazon-documented example request for this
// exact report type (unlike search terms, this one was independently
// verified, not just inferred from naming convention).
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

export async function requestAdvertisedProductReport(startDate, endDate) {
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
      name: 'Zaphira SP advertised product performance report',
      startDate,
      endDate,
      configuration: {
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['advertiser'],
        columns: ['campaignId', 'adGroupId', 'advertisedAsin', 'advertisedSku', 'impressions', 'clicks', 'cost', 'purchases1d', 'sales1d'],
        reportTypeId: 'spAdvertisedProduct',
        timeUnit: 'SUMMARY',
        format: 'GZIP_JSON',
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new AmazonReportingError(`Amazon advertised product report request failed (HTTP ${res.status}): ${snippet(text)}`);
  }
  const data = JSON.parse(text);
  if (!data.reportId) throw new AmazonReportingError('Amazon advertised product report request did not return a reportId.');
  return data.reportId;
}

// Requests, waits for, and downloads a Sponsored Products advertised
// product performance report for [startDate, endDate] (both YYYY-MM-DD).
// `deps` allows tests to inject a fake `sleep`/short `maxDurationMs`, and
// lets the caller pass `onPoll` for live progress.
export async function fetchAdvertisedProductPerformanceReport(startDate, endDate, deps = {}) {
  const reportId = await requestAdvertisedProductReport(startDate, endDate);
  logInfo('Amazon advertised product report requested', sanitize({ reportId }));
  const url = await waitForReportUrl(reportId, deps);
  return downloadReport(url);
}
