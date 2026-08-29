// In-memory campaign-sync status shown to the frontend via
// GET /api/amazon/campaigns/status. Deliberately holds no secrets.
//
// `syncInProgress` guards against a second sync starting (a double-click,
// a second browser tab, a retried request) while Amazon is still
// generating a report for an earlier request -- see routes/campaignSync.js,
// which checks isSyncInProgress() before doing any work and never issues a
// second report request while one is already pending.
let state = {
  lastCampaignSync: null,
  lastRequestedPeriod: null,
  lastRowCount: null,
  lastSyncError: null,
  syncInProgress: false,
};

export function markCampaignSyncStarted() {
  state = { ...state, syncInProgress: true };
}

export function recordCampaignSyncSuccess({ requestedPeriod, rowCount }) {
  state = {
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
