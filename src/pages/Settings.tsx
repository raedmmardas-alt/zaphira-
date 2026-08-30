import { useEffect, useState } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import { NumberField } from '../components/ui/NumberField';
import { useAppStore } from '../state/store';
import { useWorkspace } from '../state/useWorkspace';
import { formatCurrency, formatNumber } from '../lib/engine/metrics';
import {
  fetchAmazonStatus, testAmazonConnection, fetchCampaignSyncStatus, syncCampaignData, fetchCampaignSyncResult,
  fetchTargetingSyncStatus, syncTargetingData, fetchTargetingSyncResult,
  fetchSearchTermSyncStatus, syncSearchTermData, fetchSearchTermSyncResult,
  fetchAdvertisedProductSyncStatus, syncAdvertisedProductData, fetchAdvertisedProductSyncResult,
  type AmazonConnectionStatus, type CampaignSyncStatus, type TargetingSyncStatus, type SearchTermSyncStatus, type AdvertisedProductSyncStatus,
} from '../lib/amazonBackend';
import { reconcileCampaignSources, reconcileTargetingSources, runReconciliation, worstStatus } from '../lib/aggregate/reconciliation';
import { runSyncAll, type SyncAllStepKey, type SyncAllStepState, type SyncAllStepStatus } from '../lib/amazonSyncAll';
import type {
  AdvertisedProductRow, CampaignRow, Product, ReconciliationStatus, ReportImportMeta, SearchTermRow, StrategyPosture, TargetingRow,
} from '../types';

const CONNECTION_TONE: Record<AmazonConnectionStatus['status'], BadgeTone> = {
  CONNECTED: 'positive',
  NOT_CONNECTED: 'wait',
  ERROR: 'negative',
};
const CONNECTION_LABEL: Record<AmazonConnectionStatus['status'], string> = {
  CONNECTED: 'Connected',
  NOT_CONNECTED: 'Not Connected',
  ERROR: 'Error',
};

