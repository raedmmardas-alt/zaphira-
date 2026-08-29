// Builds the Express app. Separated from index.js (which calls .listen())
// so tests can exercise the app directly without needing a live port bind
// tied to the module's side-effecting startup log lines.
import express from 'express';
import cors from 'cors';
import { amazonRouter } from './routes/amazon.js';
import { campaignSyncRouter } from './routes/campaignSync.js';
import { targetingSyncRouter } from './routes/targetingSync.js';

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function createApp() {
  const app = express();
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || LOCALHOST_ORIGIN.test(origin)) }));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true, readOnly: true }));
  app.use('/api/amazon', amazonRouter);
  app.use('/api/amazon/campaigns', campaignSyncRouter);
  app.use('/api/amazon/targeting', targetingSyncRouter);

  // Anything else -- deliberately a 404, not a catch-all proxy. This
  // backend exposes exactly the routes in routes/amazon.js and nothing else.
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}
