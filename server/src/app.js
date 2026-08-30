// Builds the Express app. Separated from index.js (which calls .listen())
// so tests can exercise the app directly without needing a live port bind
// tied to the module's side-effecting startup log lines.
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { amazonRouter } from './routes/amazon.js';
import { campaignSyncRouter } from './routes/campaignSync.js';
import { targetingSyncRouter } from './routes/targetingSync.js';
import { searchTermSyncRouter } from './routes/searchTermSync.js';
import { advertisedProductSyncRouter } from './routes/advertisedProductSync.js';

// Localhost is always allowed, in every environment -- this is what keeps
// local development (npm start, default port 4001) working exactly as
// before, whether this same code is running locally or deployed. In
// production, config.corsAllowedOrigin (default
// https://zaphira.raedmirdas.com, overridable via CORS_ALLOWED_ORIGIN)
// additionally allows the deployed frontend's own origin. No other origin
// is ever allowed -- there is no wildcard.
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedOrigin(origin) {
  if (!origin) return true; // non-browser callers (curl, server-to-server) carry no Origin header -- unchanged, pre-existing behavior
  if (LOCALHOST_ORIGIN.test(origin)) return true;
  return origin === config.corsAllowedOrigin;
}

export function createApp() {
  const app = express();
  app.use(cors({ origin: (origin, cb) => cb(null, isAllowedOrigin(origin)) }));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true, readOnly: true }));
  app.use('/api/amazon', amazonRouter);
  app.use('/api/amazon/campaigns', campaignSyncRouter);
  app.use('/api/amazon/targeting', targetingSyncRouter);
  app.use('/api/amazon/searchterms', searchTermSyncRouter);
  app.use('/api/amazon/advertisedproducts', advertisedProductSyncRouter);

  // Anything else -- deliberately a 404, not a catch-all proxy. This
  // backend exposes exactly the routes in routes/amazon.js and nothing else.
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}
