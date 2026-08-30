// Backend entry point. Local development binds to 127.0.0.1 only -- never
// reachable from outside the machine it runs on -- exactly as before. In
// production (Railway sets PORT), it binds to 0.0.0.0 so the platform can
// route traffic to it; see config.js's resolveListenTarget(). Either way,
// CORS still restricts which origins may call it (see app.js) -- binding
// to 0.0.0.0 is not the same as being open to arbitrary callers.
import { createApp } from './app.js';
import { isConfigured, missingConfigKeys, resolveListenTarget } from './config.js';
import { logInfo } from './logger.js';

const app = createApp();
const { host, port } = resolveListenTarget();

app.listen(port, host, () => {
  logInfo(`READ-ONLY Amazon Ads backend listening on http://${host}:${port}`);
  if (!isConfigured()) {
    logInfo('Amazon Ads credentials are not configured yet.', { missing: missingConfigKeys() });
    logInfo('Run `npm run setup` in this directory to import your local credential files.');
  }
});
