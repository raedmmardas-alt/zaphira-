// Client for the local, READ-ONLY Amazon Ads API backend (see /server).
// This frontend NEVER holds an Amazon Client Secret, refresh token, or
// access token -- it only ever talks to its own localhost backend over
// plain fetch, and that backend is the sole holder of secrets. If the
// backend isn't running, every call here resolves to a clear
// "not connected" status rather than throwing into the UI.
const BACKEND_URL = import.meta.env.VITE_AMAZON_BACKEND_URL || 'http://127.0.0.1:4001';

export type AmazonConnectionState = 'NOT_CONNECTED' | 'CONNECTED' | 'ERROR';

export interface TokenRefreshStatus {
  status: 'NOT_YET_REFRESHED' | 'OK' | 'FAILED';
  error?: string;
  expiresAt?: string;
}

export interface AmazonConnectionStatus {
  status: AmazonConnectionState;
  marketplace: string | null;
  profileIdMasked: string | null;
  lastSuccessfulSync: string | null;
  lastSyncError: string | null;
  tokenRefreshStatus: TokenRefreshStatus;
  configured: boolean;
  missingConfigKeys: string[];
  readOnly: true;
}

export interface TestConnectionResult extends AmazonConnectionStatus {
  success: boolean;
  error?: string;
}

const BACKEND_UNREACHABLE_STATUS: AmazonConnectionStatus = {
  status: 'NOT_CONNECTED',
  marketplace: null,
  profileIdMasked: null,
  lastSuccessfulSync: null,
  lastSyncError: 'Local Amazon Ads backend is not running. Start it with `npm start` inside the server/ folder.',
  tokenRefreshStatus: { status: 'NOT_YET_REFRESHED' },
  configured: false,
  missingConfigKeys: [],
  readOnly: true,
};

export async function fetchAmazonStatus(): Promise<AmazonConnectionStatus> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/amazon/status`);
    if (!res.ok) return BACKEND_UNREACHABLE_STATUS;
    return (await res.json()) as AmazonConnectionStatus;
  } catch {
    return BACKEND_UNREACHABLE_STATUS;
  }
}

export async function testAmazonConnection(): Promise<TestConnectionResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/amazon/test-connection`, { method: 'POST' });
    if (!res.ok) return { ...BACKEND_UNREACHABLE_STATUS, success: false };
    return (await res.json()) as TestConnectionResult;
  } catch {
    return { ...BACKEND_UNREACHABLE_STATUS, success: false };
  }
}

// --- Campaign sync (Phase 2A) --------------------------------------------

export interface ApiCampaignRow {
  campaign: string;
  campaignId?: string;
  status?: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  budget?: number;
  activityStart?: string;
  activityEnd?: string;
}

export interface CampaignSyncStatus {
  lastCampaignSync: string | null;
  lastRequestedPeriod: { start: string; end: string } | null;
  lastRowCount: number | null;
  lastSyncError: string | null;
  syncInProgress: boolean;
  // Live progress while a sync is running in the backend's background
  // poller -- Amazon's own report generation can take minutes to hours,
  // so POST /sync returns immediately and these fields are how the UI
  // shows real movement instead of a blocking spinner.
  reportId: string | null;
  pollAttempts: number;
  lastPolledStatus: string | null;
}

export interface CampaignSyncResult {
  success: boolean;
  error?: string;
  pending?: boolean;
  message?: string;
  requestedPeriod?: { start: string; end: string };
  rows?: ApiCampaignRow[];
  campaignCount?: number;
  performanceRowCount?: number;
  syncedAt?: string;
}

const BACKEND_UNREACHABLE_CAMPAIGN_SYNC_STATUS: CampaignSyncStatus = {
  lastCampaignSync: null,
  lastRequestedPeriod: null,
  lastRowCount: null,
  lastSyncError: 'Local Amazon Ads backend is not running. Start it with `npm start` inside the server/ folder.',
  syncInProgress: false,
  reportId: null,
  pollAttempts: 0,
  lastPolledStatus: null,
};

export async function fetchCampaignSyncStatus(): Promise<CampaignSyncStatus> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/amazon/campaigns/status`);
    if (!res.ok) return BACKEND_UNREACHABLE_CAMPAIGN_SYNC_STATUS;
    return (await res.json()) as CampaignSyncStatus;
  } catch {
    return BACKEND_UNREACHABLE_CAMPAIGN_SYNC_STATUS;
  }
}

// Kicks off a Sponsored Products campaign sync for [startDate, endDate]
// (YYYY-MM-DD) and returns almost immediately with an acknowledgement --
// it does NOT wait for Amazon's report to finish generating (that can
// take minutes to hours; see server/src/amazonReporting.js). Poll
// fetchCampaignSyncStatus() for live progress, then call
// fetchCampaignSyncResult() once syncInProgress is false. Read-only end
// to end -- see server/src/routes/campaignSync.js.
export async function syncCampaignData(startDate: string, endDate: string): Promise<CampaignSyncResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/amazon/campaigns/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate }),
    });
    if (!res.ok) return { success: false, error: BACKEND_UNREACHABLE_CAMPAIGN_SYNC_STATUS.lastSyncError! };
    return (await res.json()) as CampaignSyncResult;
  } catch {
    return { success: false, error: BACKEND_UNREACHABLE_CAMPAIGN_SYNC_STATUS.lastSyncError! };
  }
}

// Fetches the most recently completed background sync's normalized rows.
// Call this once fetchCampaignSyncStatus() reports syncInProgress:false
// with no lastSyncError.
export async function fetchCampaignSyncResult(): Promise<CampaignSyncResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/amazon/campaigns/result`);
    if (!res.ok) return { success: false, error: BACKEND_UNREACHABLE_CAMPAIGN_SYNC_STATUS.lastSyncError! };
    return (await res.json()) as CampaignSyncResult;
  } catch {
    return { success: false, error: BACKEND_UNREACHABLE_CAMPAIGN_SYNC_STATUS.lastSyncError! };
  }
}