function AmazonAdsApiCard() {
  const [amazonStatus, setAmazonStatus] = useState<AmazonConnectionStatus | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void fetchAmazonStatus().then(setAmazonStatus);
  }, []);

  async function handleTestConnection() {
    setTesting(true);
    try {
      const result = await testAmazonConnection();
      setAmazonStatus(result);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card title="Amazon Ads API" subtitle="Optional local integration — retrieves advertising data automatically instead of manual CSV downloads. Manual uploads always remain available.">
      <div className="mb-3 rounded-lg border border-brand-600/20 bg-brand-50 px-3 py-2 text-xs text-brand-800">
        <span className="font-semibold">READ-ONLY AMAZON CONNECTION</span> — Zaphira PPC Control cannot modify Amazon campaigns. This connection can only read advertising data; it can never create, pause, or edit a campaign, bid, budget, or keyword.
      </div>
      {amazonStatus ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Status</span>
            <Badge tone={CONNECTION_TONE[amazonStatus.status]}>{CONNECTION_LABEL[amazonStatus.status]}</Badge>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Marketplace</span>
            <span className="font-medium text-navy-900">{amazonStatus.marketplace ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Profile ID</span>
            <span className="font-mono text-xs text-navy-900">{amazonStatus.profileIdMasked ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Token Refresh</span>
            <span className="font-medium text-navy-900">{amazonStatus.tokenRefreshStatus.status}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Last Successful Sync</span>
            <span className="font-medium text-navy-900">{amazonStatus.lastSuccessfulSync ?? 'Never'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Last Sync Error</span>
            <span className="max-w-[220px] truncate text-xs text-negative-600" title={amazonStatus.lastSyncError ?? undefined}>{amazonStatus.lastSyncError ?? 'None'}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-navy-500">Checking connection…</p>
      )}
      {amazonStatus && !amazonStatus.configured && (
        <p className="mt-3 text-xs text-navy-500">
          Not set up yet. Run <code className="rounded bg-navy-900/5 px-1 py-0.5 font-mono">npm run setup</code> inside the <code className="rounded bg-navy-900/5 px-1 py-0.5 font-mono">server/</code> folder on your local machine, then <code className="rounded bg-navy-900/5 px-1 py-0.5 font-mono">npm start</code> to run the local backend.
        </p>
      )}
      <button
        onClick={handleTestConnection}
        disabled={testing}
        className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {testing ? 'Testing…' : 'Test Connection'}
      </button>
    </Card>
  );
}

const RECONCILIATION_STATUS_LABEL: Record<ReconciliationStatus, string> = {
  DATA_RECONCILED: 'Data Reconciled',
  SMALL_ATTRIBUTION_DIFFERENCE: 'Small Attribution Difference',
  DATA_MISMATCH_REVIEW_REQUIRED: 'Data Mismatch — Review Required',
};
const RECONCILIATION_STATUS_TONE: Record<ReconciliationStatus, BadgeTone> = {
  DATA_RECONCILED: 'positive',
  SMALL_ATTRIBUTION_DIFFERENCE: 'watch',
  DATA_MISMATCH_REVIEW_REQUIRED: 'negative',
};

interface CampaignTotals { spend: number; sales: number; orders: number; clicks: number }

function sumCampaignRows(rows: CampaignRow[]): CampaignTotals {
  return rows.reduce(
    (a, r) => ({ spend: a.spend + r.spend, sales: a.sales + r.sales, orders: a.orders + r.orders, clicks: a.clicks + r.clicks }),
    { spend: 0, sales: 0, orders: 0, clicks: 0 },
  );
}

// Phase 2A: Sponsored Products campaign-level sync ONLY. Targeting, Search
// Terms, and Advertised Products are not synced yet -- upload those
// manually as usual. Never touches reportMeta.campaign/reportRows.campaign
// (the manual CSV slot); stores results in the separate apiCampaignSync
// slot instead (see state/store.ts).
function CampaignSyncCard() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const apiCampaignSync = useAppStore((s) => s.apiCampaignSync);
  const setApiCampaignSync = useAppStore((s) => s.setApiCampaignSync);
  const reportMeta = useAppStore((s) => s.reportMeta);
  const reportRows = useAppStore((s) => s.reportRows);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<CampaignSyncStatus | null>(null);

  // Watches an already-kicked-off background sync to completion and
  // applies its result. Amazon's own report generation can legitimately
  // take minutes up to a few hours (see server/src/amazonReporting.js),
  // so this is reused both right after starting a sync and on mount --
  // reopening this page mid-sync (or after it finished while the tab was
  // closed) resumes tracking it rather than leaving the UI stuck showing
  // nothing happened.
  async function watchUntilDone(fallbackPeriod: { start: string; end: string }) {
    let status = await fetchCampaignSyncStatus();
    setSyncStatus(status);
    // Bounded purely as defensive coding -- the backend's own safety
    // ceiling (see amazonReporting.js) will flip syncInProgress to false
    // with a clear error well before this could ever run out.
    let safety = 0;
    while (status.syncInProgress && safety < 4000) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      status = await fetchCampaignSyncStatus();
      setSyncStatus(status);
      safety += 1;
    }

    if (status.lastSyncError) {
      setSyncError(status.lastSyncError);
      return;
    }

    const result = await fetchCampaignSyncResult();
    if (!result.success || !result.rows) return; // nothing new to apply

    const requestedPeriod = result.requestedPeriod ?? fallbackPeriod;
    const meta: ReportImportMeta = {
      id: crypto.randomUUID(),
      type: 'campaign',
      filename: 'Amazon Ads API sync',
      fileSizeBytes: 0,
      rowCount: result.rows.length,
      importedAt: new Date().toISOString(),
      requestedPeriod,
      observedPeriod: requestedPeriod,
      periodConfirmedManually: true,
      status: 'OK',
      detectedColumns: ['campaignId', 'campaignName', 'state', 'budget', 'impressions', 'clicks', 'cost', 'purchases1d', 'sales1d'],
      missingRequiredFields: [],
      missingOptionalFields: [],
    };
    setApiCampaignSync(meta, result.rows as CampaignRow[]);
  }

  useEffect(() => {
    void fetchCampaignSyncStatus().then((status) => {
      setSyncStatus(status);
      // Resume watching a sync that was already running when this page
      // loaded (e.g. the user navigated away and came back).
      if (status.syncInProgress && status.lastRequestedPeriod) {
        setSyncing(true);
        void watchUntilDone(status.lastRequestedPeriod).finally(() => setSyncing(false));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSync() {
    if (!startDate || !endDate || syncing || syncStatus?.syncInProgress) return;
    setSyncing(true);
    setSyncError(null);
    try {
      // The backend kicks off the Amazon report and returns almost
      // immediately -- it does NOT wait for Amazon to finish generating
      // it. This call only ever fails fast for validation errors, an
      // already-in-progress sync, missing credentials, or an unreachable
      // backend; a real sync attempt returns pending:true here and then
      // runs in the background, tracked by watchUntilDone below.
      const kickoff = await syncCampaignData(startDate, endDate);
      if (!kickoff.success) {
        setSyncError(kickoff.error ?? 'Campaign sync failed.');
        return;
      }
      await watchUntilDone({ start: startDate, end: endDate });
    } finally {
      setSyncing(false);
    }
  }

  const apiTotals = apiCampaignSync ? sumCampaignRows(apiCampaignSync.rows) : null;

  // Reconciliation only runs when a manual Campaign CSV AND an API sync
  // both cover the exact same confirmed period -- never a "close enough"
  // guess, and never silently overwrites either source.
  const manualPeriod = reportMeta.campaign?.requestedPeriod ?? reportMeta.campaign?.observedPeriod ?? null;
  const apiPeriod = apiCampaignSync?.meta.requestedPeriod ?? null;
  const periodsMatch = !!(manualPeriod && apiPeriod && manualPeriod.start === apiPeriod.start && manualPeriod.end === apiPeriod.end);
  const manualTotals = periodsMatch ? sumCampaignRows(reportRows.campaign) : null;
  const campaignReconciliation = periodsMatch && manualTotals && apiTotals
    ? worstStatus(reconcileCampaignSources(manualTotals, apiTotals))
    : null;

  return (
    <Card
      title="Amazon Campaign Data Sync"
      subtitle="Sponsored Products campaign-level data only (Phase 2A). Targeting, Search Terms, and Advertised Products are not synced yet — upload those manually as usual."
    >
      <div className="mb-4 flex items-center gap-3 text-sm">
        <span className="font-medium text-navy-600">Campaign Data Source</span>
        <select
          value={settings.campaignDataSource}
          onChange={(e) => updateSettings({ campaignDataSource: e.target.value as 'API' | 'MANUAL' })}
          className="rounded-lg border border-border-subtle px-2 py-1 text-sm"
        >
          <option value="MANUAL">Manual Report</option>
          <option value="API">Amazon API</option>
        </select>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy-600">Start Date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy-600">End Date</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1.5 text-sm" />
        </label>
        <button
          onClick={handleSync}
          disabled={syncing || !!syncStatus?.syncInProgress || !startDate || !endDate}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing || syncStatus?.syncInProgress ? 'Syncing…' : 'Sync Campaign Data'}
        </button>
      </div>
      {(syncing || syncStatus?.syncInProgress) && (
        <p className="mb-3 text-xs text-navy-500">
          Amazon is generating the report… this can take a few minutes up to a few hours.
          {syncStatus?.lastPolledStatus && ` Amazon status: ${syncStatus.lastPolledStatus} (check ${syncStatus.pollAttempts}).`}
          {' '}You can leave this page — sync continues in the background.
        </p>
      )}
      {syncError && <p className="mb-3 text-xs text-negative-600">{syncError}</p>}

      {apiCampaignSync && apiTotals && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">API Requested Period</span>
            <span className="font-medium text-navy-900">{apiCampaignSync.meta.requestedPeriod?.start} → {apiCampaignSync.meta.requestedPeriod?.end}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Campaign rows retrieved</span>
            <span className="font-medium text-navy-900">{apiCampaignSync.rows.length}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">PPC Spend</span>
            <span className="font-medium text-navy-900">{formatCurrency(apiTotals.spend)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Attributed Sales</span>
            <span className="font-medium text-navy-900">{formatCurrency(apiTotals.sales)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Orders</span>
            <span className="font-medium text-navy-900">{formatNumber(apiTotals.orders)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Last Campaign Sync</span>
            <span className="font-medium text-navy-900">{syncStatus?.lastCampaignSync ?? '—'}</span>
          </div>
        </div>
      )}

      {campaignReconciliation && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-navy-500">Reconciliation (Amazon API vs Manual Campaign CSV, same period)</span>
          <Badge tone={RECONCILIATION_STATUS_TONE[campaignReconciliation]}>{RECONCILIATION_STATUS_LABEL[campaignReconciliation]}</Badge>
        </div>
      )}
      {apiCampaignSync && reportMeta.campaign && !periodsMatch && (
        <p className="mt-3 text-xs text-navy-500">Manual Campaign CSV and Amazon API data cover different periods — reconciliation only runs when both cover the exact same confirmed period.</p>
      )}
    </Card>
  );
}

interface TargetingTotals { spend: number; sales: number; orders: number; clicks: number }

function sumTargetingRows(rows: TargetingRow[]): TargetingTotals {
  return rows.reduce(
    (a, r) => ({ spend: a.spend + r.spend, sales: a.sales + r.sales, orders: a.orders + r.orders, clicks: a.clicks + r.clicks }),
    { spend: 0, sales: 0, orders: 0, clicks: 0 },
  );
}

interface SearchTermTotals { spend: number; sales: number; orders: number; clicks: number }

function sumSearchTermRows(rows: SearchTermRow[]): SearchTermTotals {
  return rows.reduce(
    (a, r) => ({ spend: a.spend + r.spend, sales: a.sales + r.sales, orders: a.orders + r.orders, clicks: a.clicks + r.clicks }),
    { spend: 0, sales: 0, orders: 0, clicks: 0 },
  );
}

interface AdvertisedProductTotals { spend: number; sales: number; orders: number; clicks: number }

function sumAdvertisedProductRows(rows: AdvertisedProductRow[]): AdvertisedProductTotals {
  return rows.reduce(
    (a, r) => ({ spend: a.spend + r.spend, sales: a.sales + r.sales, orders: a.orders + r.orders, clicks: a.clicks + r.clicks }),
    { spend: 0, sales: 0, orders: 0, clicks: 0 },
  );
}

// Phase 2B: Sponsored Products keyword + product/category targeting sync
// ONLY. Search Terms and Advertised Products are not synced yet -- upload
// those manually as usual. Never touches
// reportMeta.targeting/reportRows.targeting (the manual CSV slot); stores
// results in the separate apiTargetingSync slot instead (see
// state/store.ts). Mirrors CampaignSyncCard's structure exactly.
function TargetingSyncCard() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const apiTargetingSync = useAppStore((s) => s.apiTargetingSync);
  const setApiTargetingSync = useAppStore((s) => s.setApiTargetingSync);
  const reportMeta = useAppStore((s) => s.reportMeta);
  const reportRows = useAppStore((s) => s.reportRows);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<TargetingSyncStatus | null>(null);

  // See CampaignSyncCard's watchUntilDone for the full rationale -- same
  // background-sync-with-live-progress pattern, applied to targeting.
  async function watchUntilDone(fallbackPeriod: { start: string; end: string }) {
    let status = await fetchTargetingSyncStatus();
    setSyncStatus(status);
    let safety = 0;
    while (status.syncInProgress && safety < 4000) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      status = await fetchTargetingSyncStatus();
      setSyncStatus(status);
      safety += 1;
    }

    if (status.lastSyncError) {
      setSyncError(status.lastSyncError);
      return;
    }

    const result = await fetchTargetingSyncResult();
    if (!result.success || !result.rows) return; // nothing new to apply

    const requestedPeriod = result.requestedPeriod ?? fallbackPeriod;
    const meta: ReportImportMeta = {
      id: crypto.randomUUID(),
      type: 'targeting',
      filename: 'Amazon Ads API sync',
      fileSizeBytes: 0,
      rowCount: result.rows.length,
      importedAt: new Date().toISOString(),
      requestedPeriod,
      observedPeriod: requestedPeriod,
      periodConfirmedManually: true,
      status: 'OK',
      detectedColumns: ['campaignId', 'adGroupId', 'keywordId', 'matchType', 'keyword', 'impressions', 'clicks', 'cost', 'purchases1d', 'sales1d'],
      missingRequiredFields: [],
      missingOptionalFields: [],
    };
    setApiTargetingSync(meta, result.rows as TargetingRow[]);
  }

  useEffect(() => {
    void fetchTargetingSyncStatus().then((status) => {
      setSyncStatus(status);
      if (status.syncInProgress && status.lastRequestedPeriod) {
        setSyncing(true);
        void watchUntilDone(status.lastRequestedPeriod).finally(() => setSyncing(false));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSync() {
    if (!startDate || !endDate || syncing || syncStatus?.syncInProgress) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const kickoff = await syncTargetingData(startDate, endDate);
      if (!kickoff.success) {
        setSyncError(kickoff.error ?? 'Targeting sync failed.');
        return;
      }
      await watchUntilDone({ start: startDate, end: endDate });
    } finally {
      setSyncing(false);
    }
  }

  const apiTotals = apiTargetingSync ? sumTargetingRows(apiTargetingSync.rows) : null;

  // Reconciliation only runs when a manual Targeting CSV AND an API sync
  // both cover the exact same confirmed period -- never a "close enough"
  // guess, and never silently overwrites either source.
  const manualPeriod = reportMeta.targeting?.requestedPeriod ?? reportMeta.targeting?.observedPeriod ?? null;
  const apiPeriod = apiTargetingSync?.meta.requestedPeriod ?? null;
  const periodsMatch = !!(manualPeriod && apiPeriod && manualPeriod.start === apiPeriod.start && manualPeriod.end === apiPeriod.end);
  const manualTotals = periodsMatch ? sumTargetingRows(reportRows.targeting) : null;
  const targetingReconciliation = periodsMatch && manualTotals && apiTotals
    ? worstStatus(reconcileTargetingSources(manualTotals, apiTotals))
    : null;

  return (
    <Card
      title="Amazon Targeting Data Sync"
      subtitle="Sponsored Products keyword + product/category targeting only (Phase 2B). Search Terms and Advertised Products are not synced yet — upload those manually as usual."
    >
      <div className="mb-4 flex items-center gap-3 text-sm">
        <span className="font-medium text-navy-600">Targeting Data Source</span>
        <select
          value={settings.targetingDataSource}
          onChange={(e) => updateSettings({ targetingDataSource: e.target.value as 'API' | 'MANUAL' })}
          className="rounded-lg border border-border-subtle px-2 py-1 text-sm"
        >
          <option value="MANUAL">Manual Report</option>
          <option value="API">Amazon API</option>
        </select>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy-600">Start Date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy-600">End Date</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1.5 text-sm" />
        </label>
        <button
          onClick={handleSync}
          disabled={syncing || !!syncStatus?.syncInProgress || !startDate || !endDate}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing || syncStatus?.syncInProgress ? 'Syncing…' : 'Sync Targeting Data'}
        </button>
      </div>
      {(syncing || syncStatus?.syncInProgress) && (
        <p className="mb-3 text-xs text-navy-500">
          Amazon is generating the report… this can take a few minutes up to a few hours.
          {syncStatus?.lastPolledStatus && ` Amazon status: ${syncStatus.lastPolledStatus} (check ${syncStatus.pollAttempts}).`}
          {' '}You can leave this page — sync continues in the background.
        </p>
      )}
      {syncError && <p className="mb-3 text-xs text-negative-600">{syncError}</p>}

      {apiTargetingSync && apiTotals && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">API Requested Period</span>
            <span className="font-medium text-navy-900">{apiTargetingSync.meta.requestedPeriod?.start} → {apiTargetingSync.meta.requestedPeriod?.end}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Targeting rows retrieved</span>
            <span className="font-medium text-navy-900">{apiTargetingSync.rows.length}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">PPC Spend</span>
            <span className="font-medium text-navy-900">{formatCurrency(apiTotals.spend)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Attributed Sales</span>
            <span className="font-medium text-navy-900">{formatCurrency(apiTotals.sales)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Orders</span>
            <span className="font-medium text-navy-900">{formatNumber(apiTotals.orders)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Last Targeting Sync</span>
            <span className="font-medium text-navy-900">{syncStatus?.lastTargetingSync ?? '—'}</span>
          </div>
        </div>
      )}

      {targetingReconciliation && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-navy-500">Reconciliation (Amazon API vs Manual Targeting CSV, same period)</span>
          <Badge tone={RECONCILIATION_STATUS_TONE[targetingReconciliation]}>{RECONCILIATION_STATUS_LABEL[targetingReconciliation]}</Badge>
        </div>
      )}
      {apiTargetingSync && reportMeta.targeting && !periodsMatch && (
        <p className="mt-3 text-xs text-navy-500">Manual Targeting CSV and Amazon API data cover different periods — reconciliation only runs when both cover the exact same confirmed period.</p>
      )}
    </Card>
  );
}

// Phase 2C: Sponsored Products search term sync ONLY. Search terms are
// period-performance data only -- no live/current status is invented for
// a customer search query, matching SearchTermRow's own shape. Never
// touches reportMeta.searchTerm/reportRows.searchTerm (the manual CSV
// slot); stores results in the separate apiSearchTermSync slot instead.
// Mirrors CampaignSyncCard/TargetingSyncCard's structure exactly.
function SearchTermSyncCard() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const apiSearchTermSync = useAppStore((s) => s.apiSearchTermSync);
  const setApiSearchTermSync = useAppStore((s) => s.setApiSearchTermSync);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SearchTermSyncStatus | null>(null);

  async function watchUntilDone(fallbackPeriod: { start: string; end: string }) {
    let status = await fetchSearchTermSyncStatus();
    setSyncStatus(status);
    let safety = 0;
    while (status.syncInProgress && safety < 4000) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      status = await fetchSearchTermSyncStatus();
      setSyncStatus(status);
      safety += 1;
    }

    if (status.lastSyncError) {
      setSyncError(status.lastSyncError);
      return;
    }

    const result = await fetchSearchTermSyncResult();
    if (!result.success || !result.rows) return;

    const requestedPeriod = result.requestedPeriod ?? fallbackPeriod;
    const meta: ReportImportMeta = {
      id: crypto.randomUUID(),
      type: 'searchTerm',
      filename: 'Amazon Ads API sync',
      fileSizeBytes: 0,
      rowCount: result.rows.length,
      importedAt: new Date().toISOString(),
      requestedPeriod,
      observedPeriod: requestedPeriod,
      periodConfirmedManually: true,
      status: 'OK',
      detectedColumns: ['campaignId', 'adGroupId', 'keywordId', 'matchType', 'keyword', 'searchTerm', 'impressions', 'clicks', 'cost', 'purchases1d', 'sales1d'],
      missingRequiredFields: [],
      missingOptionalFields: [],
    };
    setApiSearchTermSync(meta, result.rows as SearchTermRow[]);
  }

  useEffect(() => {
    void fetchSearchTermSyncStatus().then((status) => {
      setSyncStatus(status);
      if (status.syncInProgress && status.lastRequestedPeriod) {
        setSyncing(true);
        void watchUntilDone(status.lastRequestedPeriod).finally(() => setSyncing(false));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSync() {
    if (!startDate || !endDate || syncing || syncStatus?.syncInProgress) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const kickoff = await syncSearchTermData(startDate, endDate);
      if (!kickoff.success) {
        setSyncError(kickoff.error ?? 'Search term sync failed.');
        return;
      }
      await watchUntilDone({ start: startDate, end: endDate });
    } finally {
      setSyncing(false);
    }
  }

  const apiTotals = apiSearchTermSync ? sumSearchTermRows(apiSearchTermSync.rows) : null;

  return (
    <Card
      title="Amazon Search Term Data Sync"
      subtitle="Sponsored Products search term performance only (Phase 2C). Period-performance data only — no live status is invented for a customer search query."
    >
      <div className="mb-4 flex items-center gap-3 text-sm">
        <span className="font-medium text-navy-600">Search Term Data Source</span>
        <select
          value={settings.searchTermDataSource}
          onChange={(e) => updateSettings({ searchTermDataSource: e.target.value as 'API' | 'MANUAL' })}
          className="rounded-lg border border-border-subtle px-2 py-1 text-sm"
        >
          <option value="MANUAL">Manual Report</option>
          <option value="API">Amazon API</option>
        </select>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy-600">Start Date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy-600">End Date</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1.5 text-sm" />
        </label>
        <button
          onClick={handleSync}
          disabled={syncing || !!syncStatus?.syncInProgress || !startDate || !endDate}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing || syncStatus?.syncInProgress ? 'Syncing…' : 'Sync Search Term Data'}
        </button>
      </div>
      {(syncing || syncStatus?.syncInProgress) && (
        <p className="mb-3 text-xs text-navy-500">
          Amazon is generating the report… this can take a few minutes up to a few hours.
          {syncStatus?.lastPolledStatus && ` Amazon status: ${syncStatus.lastPolledStatus} (check ${syncStatus.pollAttempts}).`}
          {' '}You can leave this page — sync continues in the background.
        </p>
      )}
      {syncError && <p className="mb-3 text-xs text-negative-600">{syncError}</p>}

      {apiSearchTermSync && apiTotals && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">API Requested Period</span>
            <span className="font-medium text-navy-900">{apiSearchTermSync.meta.requestedPeriod?.start} → {apiSearchTermSync.meta.requestedPeriod?.end}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Search term rows retrieved</span>
            <span className="font-medium text-navy-900">{apiSearchTermSync.rows.length}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">PPC Spend</span>
            <span className="font-medium text-navy-900">{formatCurrency(apiTotals.spend)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Attributed Sales</span>
            <span className="font-medium text-navy-900">{formatCurrency(apiTotals.sales)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Orders</span>
            <span className="font-medium text-navy-900">{formatNumber(apiTotals.orders)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Last Search Term Sync</span>
            <span className="font-medium text-navy-900">{syncStatus?.lastSearchTermSync ?? '—'}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

// Phase 2D: Sponsored Products advertised product sync ONLY. Feeds the
// SAME AdvertisedProductRow model the manual report already uses, which
// strengthens product mapping (buildAdvertisedProductIndex) exactly as
// today -- no separate mapping logic. Never touches
// reportMeta.advertisedProduct/reportRows.advertisedProduct (the manual
// CSV slot); stores results in the separate apiAdvertisedProductSync slot.
function AdvertisedProductSyncCard() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const apiAdvertisedProductSync = useAppStore((s) => s.apiAdvertisedProductSync);
  const setApiAdvertisedProductSync = useAppStore((s) => s.setApiAdvertisedProductSync);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<AdvertisedProductSyncStatus | null>(null);

  async function watchUntilDone(fallbackPeriod: { start: string; end: string }) {
    let status = await fetchAdvertisedProductSyncStatus();
    setSyncStatus(status);
    let safety = 0;
    while (status.syncInProgress && safety < 4000) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      status = await fetchAdvertisedProductSyncStatus();
      setSyncStatus(status);
      safety += 1;
    }

    if (status.lastSyncError) {
      setSyncError(status.lastSyncError);
      return;
    }

    const result = await fetchAdvertisedProductSyncResult();
    if (!result.success || !result.rows) return;

    const requestedPeriod = result.requestedPeriod ?? fallbackPeriod;
    const meta: ReportImportMeta = {
      id: crypto.randomUUID(),
      type: 'advertisedProduct',
      filename: 'Amazon Ads API sync',
      fileSizeBytes: 0,
      rowCount: result.rows.length,
      importedAt: new Date().toISOString(),
      requestedPeriod,
      observedPeriod: requestedPeriod,
      periodConfirmedManually: true,
      status: 'OK',
      detectedColumns: ['campaignId', 'adGroupId', 'advertisedAsin', 'advertisedSku', 'impressions', 'clicks', 'cost', 'purchases1d', 'sales1d'],
      missingRequiredFields: [],
      missingOptionalFields: [],
    };
    setApiAdvertisedProductSync(meta, result.rows as AdvertisedProductRow[]);
  }

  useEffect(() => {
    void fetchAdvertisedProductSyncStatus().then((status) => {
      setSyncStatus(status);
      if (status.syncInProgress && status.lastRequestedPeriod) {
        setSyncing(true);
        void watchUntilDone(status.lastRequestedPeriod).finally(() => setSyncing(false));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSync() {
    if (!startDate || !endDate || syncing || syncStatus?.syncInProgress) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const kickoff = await syncAdvertisedProductData(startDate, endDate);
      if (!kickoff.success) {
        setSyncError(kickoff.error ?? 'Advertised product sync failed.');
        return;
      }
      await watchUntilDone({ start: startDate, end: endDate });
    } finally {
      setSyncing(false);
    }
  }

  const apiTotals = apiAdvertisedProductSync ? sumAdvertisedProductRows(apiAdvertisedProductSync.rows) : null;

  return (
    <Card
      title="Amazon Advertised Product Data Sync"
      subtitle="Sponsored Products advertised product performance only (Phase 2D). Strengthens product mapping the same way the manual report already does."
    >
      <div className="mb-4 flex items-center gap-3 text-sm">
        <span className="font-medium text-navy-600">Advertised Product Data Source</span>
        <select
          value={settings.advertisedProductDataSource}
          onChange={(e) => updateSettings({ advertisedProductDataSource: e.target.value as 'API' | 'MANUAL' })}
          className="rounded-lg border border-border-subtle px-2 py-1 text-sm"
        >
          <option value="MANUAL">Manual Report</option>
          <option value="API">Amazon API</option>
        </select>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy-600">Start Date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy-600">End Date</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1.5 text-sm" />
        </label>
        <button
          onClick={handleSync}
          disabled={syncing || !!syncStatus?.syncInProgress || !startDate || !endDate}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing || syncStatus?.syncInProgress ? 'Syncing…' : 'Sync Advertised Product Data'}
        </button>
      </div>
      {(syncing || syncStatus?.syncInProgress) && (
        <p className="mb-3 text-xs text-navy-500">
          Amazon is generating the report… this can take a few minutes up to a few hours.
          {syncStatus?.lastPolledStatus && ` Amazon status: ${syncStatus.lastPolledStatus} (check ${syncStatus.pollAttempts}).`}
          {' '}You can leave this page — sync continues in the background.
        </p>
      )}
      {syncError && <p className="mb-3 text-xs text-negative-600">{syncError}</p>}

      {apiAdvertisedProductSync && apiTotals && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">API Requested Period</span>
            <span className="font-medium text-navy-900">{apiAdvertisedProductSync.meta.requestedPeriod?.start} → {apiAdvertisedProductSync.meta.requestedPeriod?.end}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Advertised product rows retrieved</span>
            <span className="font-medium text-navy-900">{apiAdvertisedProductSync.rows.length}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">PPC Spend</span>
            <span className="font-medium text-navy-900">{formatCurrency(apiTotals.spend)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Attributed Sales</span>
            <span className="font-medium text-navy-900">{formatCurrency(apiTotals.sales)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Orders</span>
            <span className="font-medium text-navy-900">{formatNumber(apiTotals.orders)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
            <span className="text-navy-500">Last Advertised Product Sync</span>
            <span className="font-medium text-navy-900">{syncStatus?.lastAdvertisedProductSync ?? '—'}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

const SYNC_ALL_STEP_LABEL: Record<SyncAllStepKey, string> = {
  campaign: 'Campaign',
  targeting: 'Targeting',
  searchTerm: 'Search Terms',
  advertisedProduct: 'Advertised Products',
};
const SYNC_ALL_ORDER: SyncAllStepKey[] = ['campaign', 'targeting', 'searchTerm', 'advertisedProduct'];
const SYNC_ALL_STEP_TONE: Record<SyncAllStepStatus, BadgeTone> = {
  PENDING: 'wait',
  SYNCING: 'watch',
  DONE: 'positive',
  ERROR: 'negative',
};

function buildApiSyncMeta(type: ReportImportMeta['type'], requestedPeriod: { start: string; end: string }, rowCount: number, detectedColumns: string[]): ReportImportMeta {
  return {
    id: crypto.randomUUID(),
    type,
    filename: 'Amazon Ads API sync',
    fileSizeBytes: 0,
    rowCount,
    importedAt: new Date().toISOString(),
    requestedPeriod,
    observedPeriod: requestedPeriod,
    periodConfirmedManually: true,
    status: 'OK',
    detectedColumns,
    missingRequiredFields: [],
    missingOptionalFields: [],
  };
}

// One convenience button that runs all four read-only syncs, in order, for
// the same date range -- reusing the exact same per-type backend
// endpoints and background-polling architecture as the four cards above
// (see lib/amazonSyncAll.ts for the sequencing/partial-failure logic,
// which is unit-tested independently of this component). Never touches
// any of the individual cards' own state or logic.
function SyncAllCard() {
  const setApiCampaignSync = useAppStore((s) => s.setApiCampaignSync);
  const setApiTargetingSync = useAppStore((s) => s.setApiTargetingSync);
  const setApiSearchTermSync = useAppStore((s) => s.setApiSearchTermSync);
  const setApiAdvertisedProductSync = useAppStore((s) => s.setApiAdvertisedProductSync);
  const apiCampaignSync = useAppStore((s) => s.apiCampaignSync);
  const apiTargetingSync = useAppStore((s) => s.apiTargetingSync);
  const apiSearchTermSync = useAppStore((s) => s.apiSearchTermSync);
  const apiAdvertisedProductSync = useAppStore((s) => s.apiAdvertisedProductSync);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<SyncAllStepKey, SyncAllStepState>>({
    campaign: { status: 'PENDING' }, targeting: { status: 'PENDING' }, searchTerm: { status: 'PENDING' }, advertisedProduct: { status: 'PENDING' },
  });
  const [showSummary, setShowSummary] = useState(false);
  const [summaryPeriod, setSummaryPeriod] = useState<{ start: string; end: string } | null>(null);

  async function handleSyncAll() {
    if (!startDate || !endDate || running) return;
    setRunning(true);
    setShowSummary(false);
    setSteps({ campaign: { status: 'PENDING' }, targeting: { status: 'PENDING' }, searchTerm: { status: 'PENDING' }, advertisedProduct: { status: 'PENDING' } });

    await runSyncAll(
      startDate,
      endDate,
      {
        campaign: {
          kickoff: syncCampaignData,
          fetchStatus: fetchCampaignSyncStatus,
          fetchResult: fetchCampaignSyncResult,
          applyResult: (rows, requestedPeriod) => setApiCampaignSync(
            buildApiSyncMeta('campaign', requestedPeriod, rows.length, ['campaignId', 'campaignName', 'state', 'budget', 'impressions', 'clicks', 'cost', 'purchases1d', 'sales1d']),
            rows as CampaignRow[],
          ),
        },
        targeting: {
          kickoff: syncTargetingData,
          fetchStatus: fetchTargetingSyncStatus,
          fetchResult: fetchTargetingSyncResult,
          applyResult: (rows, requestedPeriod) => setApiTargetingSync(
            buildApiSyncMeta('targeting', requestedPeriod, rows.length, ['campaignId', 'adGroupId', 'keywordId', 'matchType', 'keyword', 'impressions', 'clicks', 'cost', 'purchases1d', 'sales1d']),
            rows as TargetingRow[],
          ),
        },
        searchTerm: {
          kickoff: syncSearchTermData,
          fetchStatus: fetchSearchTermSyncStatus,
          fetchResult: fetchSearchTermSyncResult,
          applyResult: (rows, requestedPeriod) => setApiSearchTermSync(
            buildApiSyncMeta('searchTerm', requestedPeriod, rows.length, ['campaignId', 'adGroupId', 'keywordId', 'matchType', 'keyword', 'searchTerm', 'impressions', 'clicks', 'cost', 'purchases1d', 'sales1d']),
            rows as SearchTermRow[],
          ),
        },
        advertisedProduct: {
          kickoff: syncAdvertisedProductData,
          fetchStatus: fetchAdvertisedProductSyncStatus,
          fetchResult: fetchAdvertisedProductSyncResult,
          applyResult: (rows, requestedPeriod) => setApiAdvertisedProductSync(
            buildApiSyncMeta('advertisedProduct', requestedPeriod, rows.length, ['campaignId', 'adGroupId', 'advertisedAsin', 'advertisedSku', 'impressions', 'clicks', 'cost', 'purchases1d', 'sales1d']),
            rows as AdvertisedProductRow[],
          ),
        },
      },
      (key, state) => setSteps((s) => ({ ...s, [key]: state })),
    );

    setSummaryPeriod({ start: startDate, end: endDate });
    setRunning(false);
    setShowSummary(true);
  }

  const campaignTotals = apiCampaignSync ? sumCampaignRows(apiCampaignSync.rows) : null;
  const targetingTotals = apiTargetingSync ? sumTargetingRows(apiTargetingSync.rows) : null;
  const searchTermTotals = apiSearchTermSync ? sumSearchTermRows(apiSearchTermSync.rows) : null;
  const advertisedProductTotals = apiAdvertisedProductSync ? sumAdvertisedProductRows(apiAdvertisedProductSync.rows) : null;

  // Reuses the existing, unmodified runReconciliation()/worstStatus() --
  // the same spend-comparison chain (Campaign vs Targeting, Targeting vs
  // Search Term, Targeting vs Advertised Product) already used elsewhere
  // in this app, with its existing 5%/15% tolerance thresholds. Search
  // Term is only ever compared against Targeting through that existing
  // tolerant check -- never forced to equal it exactly.
  const overallChecks = showSummary
    ? runReconciliation({
      campaignSpend: campaignTotals?.spend ?? null,
      targetingSpend: targetingTotals?.spend ?? null,
      searchTermSpend: searchTermTotals?.spend ?? null,
      advertisedProductSpend: advertisedProductTotals?.spend ?? null,
      sellerboardPpcSpend: null,
    })
    : [];
  const overallStatus = overallChecks.length > 0 ? worstStatus(overallChecks) : null;

  return (
    <Card
      title="Sync All Amazon Ads Data"
      subtitle="Runs Campaign, Targeting, Search Term, and Advertised Product syncs sequentially for the same date range. Each step uses its own read-only backend endpoint and never starts a duplicate report while one is already pending."
    >
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy-600">Start Date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy-600">End Date</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1.5 text-sm" />
        </label>
        <button
          onClick={handleSyncAll}
          disabled={running || !startDate || !endDate}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? 'Syncing…' : 'Sync All Amazon Ads Data'}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {SYNC_ALL_ORDER.map((key, i) => (
          <div key={key} className="flex items-center gap-2">
            <Badge tone={SYNC_ALL_STEP_TONE[steps[key].status]}>{SYNC_ALL_STEP_LABEL[key]}</Badge>
            {i < SYNC_ALL_ORDER.length - 1 && <span className="text-navy-400">→</span>}
          </div>
        ))}
      </div>
      {SYNC_ALL_ORDER.some((key) => steps[key].status === 'ERROR') && (
        <div className="mb-3 space-y-1 text-xs text-negative-600">
          {SYNC_ALL_ORDER.filter((key) => steps[key].status === 'ERROR').map((key) => (
            <p key={key}>{SYNC_ALL_STEP_LABEL[key]}: {steps[key].error}</p>
          ))}
        </div>
      )}

      {showSummary && summaryPeriod && (
        <div className="mt-4 border-t border-border-subtle pt-4">
          <h3 className="mb-3 text-sm font-semibold text-navy-900">Final Amazon Sync Summary</h3>
          <p className="mb-3 text-xs text-navy-500">Requested Period: {summaryPeriod.start} → {summaryPeriod.end}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['Campaign', apiCampaignSync?.rows.length, campaignTotals],
              ['Targeting', apiTargetingSync?.rows.length, targetingTotals],
              ['Search Terms', apiSearchTermSync?.rows.length, searchTermTotals],
              ['Advertised Products', apiAdvertisedProductSync?.rows.length, advertisedProductTotals],
            ] as const).map(([label, rowCount, totals]) => (
              <div key={label} className="rounded-lg border border-border-subtle p-3">
                <p className="mb-2 text-xs font-semibold text-navy-600">{label}</p>
                <p className="text-xs text-navy-500">Rows: <span className="font-medium text-navy-900">{rowCount ?? '—'}</span></p>
                <p className="text-xs text-navy-500">Spend: <span className="font-medium text-navy-900">{totals ? formatCurrency(totals.spend) : '—'}</span></p>
                <p className="text-xs text-navy-500">Sales: <span className="font-medium text-navy-900">{totals ? formatCurrency(totals.sales) : '—'}</span></p>
                <p className="text-xs text-navy-500">Orders: <span className="font-medium text-navy-900">{totals ? formatNumber(totals.orders) : '—'}</span></p>
              </div>
            ))}
          </div>
          {overallStatus && (
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className="text-navy-500">Overall Reconciliation</span>
              <Badge tone={RECONCILIATION_STATUS_TONE[overallStatus]}>{RECONCILIATION_STATUS_LABEL[overallStatus]}</Badge>
            </div>
          )}
          <p className="mt-2 text-xs text-navy-500">
            Campaign, Targeting, and Advertised Product spend generally reconcile closely. Search Term totals may differ slightly due to Amazon's own attribution/reporting behavior — this is expected and not forced to match exactly.
          </p>
        </div>
      )}
    </Card>
  );
}

export function Settings() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const products = useAppStore((s) => s.products);
  const addProduct = useAppStore((s) => s.addProduct);
  const updateProduct = useAppStore((s) => s.updateProduct);
  const removeProduct = useAppStore((s) => s.removeProduct);
  const savedAdGroupMappings = useAppStore((s) => s.savedAdGroupMappings);
  const removeSavedMapping = useAppStore((s) => s.removeSavedMapping);
  const setAccountNetProfit = useAppStore((s) => s.setAccountNetProfit);
  const resetAllData = useAppStore((s) => s.resetAllData);
  const ws = useWorkspace();

  const [anpValue, setAnpValue] = useState('');
  const [newProduct, setNewProduct] = useState<Partial<Product>>({ name: '', asin: '', sku: '', sellingPrice: null });

  return (
    <div>
      <PageHeader title="Settings" subtitle="All settings persist locally on this device." />
      <div className="space-y-6 p-8">
        <AmazonAdsApiCard />
        <CampaignSyncCard />
        <TargetingSyncCard />
        <SearchTermSyncCard />
        <AdvertisedProductSyncCard />
        <SyncAllCard />

        <Card title="Strategy Posture & Bid Guardrails">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy-600">Strategy Posture</span>
              <select
                value={settings.strategyPosture}
                onChange={(e) => updateSettings({ strategyPosture: e.target.value as StrategyPosture })}
                className="w-full rounded-lg border border-border-subtle px-3 py-1.5 text-sm"
              >
                <option value="MAINTENANCE">Maintenance</option>
                <option value="GROWTH">Growth</option>
                <option value="AGGRESSIVE_GROWTH">Aggressive Growth</option>
              </select>
            </label>
            <NumberField label="Account Target ACoS" value={settings.targetAcosDefault * 100} onChange={(v) => updateSettings({ targetAcosDefault: v / 100 })} suffix="%" />
            <NumberField label="Max Daily PPC Budget" value={settings.maxDailyPpcBudget} onChange={(v) => updateSettings({ maxDailyPpcBudget: v })} suffix="$" />
            <NumberField label="Max Bid Increase" value={settings.maxBidIncreasePct * 100} onChange={(v) => updateSettings({ maxBidIncreasePct: v / 100 })} suffix="%" />
            <NumberField label="Max Bid Reduction" value={settings.maxBidReductionPct * 100} onChange={(v) => updateSettings({ maxBidReductionPct: v / 100 })} suffix="%" />
            <NumberField label="Stop-loss Clicks" value={settings.stopLossClicks} onChange={(v) => updateSettings({ stopLossClicks: v })} />
            <NumberField label="Stop-loss Spend" value={settings.stopLossSpend} onChange={(v) => updateSettings({ stopLossSpend: v })} suffix="$" />
          </div>
        </Card>

        <Card title="Delivery Thresholds">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <NumberField
              label="Low Delivery max impressions"
              value={settings.deliveryThresholds.lowDeliveryMaxImpressions}
              onChange={(v) => updateSettings({ deliveryThresholds: { ...settings.deliveryThresholds, lowDeliveryMaxImpressions: v } })}
            />
            <NumberField
              label="High Delivery min impressions"
              value={settings.deliveryThresholds.highDeliveryMinImpressions}
              onChange={(v) => updateSettings({ deliveryThresholds: { ...settings.deliveryThresholds, highDeliveryMinImpressions: v } })}
            />
            <NumberField
              label="High Delivery min clicks"
              value={settings.deliveryThresholds.highDeliveryMinClicks}
              onChange={(v) => updateSettings({ deliveryThresholds: { ...settings.deliveryThresholds, highDeliveryMinClicks: v } })}
            />
          </div>
        </Card>

        <Card title="Product Mapping">
          <Table>
            <thead><tr><Th>Name</Th><Th>ASIN</Th><Th>SKU</Th><Th>Selling Price</Th><Th>Aliases</Th><Th></Th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <Td><input defaultValue={p.name} onBlur={(e) => updateProduct(p.id, { name: e.target.value })} className="rounded border border-transparent px-1 py-0.5 hover:border-border-subtle focus:border-border-subtle" /></Td>
                  <Td><input defaultValue={p.asin} onBlur={(e) => updateProduct(p.id, { asin: e.target.value })} className="rounded border border-transparent px-1 py-0.5 font-mono text-xs hover:border-border-subtle focus:border-border-subtle" /></Td>
                  <Td><input defaultValue={p.sku} onBlur={(e) => updateProduct(p.id, { sku: e.target.value })} className="rounded border border-transparent px-1 py-0.5 hover:border-border-subtle focus:border-border-subtle" /></Td>
                  <Td><input defaultValue={p.sellingPrice ?? ''} type="number" onBlur={(e) => updateProduct(p.id, { sellingPrice: e.target.value ? Number(e.target.value) : null })} className="w-20 rounded border border-transparent px-1 py-0.5 hover:border-border-subtle focus:border-border-subtle" /></Td>
                  <Td><input defaultValue={p.aliases.join(', ')} onBlur={(e) => updateProduct(p.id, { aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} className="w-40 rounded border border-transparent px-1 py-0.5 text-xs hover:border-border-subtle focus:border-border-subtle" /></Td>
                  <Td><button onClick={() => removeProduct(p.id)} className="text-xs text-negative-600 hover:underline">Remove</button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="block"><span className="mb-1 block text-xs font-medium text-navy-600">Name</span><input value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} className="w-32 rounded-lg border border-border-subtle px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-navy-600">ASIN</span><input value={newProduct.asin} onChange={(e) => setNewProduct({ ...newProduct, asin: e.target.value })} className="w-32 rounded-lg border border-border-subtle px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-navy-600">SKU</span><input value={newProduct.sku} onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })} className="w-32 rounded-lg border border-border-subtle px-2 py-1.5 text-sm" /></label>
            <button
              onClick={() => {
                if (!newProduct.name) return;
                addProduct({ id: crypto.randomUUID(), name: newProduct.name!, asin: newProduct.asin ?? '', sku: newProduct.sku ?? '', sellingPrice: null, aliases: [], campaignAliases: [], adGroupAliases: [] });
                setNewProduct({ name: '', asin: '', sku: '', sellingPrice: null });
              }}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
            >
              Add Product
            </button>
          </div>
        </Card>

        <Card title="Manual Ad-Group Mappings" subtitle="Persisted locally; used in the product mapping hierarchy before name inference.">
          <Table>
            <thead><tr><Th>Campaign</Th><Th>Ad Group</Th><Th>Product</Th><Th></Th></tr></thead>
            <tbody>
              {savedAdGroupMappings.length === 0 && <tr><Td className="text-navy-500">No manual mappings yet — map unmapped keywords on the Keywords page.</Td></tr>}
              {savedAdGroupMappings.map((m) => (
                <tr key={m.id}>
                  <Td className="max-w-[220px] truncate">{m.campaignName}</Td>
                  <Td className="max-w-[220px] truncate">{m.adGroupName ?? <span className="text-navy-400">(whole campaign)</span>}</Td>
                  <Td>{products.find((p) => p.id === m.productId)?.name ?? m.productId}</Td>
                  <Td><button onClick={() => removeSavedMapping(m.id)} className="text-xs text-negative-600 hover:underline">Remove</button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Account Net Profit by Report Period" subtitle="Stored per period — never carried over into a different date range.">
          {ws.currentPeriod ? (
            <div className="flex items-end gap-2">
              <div className="text-sm text-navy-600">Current period: <span className="font-medium text-navy-900">{ws.currentPeriod.start} → {ws.currentPeriod.end}</span></div>
              <label className="ml-4 block">
                <span className="mb-1 block text-xs font-medium text-navy-600">Account Net Profit ($)</span>
                <input value={anpValue} onChange={(e) => setAnpValue(e.target.value)} type="number" className="w-32 rounded-lg border border-border-subtle px-3 py-1.5 text-sm" placeholder={ws.accountNetProfitEntry ? String(ws.accountNetProfitEntry.accountNetProfit) : '—'} />
              </label>
              <button
                onClick={() => { if (ws.currentPeriod && anpValue !== '') { setAccountNetProfit(ws.currentPeriod, Number(anpValue)); setAnpValue(''); } }}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
              >
                Save
              </button>
            </div>
          ) : (
            <p className="text-sm text-navy-500">No current period established yet — import Amazon reports first.</p>
          )}
          {ws.accountNetProfitEntry && <p className="mt-2 text-xs text-navy-500">Currently set to {formatCurrency(ws.accountNetProfitEntry.accountNetProfit)} for this period.</p>}
        </Card>

        <Card title="Data Reset / Export">
          <button
            onClick={() => { if (confirm('This will permanently delete all locally stored reports, settings, mappings, and shadow snapshots. Continue?')) void resetAllData(); }}
            className="rounded-lg border border-negative-600/30 px-4 py-2 text-sm font-medium text-negative-600 hover:bg-negative-50"
          >
            Reset All Local Data
          </button>
          <p className="mt-2 text-xs text-navy-500">This only affects data stored in this browser. No data was ever sent to a remote server, so there is nothing to delete elsewhere.</p>
        </Card>
      </div>
    </div>
  );
}
