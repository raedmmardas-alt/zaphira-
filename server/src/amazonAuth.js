// Amazon LWA access-token refresh. The refresh token and Client Secret are
// read once from config (server/.env.amazon.local) and used only to call
// Amazon's token endpoint -- they are never written anywhere else, never
// logged, and never sent to the browser. The resulting access token lives
// only in the `cachedToken` variable below (process memory) and is
// refreshed automatically shortly before it expires.
import { config } from './config.js';
import { logInfo, logError } from './logger.js';

const TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

let cachedToken = null; // { accessToken, expiresAt } -- memory only, never persisted to disk
let refreshInFlight = null;
let lastRefreshError = null;

export class AmazonAuthError extends Error {}

export function getTokenRefreshStatus() {
  if (lastRefreshError) return { status: 'FAILED', error: lastRefreshError };
  if (cachedToken) return { status: 'OK', expiresAt: new Date(cachedToken.expiresAt).toISOString() };
  return { status: 'NOT_YET_REFRESHED' };
}

// Returns a valid access token, refreshing it first if it's missing or
// due to expire within the next 60 seconds. Concurrent callers share a
// single in-flight refresh instead of each firing their own request.
export async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 60_000) {
    return cachedToken.accessToken;
  }
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function refreshAccessToken() {
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    lastRefreshError = 'Amazon Ads credentials are not configured.';
    throw new AmazonAuthError(lastRefreshError);
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    lastRefreshError = 'Could not reach Amazon\'s token endpoint (network error).';
    logError('Token refresh network error', { message: err instanceof Error ? err.message : String(err) });
    throw new AmazonAuthError(lastRefreshError);
  }

  if (!res.ok) {
    // Amazon's error body for a bad refresh token/client secret is a JSON
    // object like {"error":"invalid_grant","error_description":"..."} --
    // it does not echo the secret back, but the description is still
    // logged/returned through logger.sanitize() as defense in depth.
    let description = `HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      description = errBody.error_description || errBody.error || description;
    } catch {
      // non-JSON error body -- keep the generic HTTP status description
    }
    lastRefreshError = `Amazon token refresh failed: ${description}`;
    logError('Token refresh rejected by Amazon', { status: res.status, description });
    throw new AmazonAuthError(lastRefreshError);
  }

  const data = await res.json();
  if (!data.access_token) {
    lastRefreshError = 'Amazon token refresh response did not include an access token.';
    throw new AmazonAuthError(lastRefreshError);
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  lastRefreshError = null;
  logInfo('Access token refreshed', { expiresInSeconds: Number(data.expires_in) || 3600 });
  return cachedToken.accessToken;
}

// Test-only hook: lets tests reset in-memory state between cases without
// reaching into module internals.
export function __resetForTests() {
  cachedToken = null;
  refreshInFlight = null;
  lastRefreshError = null;
}
