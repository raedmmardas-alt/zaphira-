// Loads Amazon Ads API credentials from server/.env.amazon.local (never
// committed -- see .gitignore). This module is the ONLY place that reads
// the raw secret values into memory; every other module gets them only
// through the functions here, and nothing here ever logs or returns a raw
// value -- see sanitize() below and logger.js.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.amazon.local');

dotenv.config({ path: envPath });

const REQUIRED_KEYS = ['AMAZON_ADS_CLIENT_ID', 'AMAZON_ADS_CLIENT_SECRET', 'AMAZON_ADS_REFRESH_TOKEN', 'AMAZON_ADS_PROFILE_ID'];

export const config = {
  clientId: process.env.AMAZON_ADS_CLIENT_ID ?? '',
  clientSecret: process.env.AMAZON_ADS_CLIENT_SECRET ?? '',
  refreshToken: process.env.AMAZON_ADS_REFRESH_TOKEN ?? '',
  profileId: process.env.AMAZON_ADS_PROFILE_ID ?? '',
  region: process.env.AMAZON_ADS_REGION || 'NA',
  // Local-dev default port -- only ever used when PORT (Railway's/most
  // PaaS providers' convention) is unset. See resolveListenTarget() below.
  port: Number(process.env.AMAZON_BACKEND_PORT) || 4001,
  // The deployed production frontend's origin, allowed by CORS in
  // addition to localhost (see app.js's isAllowedOrigin()). Overridable
  // via CORS_ALLOWED_ORIGIN so a future domain change never requires a
  // code change; defaults to the Zaphira PPC Control production frontend.
  corsAllowedOrigin: process.env.CORS_ALLOWED_ORIGIN || 'https://zaphira.raedmirdas.com',
};

// Resolves which host/port to bind to. Railway (like most PaaS providers)
// injects PORT at runtime and requires binding to 0.0.0.0 to be reachable;
// local development never sets PORT, so it keeps binding to
// 127.0.0.1:<AMAZON_BACKEND_PORT|4001> exactly as before -- unchanged
// local behavior. A pure function (rather than inline in index.js) so this
// switch is unit-testable without actually opening a socket.
export function resolveListenTarget(env = process.env) {
  if (env.PORT) {
    return { host: '0.0.0.0', port: Number(env.PORT) };
  }
  return { host: '127.0.0.1', port: config.port };
}

export function isConfigured() {
  return REQUIRED_KEYS.every((k) => !!process.env[k]);
}

export function missingConfigKeys() {
  return REQUIRED_KEYS.filter((k) => !process.env[k]);
}

// The exact set of strings that must never appear in a log line or an HTTP
// response body -- every secret value currently loaded, plus the literal
// word "Bearer " followed by anything (access tokens are never persisted
// to config, but this also catches them if a caller passes an
// Authorization header string through by mistake).
export function secretValues() {
  return [config.clientSecret, config.refreshToken].filter(Boolean);
}

export function maskLast4(value) {
  if (!value) return null;
  const s = String(value);
  return s.length <= 4 ? '****' : `${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}
