// Pure orchestration logic for the "Sync All Amazon Ads Data" button --
// deliberately has no React/UI code in it, so the sequencing/partial-
// failure behavior can be unit-tested directly (mocking the per-step
// functions) without a component test harness, matching this project's
// established pattern (e.g. state/campaignDataSource.test.ts).
//
// Runs Campaign -> Targeting -> Search Terms -> Advertised Products
// STRICTLY SEQUENTIALLY for the same [startDate, endDate] -- the next
// step is never started until the previous one has fully finished
// (success OR failure). This is what keeps Sync All from ever starting
// two Amazon reports at once; each individual sync type's own backend-
// side in-progress guard (see server/src/routes/*Sync.js) is a second,
// independent line of defense on top of this. A failure in any one step
// is captured and does NOT stop the remaining steps from running --
// Campaign/Targeting/Search Term/Advertised Product each write to their
// own separate apiXSync store slot, so one type failing has no bearing on
// whether the others can still succeed.
export type SyncAllStepKey = 'campaign' | 'targeting' | 'searchTerm' | 'advertisedProduct';
export type SyncAllStepStatus = 'PENDING' | 'SYNCING' | 'DONE' | 'ERROR';

export interface SyncAllStepState {
  status: SyncAllStepStatus;
  error?: string;
  rowCount?: number;
}

export interface SyncAllStepDeps<Row> {
  kickoff: (startDate: string, endDate: string) => Promise<{ success: boolean; error?: string }>;
  fetchStatus: () => Promise<{ syncInProgress: boolean; lastSyncError: string | null }>;
  fetchResult: () => Promise<{ success: boolean; error?: string; rows?: Row[]; requestedPeriod?: { start: string; end: string } }>;
  applyResult: (rows: Row[], requestedPeriod: { start: string; end: string }) => void;
}

// Runs one sync step to completion: kick it off, poll status until it's no
// longer in progress, then fetch and apply the result. Never throws --
// always resolves to a step state, so a failure here can never abort
// runSyncAll's sequence below.
async function runOneStep<Row>(
  startDate: string,
  endDate: string,
  fallbackPeriod: { start: string; end: string },
  deps: SyncAllStepDeps<Row>,
  options: { pollIntervalMs?: number; maxPolls?: number } = {},
): Promise<SyncAllStepState> {
  const pollIntervalMs = options.pollIntervalMs ?? 4000;
  const maxPolls = options.maxPolls ?? 4000;
  try {
    const kickoff = await deps.kickoff(startDate, endDate);
    if (!kickoff.success) return { status: 'ERROR', error: kickoff.error ?? 'Sync failed.' };

    let status = await deps.fetchStatus();
    let polls = 0;
    while (status.syncInProgress && polls < maxPolls) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      status = await deps.fetchStatus();
      polls += 1;
    }
    if (status.lastSyncError) return { status: 'ERROR', error: status.lastSyncError };

    const result = await deps.fetchResult();
    if (!result.success || !result.rows) return { status: 'ERROR', error: result.error ?? 'Sync finished but returned no data.' };

    const requestedPeriod = result.requestedPeriod ?? fallbackPeriod;
    deps.applyResult(result.rows, requestedPeriod);
    return { status: 'DONE', rowCount: result.rows.length };
  } catch (err) {
    return { status: 'ERROR', error: err instanceof Error ? err.message : 'Unexpected error during sync.' };
  }
}

export interface SyncAllDeps {
  campaign: SyncAllStepDeps<unknown>;
  targeting: SyncAllStepDeps<unknown>;
  searchTerm: SyncAllStepDeps<unknown>;
  advertisedProduct: SyncAllStepDeps<unknown>;
}

const SYNC_ALL_ORDER: SyncAllStepKey[] = ['campaign', 'targeting', 'searchTerm', 'advertisedProduct'];

export async function runSyncAll(
  startDate: string,
  endDate: string,
  deps: SyncAllDeps,
  onStepUpdate: (key: SyncAllStepKey, state: SyncAllStepState) => void,
  options?: { pollIntervalMs?: number; maxPolls?: number },
): Promise<Record<SyncAllStepKey, SyncAllStepState>> {
  const fallbackPeriod = { start: startDate, end: endDate };
  const results = {} as Record<SyncAllStepKey, SyncAllStepState>;

  for (const key of SYNC_ALL_ORDER) {
    onStepUpdate(key, { status: 'SYNCING' });
    const state = await runOneStep(startDate, endDate, fallbackPeriod, deps[key], options);
    results[key] = state;
    onStepUpdate(key, state);
  }
  return results;
}
