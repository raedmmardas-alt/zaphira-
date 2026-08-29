// In-memory campaign-sync status shown to the frontend via
// GET /api/amazon/campaigns/status. Deliberately holds no secrets.
let state = {
  lastCampaignSync: null,
  lastRequestedPeriod: null,
  lastRowCount: null,
  lastSyncError: null,
};

export function recordCampaignSyncSuccess({ requestedPeriod, rowCount }) {
  state = {
    lastCampaignSync: new Date().toISOString(),
    lastRequestedPeriod: requestedPeriod,
    lastRowCount: rowCount,
    lastSyncError: null,
  };
}

export function recordCampaignSyncError(message) {
  state = { ...state, lastSyncError: message };
}

export function getCampaignSyncStatus() {
  return { ...state };
}
