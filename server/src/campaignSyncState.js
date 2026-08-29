// In-memory campaign-sync status shown to the frontend via
// GET /api/amazon/campaigns/status, and the last completed sync's rows
// via GET /api/amazon/campaigns/result. Deliberately holds no secrets.
//
// The actual Amazon report generation runs in the BACKGROUND (see
// routes/campaignSync.js) because Amazon's own report generation can take
// anywhere from a few minutes to a few hours -- far too long to hold a
// single browser HTTP request open. `syncInProgress` plus the live
// reportId/pollAttempts/lastPolledStatus fields let the frontend show real
// progress instead of a blocking spinner, and guard against a second sync
// starting (a double-click, a second browser tab, a retried request)
// while Amazon is still generating a report for an earlier request -- see
// routes/campaignSync.js, which checks isCampaignSyncInProgress() before
// doing any work and never issues a second report request while one is
// already pending.
let state = {
  lastCampaignSync: null,
  lastRequestedPeriod: null,
  lastRowCount: null,
  lastSyncError: null,
  syncInProgress: false,
  reportId: null,
  pollAttempts: 0,
  lastPolledStatus: null,
};

let lastResult = null;

export function markCampaignSyncStarted() {
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
export function recordCampaignSyncPoll({ reportId, attempt, status }) {
  state = { ...state, reportId, pollAttempts: attempt, lastPolledStatus: status };
}

export function recordCampaignSyncSuccess({ requestedPeriod, rowCount }) {
  state = {
    ...state,
    lastCampaignSync: new Date().toISOString(),
    lastRequestedPeriod: requestedPeriod,
    lastRowCount: rowCount,
    lastSyncError: null,
    syncInProgress: false,
  };
}

export function recordCampaignSyncError(message) {
  state = { ...state, lastSyncError: message, syncInProgress: false };
}

export function getCampaignSyncStatus() {
  return { ...state };
}

export function isCampaignSyncInProgress() {
  return state.syncInProgress;
}

// Holds the normalized rows from the most recently COMPLETED sync so the
// frontend can pick them up once GET /status shows syncInProgress:false
// with no error. Transient/in-memory only, like the rest of this module --
// the frontend is responsible for persisting it (via setApiCampaignSync).
export function setCampaignSyncResult(result) {
  lastResult = result;
}

export function getCampaignSyncResult() {
  return lastResult;
}
