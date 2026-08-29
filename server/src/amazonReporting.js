// READ-ONLY Amazon Ads Reporting API (v3, async reports).
//
// HARD RULE: this file must only ever be used to REQUEST and DOWNLOAD a
// performance report. The POST to /reporting/reports below is Amazon's
// own documented mechanism for generating a downloadable report -- it is
// a read operation from Zaphira's perspective (it returns performance
// data; it never creates, changes, or deletes any campaign, ad group,
// keyword, bid, or budget). This file must never gain a call that
// mutates an advertising object.
//
// Endpoint/version note (verified against Amazon's current public docs
// and real-world integrations as of this fix): POST /reporting/reports
// and GET /reporting/reports/{reportId}, with
// Content-Type: application/vnd.createasyncreportrequest.v3+json, is
// Amazon's current "Reporting API v3" -- the SAME API that Amazon's
// "Unified Reporting" (GA June 2026) is delivered through (Amazon's own
// announcement describes unified reporting as accessible via the Ads
// Console, this Reporting API, and Marketing Stream -- not a separate
// endpoint). The legacy system Amazon is sunsetting Dec 31, 2026 is the
// older per-product v2 report API (e.g. POST /v2/sp/campaigns/report),
// which this codebase has never used. There is no separate "Unified
// Reporting API" to migrate to -- we are already on the current one.
import zlib from 'node:zlib';
import { getAccessToken } from './amazonAuth.js';
import { config } from './config.js';
import { logInfo, logError, sanitize } from './logger.js';

const REGION_HOSTS = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
};

function regionHost() {
  return REGION_HOSTS[config.region] ?? REGION_HOSTS.NA;
}

// Overridable via env var only for tests, so the polling loop's real logic
// (multiple PENDING/PROCESSING polls, and eventually giving up) can be
// exercised without a real wall-clock wait. Production always uses these
// defaults -- neither is meant to be tuned in server/.env.amazon.local.
const DEFAULT_POLL_INTERVAL_MS = Number(process.env.AMAZON_REPORT_POLL_INTERVAL_MS) || 5000;

// Amazon's own guidance and real-world integrations (including production
// connectors that had to raise their own wait window to match) confirm
// Sponsored Products report generation can legitimately take from a few
// minutes up to about 3 hours, and some reports can get stuck in PENDING
// on Amazon's side with no client-side fix (see e.g.
// amzn/ads-advanced-tools-docs issues #340 and #348). Because of that,
// there is deliberately NO short deadline here that fails a sync just
// because Amazon is still working -- this loop is always run in the
// BACKGROUND by campaignSync.js/routes/campaignSync.js, never blocking
// the HTTP request that triggered it, with live progress visible via
// GET /api/amazon/campaigns/status. MAX_POLL_DURATION_MS is only a safety
// ceiling -- generous enough to cover Amazon's own documented worst case
// -- to eventually stop polling a truly abandoned report; raising this
// number is NOT the fix for a slow-but-progressing report, and it is
// never on the critical path of a browser request/response.
const MAX_POLL_DURATION_MS = Number(process.env.AMAZON_REPORT_MAX_POLL_MS) || 3 * 60 * 60 * 1000;

// Do not assume a single "completed" string. Amazon's v3 Reporting API
// documents COMPLETED as the terminal success status; SUCCESS is accepted
// defensively as an alias some Amazon Ads endpoints use elsewhere in the
// ecosystem. Either way, completion additionally requires a download
// `url` to be present (see waitForReportUrl) before anything is treated
// as ready, so a stray/incorrect status string alone can never trigger a
// download.
const COMPLETE_STATUSES = new Set(['COMPLETED', 'SUCCESS']);
const FAILURE_STATUSES = new Set(['FAILURE', 'FAILED', 'CANCELLED', 'CANCELED']);
const KNOWN_IN_PROGRESS_STATUSES = new Set(['PENDING', 'PROCESSING', 'IN_PROGRESS']);

export class AmazonReportingError extends Error {}

function snippet(text) {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export async function requestCampaignReport(startDate, endDate) {
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
  return { httpStatus: res.status, body: JSON.parse(text) };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polls the SAME reportId (never requests a new report) until Amazon
// reports a terminal status. Every attempt is safely logged with exactly:
// reportId, HTTP status, Amazon report status, attempt number, and a
// sanitized error/message when present -- never a token, secret, or
// Authorization header (sanitize() from logger.js redacts those). `onPoll`
// lets the caller (campaignSync.js) mirror live progress into
// campaignSyncState without this module needing to know about that store.
export async function waitForReportUrl(reportId, { pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, maxDurationMs = MAX_POLL_DURATION_MS, sleep = defaultSleep, onPoll } = {}) {
  const deadline = Date.now() + maxDurationMs;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const { httpStatus, body } = await pollReportStatus(reportId);
    const amazonStatus = typeof body?.status === 'string' ? body.status : 'UNKNOWN';

    logInfo('Amazon campaign report poll', sanitize({ reportId, httpStatus, amazonStatus, attempt }));
    if (onPoll) onPoll({ reportId, attempt, status: amazonStatus });

    if (COMPLETE_STATUSES.has(amazonStatus)) {
      if (!body.url) throw new AmazonReportingError('Amazon report reported complete but returned no download URL.');
      return body.url;
    }
    if (FAILURE_STATUSES.has(amazonStatus)) {
      const reasonText = sanitize(String(body.failureReason || body.message || amazonStatus));
      throw new AmazonReportingError(`Amazon report generation failed: ${reasonText}`);
    }
    if (!KNOWN_IN_PROGRESS_STATUSES.has(amazonStatus)) {
      // Not one of the documented statuses this code recognizes as
      // "still generating" either -- log loudly so a real operator
      // notices immediately if Amazon introduces a new status, rather
      // than silently guessing at what it means. We keep polling: an
      // unrecognized status is not, by itself, proof of failure.
      logError('Amazon campaign report returned an unrecognized status -- continuing to poll', sanitize({ reportId, amazonStatus, attempt }));
    }

    if (Date.now() > deadline) {
      throw new AmazonReportingError(
        `Gave up after ${attempt} polling attempts (safety ceiling of ${Math.round(maxDurationMs / 60000)} minutes reached) waiting for the Amazon report to finish generating. Last known status: ${amazonStatus}.`,
      );
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
// allows tests to inject a fake `sleep`/short `maxDurationMs`, and lets
// the caller pass `onPoll` for live progress -- see waitForReportUrl.
export async function fetchCampaignPerformanceReport(startDate, endDate, deps = {}) {
  const reportId = await requestCampaignReport(startDate, endDate);
  logInfo('Amazon campaign report requested', sanitize({ reportId }));
  const url = await waitForReportUrl(reportId, deps);
  return downloadReport(url);
}
