// Local-only backend entry point. Binds to 127.0.0.1 only -- never 0.0.0.0
// -- so this process is never reachable from outside the machine it runs
// on, let alone the internet. CORS is restricted to localhost origins
// only (see app.js), since the only intended caller is the Zaphira PPC
// Control frontend running in a browser on the same machine.
import { createApp } from './app.js';
import { config, isConfigured, missingConfigKeys } from './config.js';
import { logInfo } from './logger.js';

const app = createApp();

app.listen(config.port, '127.0.0.1', () => {
  logInfo(`READ-ONLY Amazon Ads backend listening on http://127.0.0.1:${config.port}`);
  if (!isConfigured()) {
    logInfo('Amazon Ads credentials are not configured yet.', { missing: missingConfigKeys() });
    logInfo('Run `npm run setup` in this directory to import your local credential files.');
  }
});
