import { describe, it, expect, vi } from 'vitest';
import { runSyncAll, type SyncAllDeps, type SyncAllStepKey, type SyncAllStepState } from './amazonSyncAll';

function stepDeps(overrides: Partial<{
  kickoffSuccess: boolean;
  kickoffError: string;
  statusError: string | null;
  resultSuccess: boolean;
  resultError: string;
  rows: unknown[];
  requestedPeriod: { start: string; end: string };
}> = {}) {
  const applyResult = vi.fn();
  const kickoff = vi.fn().mockResolvedValue(overrides.kickoffSuccess === false ? { success: false, error: overrides.kickoffError ?? 'kickoff failed' } : { success: true, pending: true });
  const fetchStatus = vi.fn().mockResolvedValue({ syncInProgress: false, lastSyncError: overrides.statusError ?? null });
  const fetchResult = vi.fn().mockResolvedValue(
    overrides.resultSuccess === false
      ? { success: false, error: overrides.resultError ?? 'result failed' }
      : { success: true, rows: overrides.rows ?? [{ spend: 1 }], requestedPeriod: overrides.requestedPeriod ?? { start: '2026-08-09', end: '2026-08-12' } },
  );
  return { kickoff, fetchStatus, fetchResult, applyResult };
}

function makeDeps(perStep: Partial<Record<SyncAllStepKey, ReturnType<typeof stepDeps>>> = {}): SyncAllDeps {
  const campaign = perStep.campaign ?? stepDeps();
  const targeting = perStep.targeting ?? stepDeps();
  const searchTerm = perStep.searchTerm ?? stepDeps();
  const advertisedProduct = perStep.advertisedProduct ?? stepDeps();
  return { campaign, targeting, searchTerm, advertisedProduct };
}

describe('runSyncAll -- strictly sequential, never starts the next step early', () => {
  it('runs Campaign -> Targeting -> Search Terms -> Advertised Products in that exact order', async () => {
    const order: string[] = [];
    const perStep: Partial<Record<SyncAllStepKey, ReturnType<typeof stepDeps>>> = {};
    (['campaign', 'targeting', 'searchTerm', 'advertisedProduct'] as SyncAllStepKey[]).forEach((key) => {
      const deps = stepDeps();
      deps.kickoff.mockImplementation(async () => {
        order.push(key);
        return { success: true, pending: true };
      });
      perStep[key] = deps;
    });

    await runSyncAll('2026-08-09', '2026-08-12', makeDeps(perStep), () => {});
    expect(order).toEqual(['campaign', 'targeting', 'searchTerm', 'advertisedProduct']);
  });

  it('never starts a step before the previous one has fully finished (a slow step blocks the next kickoff)', async () => {
    let targetingStarted = false;
    let campaignFinishedBeforeTargetingStarted = false;

    const campaign = stepDeps();
    campaign.fetchStatus
      .mockResolvedValueOnce({ syncInProgress: true, lastSyncError: null })
      .mockResolvedValueOnce({ syncInProgress: false, lastSyncError: null });
    campaign.fetchResult.mockImplementation(async () => {
      campaignFinishedBeforeTargetingStarted = !targetingStarted;
      return { success: true, rows: [{ spend: 1 }], requestedPeriod: { start: '2026-08-09', end: '2026-08-12' } };
    });

    const targeting = stepDeps();
    targeting.kickoff.mockImplementation(async () => {
      targetingStarted = true;
      return { success: true, pending: true };
    });

    await runSyncAll('2026-08-09', '2026-08-12', makeDeps({ campaign, targeting }), () => {}, { pollIntervalMs: 1 });
    expect(campaignFinishedBeforeTargetingStarted).toBe(true);
  });

  it('applies each step\'s result to its own store slot via applyResult, with the correct requested period', async () => {
    const deps = makeDeps();
    await runSyncAll('2026-08-09', '2026-08-12', deps, () => {});
    expect(deps.campaign.applyResult).toHaveBeenCalledWith([{ spend: 1 }], { start: '2026-08-09', end: '2026-08-12' });
    expect(deps.targeting.applyResult).toHaveBeenCalledWith([{ spend: 1 }], { start: '2026-08-09', end: '2026-08-12' });
    expect(deps.searchTerm.applyResult).toHaveBeenCalledWith([{ spend: 1 }], { start: '2026-08-09', end: '2026-08-12' });
    expect(deps.advertisedProduct.applyResult).toHaveBeenCalledWith([{ spend: 1 }], { start: '2026-08-09', end: '2026-08-12' });
  });

  it('reports live per-step progress via onStepUpdate: SYNCING then DONE for each step, in order', async () => {
    const updates: { key: SyncAllStepKey; status: string }[] = [];
    await runSyncAll('2026-08-09', '2026-08-12', makeDeps(), (key, state) => updates.push({ key, status: state.status }));
    expect(updates).toEqual([
      { key: 'campaign', status: 'SYNCING' }, { key: 'campaign', status: 'DONE' },
      { key: 'targeting', status: 'SYNCING' }, { key: 'targeting', status: 'DONE' },
      { key: 'searchTerm', status: 'SYNCING' }, { key: 'searchTerm', status: 'DONE' },
      { key: 'advertisedProduct', status: 'SYNCING' }, { key: 'advertisedProduct', status: 'DONE' },
    ]);
  });
});

