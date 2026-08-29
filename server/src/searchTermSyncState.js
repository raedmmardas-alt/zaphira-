// In-memory search-term-sync status shown to the frontend via
// GET /api/amazon/searchterms/status, and the last completed sync's rows
// via GET /api/amazon/searchterms/result. Deliberately holds no secrets.
// Mirrors targetingSyncState.js exactly, but as a completely separate
// module/state so no other sync's state is ever touched by this one.
let state = {
  lastSearchTermSync: null,
  lastRequestedPeriod: null,
  lastRowCount: null,
  lastSyncError: null,
  syncInProgress: false,
  reportId: null,
  pollAttempts: 0,
  lastPolledStatus: null,
};

let lastResult = null;

export function markSearchTermSyncStarted() {
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

export function recordSearchTermSyncPoll({ reportId, attempt, status }) {
  state = { ...state, reportId, pollAttempts: attempt, lastPolledStatus: status };
}

export function recordSearchTermSyncSuccess({ requestedPeriod, rowCount }) {
  state = {
    ...state,
    lastSearchTermSync: new Date().toISOString(),
    lastRequestedPeriod: requestedPeriod,
    lastRowCount: rowCount,
    lastSyncError: null,
    syncInProgress: false,
  };
}

export function recordSearchTermSyncError(message) {
  state = { ...state, lastSyncError: message, syncInProgress: false };
}

export function getSearchTermSyncStatus() {
  return { ...state };
}

export function isSearchTermSyncInProgress() {
  return state.syncInProgress;
}

export function setSearchTermSyncResult(result) {
  lastResult = result;
}

export function getSearchTermSyncResult() {
  return lastResult;
}
