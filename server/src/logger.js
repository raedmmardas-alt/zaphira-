// Every log line and every value that could reach an HTTP response body
// must go through sanitize() first. This redacts the app's own configured
// secrets (Client Secret, refresh token) wherever they appear as a
// substring, plus any object key that is conventionally sensitive
// (case-insensitive: secret, token, authorization), regardless of value.
import { secretValues } from './config.js';

const SENSITIVE_KEY_PATTERN = /secret|token|authorization/i;

function redactString(str) {
  let out = str;
  for (const secret of secretValues()) {
    if (secret && out.includes(secret)) out = out.split(secret).join('[REDACTED]');
  }
  return out;
}

export function sanitize(value) {
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) {
    return { message: redactString(value.message), name: value.name };
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : sanitize(v);
    }
    return out;
  }
  return value;
}

export function logInfo(message, meta) {
  console.log(`[amazon-backend] ${redactString(message)}`, meta !== undefined ? sanitize(meta) : '');
}

export function logError(message, meta) {
  console.error(`[amazon-backend] ${redactString(message)}`, meta !== undefined ? sanitize(meta) : '');
}
