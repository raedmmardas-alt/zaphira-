// Advertised product sync routes.
//
// HARD RULE, enforced by review not just convention: this router must only
// ever contain GET /status, GET /result, and POST /sync (itself a
// READ-ONLY operation -- see the comments in
// ../amazonAdvertisedProductReporting.js for why the underlying Amazon
// calls, though HTTP POST, never mutate an advertising object). It must
// never gain a route that creates, pauses, or updates a campaign, ad
// group, product ad, keyword, or bid.
//
// POST /sync does NOT wait for Amazon's report to finish -- it kicks off
// the report request and returns almost immediately, exactly like every
// other sync type in this app.
import { Router } from 'express';
import { isConfigured } from '../config.js';
import { syncAdvertisedProductData } from '../advertisedProductSync.js';
import {
  markAdvertisedProductSyncStarted,
  recordAdvertisedProductSyncSuccess,
  recordAdvertisedProductSyncError,
  recordAdvertisedProductSyncPoll,
  getAdvertisedProductSyncStatus,
  isAdvertisedProductSyncInProgress,
  setAdvertisedProductSyncResult,
  getAdvertisedProductSyncResult,
} from '../advertisedProductSyncState.js';
import { logError, sanitize } from '../logger.js';

export const advertisedProductSyncRouter = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value);
}

async function runAdvertisedProductSyncInBackground(startDate, endDate, requestedPeriod) {
  try {
    const result = await syncAdvertisedProductData(startDate, endDate, {
      onPoll: (progress) => recordAdvertisedProductSyncPoll(progress),
    });
    setAdvertisedProductSyncResult({
      requestedPeriod,
      rows: result.rows,
      performanceRowCount: result.performanceRowCount,
      syncedAt: new Date().toISOString(),
    });
    recordAdvertisedProductSyncSuccess({ requestedPeriod, rowCount: result.rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error during advertised product sync.';
    logError('Advertised product sync failed', sanitize({ message }));
    recordAdvertisedProductSyncError(message);
  }
}

advertisedProductSyncRouter.get('/status', (_req, res) => {
  res.json(getAdvertisedProductSyncStatus());
});

advertisedProductSyncRouter.get('/result', (_req, res) => {
  const result = getAdvertisedProductSyncResult();
  if (!result) {
    return res.status(200).json({ success: false, error: 'No completed advertised product sync result is available yet.' });
  }
  return res.status(200).json({ success: true, ...result });
});

advertisedProductSyncRouter.post('/sync', async (req, res) => {
  const { startDate, endDate } = req.body ?? {};

  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    return res.status(200).json({
      success: false,
      error: 'Provide a valid startDate and endDate (YYYY-MM-DD), with startDate on or before endDate.',
    });
  }

  if (isAdvertisedProductSyncInProgress()) {
    return res.status(200).json({
      success: false,
      error: 'An advertised product sync is already in progress. Please wait for it to finish before starting another.',
    });
  }

  if (!isConfigured()) {
    const message = 'Amazon Ads credentials are not configured. Run `npm run setup` in server/ first.';
    recordAdvertisedProductSyncError(message);
    return res.status(200).json({ success: false, error: message });
  }

  const requestedPeriod = { start: startDate, end: endDate };
  markAdvertisedProductSyncStarted();

  void runAdvertisedProductSyncInBackground(startDate, endDate, requestedPeriod);

  return res.status(202).json({
    success: true,
    pending: true,
    requestedPeriod,
    message: 'Amazon is generating the advertised product report. This can take a few minutes up to a few hours -- check Settings for live progress.',
  });
});
