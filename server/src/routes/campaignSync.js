// Campaign sync routes.
//
// HARD RULE, enforced by review not just convention: this router must only
// ever contain GET /status, GET /result, and POST /sync (itself a
// READ-ONLY operation -- see the comments in ../amazonCampaigns.js and
// ../amazonReporting.js for why the underlying Amazon calls, though HTTP
// POST, never mutate an advertising object). It must never gain a route
// that creates, pauses, or updates a campaign, ad group, keyword, bid, or
// budget.
//
// POST /sync does NOT wait for Amazon's report to finish -- it kicks off
// the report request and returns almost immediately. Amazon's own report
// generation can take from a few minutes up to a few hours (see
// ../amazonReporting.js), which is far too long to hold a browser's HTTP
// request open, so the actual polling/download/normalization runs in the
// background here; the frontend watches live progress via GET /status and
// fetches the finished rows via GET /result once syncInProgress is false.
import { Router } from 'express';
import { isConfigured } from '../config.js';
import { syncCampaignData } from '../campaignSync.js';
import {
  markCampaignSyncStarted,
  recordCampaignSyncSuccess,
  recordCampaignSyncError,
  recordCampaignSyncPoll,
  getCampaignSyncStatus,
  isCampaignSyncInProgress,
  setCampaignSyncResult,
  getCampaignSyncResult,
} from '../campaignSyncState.js';
import { logError, sanitize } from '../logger.js';

export const campaignSyncRouter = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value);
}

async function runCampaignSyncInBackground(startDate, endDate, requestedPeriod) {
  try {
    const result = await syncCampaignData(startDate, endDate, {
      onPoll: (progress) => recordCampaignSyncPoll(progress),
    });
    setCampaignSyncResult({
      requestedPeriod,
      rows: result.rows,
      campaignCount: result.campaignCount,
      performanceRowCount: result.performanceRowCount,
      syncedAt: new Date().toISOString(),
    });
    recordCampaignSyncSuccess({ requestedPeriod, rowCount: result.rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error during campaign sync.';
    logError('Campaign sync failed', sanitize({ message }));
    recordCampaignSyncError(message);
  }
}

campaignSyncRouter.get('/status', (_req, res) => {
  res.json(getCampaignSyncStatus());
});

// The most recently completed sync's normalized rows, if any -- picked up
// by the frontend once GET /status shows syncInProgress:false with no
// lastSyncError.
campaignSyncRouter.get('/result', (_req, res) => {
  const result = getCampaignSyncResult();
  if (!result) {
    return res.status(200).json({ success: false, error: 'No completed campaign sync result is available yet.' });
  }
  return res.status(200).json({ success: true, ...result });
});

campaignSyncRouter.post('/sync', async (req, res) => {
  const { startDate, endDate } = req.body ?? {};

  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    return res.status(200).json({
      success: false,
      error: 'Provide a valid startDate and endDate (YYYY-MM-DD), with startDate on or before endDate.',
    });
  }

  // Guards against a double-click, a second browser tab, or a retried
  // request starting a second Amazon report while one is still being
  // generated -- never creates a second report for an overlapping request.
  if (isCampaignSyncInProgress()) {
    return res.status(200).json({
      success: false,
      error: 'A campaign sync is already in progress. Please wait for it to finish before starting another.',
    });
  }

  if (!isConfigured()) {
    const message = 'Amazon Ads credentials are not configured. Run `npm run setup` in server/ first.';
    recordCampaignSyncError(message);
    return res.status(200).json({ success: false, error: message });
  }

  const requestedPeriod = { start: startDate, end: endDate };
  markCampaignSyncStarted();

  // Deliberately not awaited -- see the module comment above.
  void runCampaignSyncInBackground(startDate, endDate, requestedPeriod);

  return res.status(202).json({
    success: true,
    pending: true,
    requestedPeriod,
    message: 'Amazon is generating the campaign report. This can take a few minutes up to a few hours -- check Settings for live progress.',
  });
});
