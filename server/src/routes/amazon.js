// Amazon Ads API routes.
//
// HARD RULE, enforced by review not just by convention: this router must
// only ever contain GET /status and POST /test-connection. It must never
// gain a route that creates, pauses, or updates a campaign/ad group/
// keyword/target/bid/budget, or any other write against Amazon Ads. See
// server/README.md's "Read-only guarantee" section and
// server/test/writeSafety.test.js, which fails the build if a write-shaped
// route (POST/PUT/PATCH/DELETE other than this file's own
// /test-connection) is ever registered on this router.
import { Router } from 'express';
import { config, isConfigured } from '../config.js';
import { listProfiles, AmazonApiError } from '../amazonClient.js';
import { AmazonAuthError } from '../amazonAuth.js';
import { getStatus, recordSuccess, recordError } from '../connectionState.js';
import { logError, sanitize } from '../logger.js';

export const amazonRouter = Router();

amazonRouter.get('/status', (_req, res) => {
  res.json(getStatus());
});

amazonRouter.post('/test-connection', async (_req, res) => {
  if (!isConfigured()) {
    const message = 'Amazon Ads credentials are not configured. Run `npm run setup` in server/ first.';
    recordError(message);
    return res.status(200).json({ success: false, error: message, ...getStatus() });
  }

  try {
    const profiles = await listProfiles();
    const match = Array.isArray(profiles) ? profiles.find((p) => String(p.profileId) === String(config.profileId)) : null;

    if (!match) {
      const message = `Configured profile ID was not found among the profiles returned for this account. Refusing to guess a different one.`;
      recordError(message);
      return res.status(200).json({ success: false, error: message, ...getStatus() });
    }

    if (match.countryCode !== 'US') {
      // Never silently fall back to a non-US profile.
      const message = `Configured profile is not a United States marketplace profile (found countryCode: ${match.countryCode}). Refusing to use it.`;
      recordError(message);
      return res.status(200).json({ success: false, error: message, ...getStatus() });
    }

    recordSuccess({ marketplace: 'US', profileId: config.profileId });
    return res.status(200).json({ success: true, ...getStatus() });
  } catch (err) {
    const message = err instanceof AmazonAuthError || err instanceof AmazonApiError
      ? err.message
      : 'Unexpected error while testing the Amazon Ads connection.';
    logError('Test connection failed', sanitize({ message: err instanceof Error ? err.message : String(err) }));
    recordError(message);
    return res.status(200).json({ success: false, error: message, ...getStatus() });
  }
});
