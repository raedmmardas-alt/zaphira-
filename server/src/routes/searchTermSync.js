// Search term sync routes.
//
// HARD RULE, enforced by review not just convention: this router must only
// ever contain GET /status, GET /result, and POST /sync (itself a
// READ-ONLY operation -- see the comments in ../amazonSearchTermReporting.js
// for why the underlying Amazon calls, though HTTP POST, never mutate an
// advertising object). It must never gain a route that creates, pauses,
// or updates a campaign, ad group, keyword, or bid.
//
// POST /sync does NOT wait for Amazon's report to finish -- it kicks off
// the report request and returns almost immediately, exactly like
// campaign/targeting sync: Amazon's own report generation can take from a
// few minutes up to a few hours, which is far too long to hold a
// browser's HTTP request open, so the actual polling/download/
// normalization runs in the background here.
import { Router } from 'express';
import { isConfigured } from '../config.js';
import { syncSearchTermData } from '../searchTermSync.js';
import {
  markSearchTermSyncStarted,
  recordSearchTermSyncSuccess,
  recordSearchTermSyncError,
  recordSearchTermSyncPoll,
  getSearchTermSyncStatus,
  isSearchTermSyncInProgress,
  setSearchTermSyncResult,
  getSearchTermSyncResult,
} from '../searchTermSyncState.js';
import { logError, sanitize } from '../logger.js';

export const searchTermSyncRouter = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value);
}

async function runSearchTermSyncInBackground(startDate, endDate, requestedPeriod) {
  try {
    const result = await syncSearchTermData(startDate, endDate, {
      onPoll: (progress) => recordSearchTermSyncPoll(progress),
    });
    setSearchTermSyncResult({
      requestedPeriod,
      rows: result.rows,
      performanceRowCount: result.performanceRowCount,
      syncedAt: new Date().toISOString(),
    });
    recordSearchTermSyncSuccess({ requestedPeriod, rowCount: result.rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error during search term sync.';
    logError('Search term sync failed', sanitize({ message }));
    recordSearchTermSyncError(message);
  }
}

searchTermSyncRouter.get('/status', (_req, res) => {
  res.json(getSearchTermSyncStatus());
});

searchTermSyncRouter.get('/result', (_req, res) => {
  const result = getSearchTermSyncResult();
  if (!result) {
    return res.status(200).json({ success: false, error: 'No completed search term sync result is available yet.' });
  }
  return res.status(200).json({ success: true, ...result });
});

searchTermSyncRouter.post('/sync', async (req, res) => {
  const { startDate, endDate } = req.body ?? {};

  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    return res.status(200).json({
      success: false,
      error: 'Provide a valid startDate and endDate (YYYY-MM-DD), with startDate on or before endDate.',
    });
  }

  if (isSearchTermSyncInProgress()) {
    return res.status(200).json({
      success: false,
      error: 'A search term sync is already in progress. Please wait for it to finish before starting another.',
    });
  }

  if (!isConfigured()) {
    const message = 'Amazon Ads credentials are not configured. Run `npm run setup` in server/ first.';
    recordSearchTermSyncError(message);
    return res.status(200).json({ success: false, error: message });
  }

  const requestedPeriod = { start: startDate, end: endDate };
  markSearchTermSyncStarted();

  void runSearchTermSyncInBackground(startDate, endDate, requestedPeriod);

  return res.status(202).json({
    success: true,
    pending: true,
    requestedPeriod,
    message: 'Amazon is generating the search term report. This can take a few minutes up to a few hours -- check Settings for live progress.',
  });
});
