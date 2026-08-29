// Campaign sync routes.
//
// HARD RULE, enforced by review not just convention: this router must only
// ever contain GET /status and POST /sync (itself a READ-ONLY operation --
// see the comments in ../amazonCampaigns.js and ../amazonReporting.js for
// why the underlying Amazon calls, though HTTP POST, never mutate an
// advertising object). It must never gain a route that creates, pauses,
// or updates a campaign, ad group, keyword, bid, or budget.
import { Router } from 'express';
import { isConfigured } from '../config.js';
import { syncCampaignData } from '../campaignSync.js';
import { recordCampaignSyncSuccess, recordCampaignSyncError, getCampaignSyncStatus } from '../campaignSyncState.js';
import { logError, sanitize } from '../logger.js';

export const campaignSyncRouter = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value);
}

campaignSyncRouter.get('/status', (_req, res) => {
  res.json(getCampaignSyncStatus());
});

campaignSyncRouter.post('/sync', async (req, res) => {
  const { startDate, endDate } = req.body ?? {};

  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    return res.status(200).json({
      success: false,
      error: 'Provide a valid startDate and endDate (YYYY-MM-DD), with startDate on or before endDate.',
    });
  }

  if (!isConfigured()) {
    const message = 'Amazon Ads credentials are not configured. Run `npm run setup` in server/ first.';
    recordCampaignSyncError(message);
    return res.status(200).json({ success: false, error: message });
  }

  try {
    const result = await syncCampaignData(startDate, endDate);
    const requestedPeriod = { start: startDate, end: endDate };
    recordCampaignSyncSuccess({ requestedPeriod, rowCount: result.rows.length });
    return res.status(200).json({
      success: true,
      requestedPeriod,
      rows: result.rows,
      campaignCount: result.campaignCount,
      performanceRowCount: result.performanceRowCount,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error during campaign sync.';
    logError('Campaign sync failed', sanitize({ message }));
    recordCampaignSyncError(message);
    return res.status(200).json({ success: false, error: message });
  }
});
