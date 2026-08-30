// In-memory connection status shown to the frontend via GET /api/amazon/status.
// Deliberately holds no secrets -- only sanitized, display-safe fields.
import { config, isConfigured, maskLast4, missingConfigKeys } from './config.js';
import { getTokenRefreshStatus } from './amazonAuth.js';

let state = {
  status: 'NOT_CONNECTED', // 'NOT_CONNECTED' | 'CONNECTED' | 'ERROR'
  marketplace: null,
  profileIdMasked: null,
  lastSuccessfulSync: null,
  lastSyncError: null,
};

export function recordSuccess({ marketplace, profileId }) {
  state = {
    status: 'CONNECTED',
    marketplace,
    profileIdMasked: maskLast4(profileId),
    lastSuccessfulSync: new Date().toISOString(),
    lastSyncError: null,
  };
}

export function recordError(message) {
  state = {
    ...state,
    status: 'ERROR',
    lastSyncError: message,
  };
}

export function getStatus() {
  if (!isConfigured()) {
    return {
      status: 'NOT_CONNECTED',
      marketplace: null,
      profileIdMasked: null,
      lastSuccessfulSync: null,
      lastSyncError: null,
      tokenRefreshStatus: { status: 'NOT_YET_REFRESHED' },
      configured: false,
      missingConfigKeys: missingConfigKeys(),
      readOnly: true,
    };
  }
  return {
    ...state,
    profileIdMasked: state.profileIdMasked ?? maskLast4(config.profileId),
    tokenRefreshStatus: getTokenRefreshStatus(),
    configured: true,
    missingConfigKeys: [],
    readOnly: true,
  };
}
