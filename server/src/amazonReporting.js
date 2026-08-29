// READ-ONLY Amazon Ads Reporting API (v3, async reports).
//
// HARD RULE: this file must only ever be used to REQUEST and DOWNLOAD a
// performance report. The POST to /reporting/reports below is Amazon's
// own documented mechanism for generating a downloadable report -- it is
// a read operation from Zaphira's perspective (it returns performance
// data; it never creates, changes, or deletes any campaign, ad group,
// keyword, bid, or budget). This file must never gain a call that
// mutates an advertising object.
import zlib from 'node:zlib';
import { getAccessToken } from './amazonAuth.js';
import { config } from './config.js';

const REGION_HOSTS = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
};

function regionHost() {
  return REGION_HOSTS[config.region] ?? REGION_HOSTS.NA;
}

// Overridable via env var only for tests, so the polling loop's real logic
// (including waiting through multiple PENDING/PROCESSING responses) can be
// exercised without a real multi-second wall-clock wait. Production always
// uses the 2000ms default -- this is never meant to be tuned in
// server/.env.amazon.local.
const DEFAULT_POLL_INTERVAL_MS = Number(process.env.AMAZON_REPORT_POLL_INTERVAL_MS) || 2000;
const DEFAULT_TIMEOUT_MS = 60_000;

export class AmazonReportingError extends Error {}

function snippet(text) {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

async function requestCampaignReport(startDate, endDate) {
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
      name: 'Zaphira SP campaign performance report',
      startDate,
      endDate,
      configuration: {
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['campaign'],
        columns: ['campaignId', 'campaignName', 'impressions', 'clicks', 'cost', 'purchases1d', 'sales1d'],
        reportTypeId: 'spCampaigns',
        timeUnit: 'SUMMARY',
        format: 'GZIP_JSON',
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new AmazonReportingError(`Amazon report request failed (HTTP ${res.status}): ${snippet(text)}`);
  }
  const data = JSON.parse(text);
  if (!data.reportId) throw new AmazonReportingError('Amazon report request did not return a reportId.');
  return data.reportId;
}

async function pollReportStatus(reportId) {
  const token = await getAccessToken();
  const res = await fetch(`${regionHost()}/reporting/reports/${encodeURIComponent(reportId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Amazon-Advertising-API-ClientId': config.clientId,
      'Amazon-Advertising-API-Scope': config.profileId,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new AmazonReportingError(`Amazon report status check failed (HTTP ${res.status}): ${snippet(text)}`);
  return JSON.parse(text);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReportUrl(reportId, { pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS, sleep = defaultSleep } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await pollReportStatus(reportId);
    if (status.status === 'COMPLETED' || status.status === 'SUCCESS') {
      if (!status.url) throw new AmazonReportingError('Amazon report completed but returned no download URL.');
      return status.url;
    }
    if (status.status === 'FAILURE' || status.status === 'CANCELLED') {
      throw new AmazonReportingError(`Amazon report generation failed: ${status.failureReason || status.status}`);
    }
    if (Date.now() > deadline) {
      throw new AmazonReportingError('Timed out waiting for the Amazon report to finish generating.');
    }
    await sleep(pollIntervalMs);
  }
}

async function downloadReport(url) {
  // Pre-signed download URL -- no Authorization header sent.
  const res = await fetch(url);
  if (!res.ok) throw new AmazonReportingError(`Failed to download the Amazon report (HTTP ${res.status}).`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const decompressed = zlib.gunzipSync(buffer);
  return JSON.parse(decompressed.toString('utf8'));
}

// Requests, waits for, and downloads a Sponsored Products campaign
// performance report for [startDate, endDate] (both YYYY-MM-DD). `deps`
// allows tests to inject a fake `sleep` so polling never waits on a real
// timer.
export async function fetchCampaignPerformanceReport(startDate, endDate, deps = {}) {
  const reportId = await requestCampaignReport(startDate, endDate);
  const url = await waitForReportUrl(reportId, deps);
  return downloadReport(url);
}