describe('runSyncAll -- partial failure handling', () => {
  it('a kickoff failure on one step (e.g. already in progress) does not stop the remaining steps from running', async () => {
    const targeting = stepDeps({ kickoffSuccess: false, kickoffError: 'A targeting sync is already in progress.' });
    const deps = makeDeps({ targeting });

    const results = await runSyncAll('2026-08-09', '2026-08-12', deps, () => {});

    expect(results.campaign.status).toBe('DONE');
    expect(results.targeting.status).toBe('ERROR');
    expect(results.targeting.error).toMatch(/already in progress/);
    // The steps after the failed one still ran and succeeded.
    expect(results.searchTerm.status).toBe('DONE');
    expect(results.advertisedProduct.status).toBe('DONE');
    expect(deps.searchTerm.kickoff).toHaveBeenCalled();
    expect(deps.advertisedProduct.kickoff).toHaveBeenCalled();
  });

  it('a background sync failure (surfaced via status.lastSyncError) on one step does not stop the remaining steps, and never applies a result for the failed step', async () => {
    const searchTerm = stepDeps({ statusError: 'Amazon report generation failed: INTERNAL_ERROR' });
    const deps = makeDeps({ searchTerm });

    const results = await runSyncAll('2026-08-09', '2026-08-12', deps, () => {});

    expect(results.searchTerm.status).toBe('ERROR');
    expect(results.searchTerm.error).toMatch(/INTERNAL_ERROR/);
    expect(deps.searchTerm.applyResult).not.toHaveBeenCalled(); // never applies a failed step's non-existent result
    expect(results.advertisedProduct.status).toBe('DONE'); // still ran after the failure
  });

  it('a result fetch returning success:false does not stop the remaining steps', async () => {
    const advertisedProduct = stepDeps({ resultSuccess: false, resultError: 'No completed advertised product sync result is available yet.' });
    const deps = makeDeps({ advertisedProduct });

    const results = await runSyncAll('2026-08-09', '2026-08-12', deps, () => {});

    expect(results.advertisedProduct.status).toBe('ERROR');
    expect(results.campaign.status).toBe('DONE');
    expect(results.targeting.status).toBe('DONE');
    expect(results.searchTerm.status).toBe('DONE');
  });

  it('an unexpected thrown error in one step is caught and reported, never propagating to abort the whole sequence', async () => {
    const campaign = stepDeps();
    campaign.kickoff.mockRejectedValue(new Error('network exploded'));
    const deps = makeDeps({ campaign });

    const results = await runSyncAll('2026-08-09', '2026-08-12', deps, () => {});

    expect(results.campaign.status).toBe('ERROR');
    expect(results.campaign.error).toMatch(/network exploded/);
    expect(results.targeting.status).toBe('DONE');
  });

  it('all four steps can fail independently without any of them throwing out of runSyncAll', async () => {
    const perStep: Partial<Record<SyncAllStepKey, ReturnType<typeof stepDeps>>> = {
      campaign: stepDeps({ kickoffSuccess: false, kickoffError: 'campaign down' }),
      targeting: stepDeps({ statusError: 'targeting down' }),
      searchTerm: stepDeps({ resultSuccess: false, resultError: 'search term down' }),
      advertisedProduct: stepDeps({ kickoffSuccess: false, kickoffError: 'advertised product down' }),
    };
    const results = await runSyncAll('2026-08-09', '2026-08-12', makeDeps(perStep), () => {});
    (Object.keys(results) as SyncAllStepKey[]).forEach((key) => {
      const r: SyncAllStepState = results[key];
      expect(r.status).toBe('ERROR');
      expect(r.error).toBeTruthy();
    });
  });
});
