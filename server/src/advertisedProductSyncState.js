// In-memory advertised-product-sync status shown to the frontend via
// GET /api/amazon/advertisedproducts/status, and the last completed
// sync's rows via GET /api/amazon/advertisedproducts/result. Deliberately
// holds no secrets. Mirrors targetingSyncState.js/searchTermSyncState.js
// exactly, but as a completely separate module/state.
let state = {
  lastAdvertisedProductSync: null,
  lastRequestedPeriod: null,
  lastRowCount: null,
  lastSyncError: null,
  syncInProgress: false,
  reportId: null,
  pollAttempts: 0,
  lastPolledStatus: null,
};

let lastResult = null;

export function markAdvertisedProductSyncStarted() {
  state = {
    ...state,
    syncInProgress: true,
    lastSyncError: null,
    reportId: null,
    pollAttempts: 0,
    lastPolledStatus: null,
  };
  lastResult = null;
}

export function recordAdvertisedProductSyncPoll({ reportId, attempt, status }) {
  state = { ...state, reportId, pollAttempts: attempt, lastPolledStatus: status };
}

export function recordAdvertisedProductSyncSuccess({ requestedPeriod, rowCount }) {
  state = {
    ...state,
    lastAdvertisedProductSync: new Date().toISOString(),
    lastRequestedPeriod: requestedPeriod,
    lastRowCount: rowCount,
    lastSyncError: null,
    syncInProgress: false,
  };
}

export function recordAdvertisedProductSyncError(message) {
  state = { ...state, lastSyncError: message, syncInProgress: false };
}

export function getAdvertisedProductSyncStatus() {
  return { ...state };
}

export function isAdvertisedProductSyncInProgress() {
  return state.syncInProgress;
}

export function setAdvertisedProductSyncResult(result) {
  lastResult = result;
}

export function getAdvertisedProductSyncResult() {
  return lastResult;
}
