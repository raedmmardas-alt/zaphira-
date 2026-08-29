// In-memory targeting-sync status shown to the frontend via
// GET /api/amazon/targeting/status, and the last completed sync's rows
// via GET /api/amazon/targeting/result. Deliberately holds no secrets.
// Mirrors campaignSyncState.js exactly, but as a completely separate
// module/state so campaign sync's own state is never touched by a
// targeting sync (and vice versa).
//
// The actual Amazon report generation runs in the BACKGROUND (see
// routes/targetingSync.js) because Amazon's own report generation can
// take anywhere from a few minutes to a few hours -- far too long to hold
// a single browser HTTP request open. `syncInProgress` plus the live
// reportId/pollAttempts/lastPolledStatus fields let the frontend show real
// progress instead of a blocking spinner, and guard against a second sync
// starting (a double-click, a second browser tab, a retried request)
// while Amazon is still generating a report for an earlier request.
let state = {
  lastTargetingSync: null,
  lastRequestedPeriod: null,
  lastRowCount: null,
  lastSyncError: null,
  syncInProgress: false,
  reportId: null,
  pollAttempts: 0,
  lastPolledStatus: null,
};

let lastResult = null;

export function markTargetingSyncStarted() {
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

// Mirrors live polling progress from amazonReporting.js's waitForReportUrl
// -- never touches syncInProgress/lastSyncError, purely for visibility.
export function recordTargetingSyncPoll({ reportId, attempt, status }) {
  state = { ...state, reportId, pollAttempts: attempt, lastPolledStatus: status };
}

export function recordTargetingSyncSuccess({ requestedPeriod, rowCount }) {
  state = {
    ...state,
    lastTargetingSync: new Date().toISOString(),
    lastRequestedPeriod: requestedPeriod,
    lastRowCount: rowCount,
    lastSyncError: null,
    syncInProgress: false,
  };
}

export function recordTargetingSyncError(message) {
  state = { ...state, lastSyncError: message, syncInProgress: false };
}

export function getTargetingSyncStatus() {
  return { ...state };
}

export function isTargetingSyncInProgress() {
  return state.syncInProgress;
}

// Holds the normalized rows from the most recently COMPLETED sync so the
// frontend can pick them up once GET /status shows syncInProgress:false
// with no error. Transient/in-memory only -- the frontend is responsible
// for persisting it (via setApiTargetingSync).
export function setTargetingSyncResult(result) {
  lastResult = result;
}

export function getTargetingSyncResult() {
  return lastResult;
}
