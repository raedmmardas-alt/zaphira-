// Targeting sync routes.
//
// HARD RULE, enforced by review not just convention: this router must only
// ever contain GET /status, GET /result, and POST /sync (itself a
// READ-ONLY operation -- see the comments in ../amazonTargeting.js and
// ../amazonTargetingReporting.js for why the underlying Amazon calls,
// though HTTP POST, never mutate an advertising object). It must never
// gain a route that creates, pauses, or updates a keyword, targeting
// clause, ad group, or bid.
//
// POST /sync does NOT wait for Amazon's report to finish -- it kicks off
// the report request and returns almost immediately, exactly like
// campaign sync (see routes/campaignSync.js): Amazon's own report
// generation can take from a few minutes up to a few hours, which is far
// too long to hold a browser's HTTP request open, so the actual
// polling/download/normalization runs in the background here.
import { Router } from 'express';
import { isConfigured } from '../config.js';
import { syncTargetingData } from '../targetingSync.js';
import {
  markTargetingSyncStarted,
  recordTargetingSyncSuccess,
  recordTargetingSyncError,
  recordTargetingSyncPoll,
  getTargetingSyncStatus,
  isTargetingSyncInProgress,
  setTargetingSyncResult,
  getTargetingSyncResult,
} from '../targetingSyncState.js';
import { logError, sanitize } from '../logger.js';

export const targetingSyncRouter = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value);
}

async function runTargetingSyncInBackground(startDate, endDate, requestedPeriod) {
  try {
    const result = await syncTargetingData(startDate, endDate, {
      onPoll: (progress) => recordTargetingSyncPoll(progress),
    });
    setTargetingSyncResult({
      requestedPeriod,
      rows: result.rows,
      targetingCount: result.targetingCount,
      performanceRowCount: result.performanceRowCount,
      syncedAt: new Date().toISOString(),
    });
    recordTargetingSyncSuccess({ requestedPeriod, rowCount: result.rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error during targeting sync.';
    logError('Targeting sync failed', sanitize({ message }));
    recordTargetingSyncError(message);
  }
}

targetingSyncRouter.get('/status', (_req, res) => {
  res.json(getTargetingSyncStatus());
});

// The most recently completed sync's normalized rows, if any -- picked up
// by the frontend once GET /status shows syncInProgress:false with no
// lastSyncError.
targetingSyncRouter.get('/result', (_req, res) => {
  const result = getTargetingSyncResult();
  if (!result) {
    return res.status(200).json({ success: false, error: 'No completed targeting sync result is available yet.' });
  }
  return res.status(200).json({ success: true, ...result });
});

targetingSyncRouter.post('/sync', async (req, res) => {
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
  if (isTargetingSyncInProgress()) {
    return res.status(200).json({
      success: false,
      error: 'A targeting sync is already in progress. Please wait for it to finish before starting another.',
    });
  }

  if (!isConfigured()) {
    const message = 'Amazon Ads credentials are not configured. Run `npm run setup` in server/ first.';
    recordTargetingSyncError(message);
    return res.status(200).json({ success: false, error: message });
  }

  const requestedPeriod = { start: startDate, end: endDate };
  markTargetingSyncStarted();

  // Deliberately not awaited -- see the module comment above.
  void runTargetingSyncInBackground(startDate, endDate, requestedPeriod);

  return res.status(202).json({
    success: true,
    pending: true,
    requestedPeriod,
    message: 'Amazon is generating the targeting report. This can take a few minutes up to a few hours -- check Settings for live progress.',
  });
});
