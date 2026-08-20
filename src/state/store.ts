import { create } from 'zustand';
import type {
  AccountNetProfitEntry, AdvertisedProductRow, CampaignRow, DateRange, DeliveryWorkflowEntry, DeliveryWorkflowStatus,
  Product, ProductManualEconomicsInputs, ReportImportMeta, ReportType, SavedAdGroupMapping, SearchTermRow, Settings, ShadowSnapshot,
  SellerboardKeywordRow, SellerboardProductRow, TargetingRow,
} from '../types';
import { DEFAULT_PRODUCTS, DEFAULT_PRODUCT_MANUAL_ECONOMICS, DEFAULT_SETTINGS, SUPPORTED_MARKETPLACES, blankManualEconomics } from '../types';
import type { HeliumImportMeta, HeliumImportSource } from '../types/helium';
import { MAX_HELIUM_SOURCES } from '../types/helium';
import { DB_KEYS, localDb } from '../lib/storage/db';
import { parseUploadedFile } from '../lib/parse/fileParser';
import {
  importAdvertisedProductReport, importCampaignReport, importSearchTermReport,
  importSellerboardKeywordReport, importSellerboardProductReport, importTargetingReport,
} from '../lib/parse/reportImporters';
import { importHeliumKeywordFile as parseHeliumKeywordFile } from '../lib/parse/heliumImporter';
import { deriveCurrentPeriod, periodKey } from '../lib/parse/periodEngine';

export interface ReportRowsByType {
  campaign: CampaignRow[];
  targeting: TargetingRow[];
  searchTerm: SearchTermRow[];
  advertisedProduct: AdvertisedProductRow[];
  sellerboardProduct: SellerboardProductRow[];
  sellerboardKeyword: SellerboardKeywordRow[];
}

export const EMPTY_ROWS: ReportRowsByType = {
  campaign: [], targeting: [], searchTerm: [], advertisedProduct: [], sellerboardProduct: [], sellerboardKeyword: [],
};

interface PersistedImport {
  meta: ReportImportMeta;
  rows: unknown[];
}

// One marketplace's saved report set, keyed by (marketplace, reporting
// period). `reportMeta`/`reportRows` — the single "active" slot every page
// already reads from via useWorkspace() — represent whichever
// marketplace/period is currently being viewed; switching marketplace or
// period swaps what's loaded into that slot from here, so deriveWorkspace.ts,
// reconciliation, Home/Optimize/Keyword Finder/Advanced/Profit & Capital all
// keep reading reportMeta/reportRows exactly as before with zero changes.
// `period` is null only for an in-progress upload that hasn't produced a
// confirmed period yet (a "draft") — never fabricated, and never lost: it
// still gets its own snapshot so switching away and back never drops data.
export interface ReportSnapshot {
  id: string; // `${marketplace}__${periodKey}` or `${marketplace}__draft`
  marketplace: string;
  period: DateRange | null;
  savedAt: string;
  reportMeta: Partial<Record<ReportType, ReportImportMeta>>;
  reportRows: ReportRowsByType;
}

// Upserts the CURRENT active reportMeta/reportRows into `snapshots` as one
// marketplace-scoped, period-keyed entry. Called after every upload/delete/
// period-confirmation so a snapshot always exists before the active slot
// can ever be swapped out (marketplace switch, period switch, "start new
// period") — this is what guarantees "uploading a new period never erases
// an older one" and "replacing a report for the same period updates only
// that period" (same period -> same id -> upsert, not append).
function upsertActiveSnapshot(
  snapshots: ReportSnapshot[],
  marketplace: string,
  reportMeta: Partial<Record<ReportType, ReportImportMeta>>,
  reportRows: ReportRowsByType,
): ReportSnapshot[] {
  if (Object.keys(reportMeta).length === 0) return snapshots; // nothing to save
  const period = deriveCurrentPeriod(reportMeta);
  const id = period ? `${marketplace}__${periodKey(period)}` : `${marketplace}__draft`;
  const snapshot: ReportSnapshot = { id, marketplace, period, savedAt: new Date().toISOString(), reportMeta, reportRows };
  let next = snapshots.filter((s) => s.id !== id);
  // Once a real period is confirmed, this marketplace's draft (if any) has
  // "graduated" into the confirmed snapshot — drop the now-redundant draft
  // rather than leaving a stale duplicate around.
  if (period) next = next.filter((s) => s.id !== `${marketplace}__draft`);
  next.push(snapshot);
  return next;
}

// Which saved snapshot to load when switching into a marketplace with no
// explicit period chosen — the most recently-covered confirmed period, or
// (if only a draft exists) the draft itself.
function pickMostRecentSnapshot(candidates: ReportSnapshot[]): ReportSnapshot | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (b.period?.start ?? b.savedAt).localeCompare(a.period?.start ?? a.savedAt))[0];
}

interface AppState {
  hydrated: boolean;
  settings: Settings;
  products: Product[];
  savedAdGroupMappings: SavedAdGroupMapping[];
  reportMeta: Partial<Record<ReportType, ReportImportMeta>>;
  reportRows: ReportRowsByType;
  // Every confirmed (and in-progress draft) report set for every
  // marketplace — see ReportSnapshot. reportMeta/reportRows above always
  // mirror exactly one entry here (or an empty/new draft not yet worth
  // saving).
  reportSnapshots: ReportSnapshot[];
  // A view-only sub-range filter applied on top of whichever
  // marketplace/period is active — see lib/aggregate/customRangeFilter.ts.
  // Cleared automatically on any marketplace/period switch.
  customDateRange: DateRange | null;
  accountNetProfitByPeriod: Record<string, AccountNetProfitEntry>;
  shadowSnapshots: ShadowSnapshot[];
  deliveryWorkflow: Record<string, DeliveryWorkflowEntry>;
  manualKeywordHistory: { keyword: string; productId: string | null }[];
  productManualEconomics: Record<string, ProductManualEconomicsInputs>;
  // 1-4 Helium 10 / Cerebro competitor/source files, persisted separately
  // from the Amazon/Sellerboard reportMeta/reportRows machinery (and its
  // ReportType union) below — Helium keyword data never feeds
  // reconciliation, the period engine, or report-quality status, so it
  // deliberately isn't threaded through that shared pipeline.
  heliumSources: HeliumImportSource[];

  hydrate: () => Promise<void>;
  updateSettings: (partial: Partial<Settings>) => void;
  addProduct: (p: Product) => void;
  updateProduct: (id: string, partial: Partial<Product>) => void;
  removeProduct: (id: string) => void;
  addSavedMapping: (m: Omit<SavedAdGroupMapping, 'id' | 'createdAt'>) => void;
  removeSavedMapping: (id: string) => void;
  importReportFile: (type: ReportType, file: File) => Promise<ReportImportMeta>;
  deleteReport: (type: ReportType) => void;
  confirmReportPeriod: (type: ReportType, period: DateRange) => void;
  // Switches which marketplace's report data is active — saves whatever is
  // currently loaded as a snapshot first (never loses in-progress work),
  // then loads the target marketplace's most recently saved period (or an
  // empty slate if that marketplace has no data yet).
  setActiveMarketplace: (country: string) => void;
  // Switches to a specific saved snapshot (by id) within the CURRENT
  // marketplace — used by the Reporting Period history picker.
  setActivePeriod: (id: string) => void;
  // Saves the current active data as a snapshot (if it has anything in it),
  // then clears the active slot so fresh uploads start a genuinely new
  // reporting period instead of merging into whatever was already loaded.
  startNewReportingPeriod: () => void;
  setCustomDateRange: (range: DateRange | null) => void;
  setAccountNetProfit: (period: DateRange, value: number) => void;
  saveShadowSnapshot: (s: ShadowSnapshot) => void;
  saveShadowSnapshotBatch: (snapshots: ShadowSnapshot[]) => void;
  markShadowApplied: (id: string) => void;
  markShadowAccepted: (id: string) => void;
  markShadowRejected: (id: string) => void;
  setDeliveryWorkflowStatus: (targetKey: string, status: DeliveryWorkflowStatus, currentPeriod: DateRange | null) => void;
  addManualKeyword: (keyword: string, productId: string | null) => void;
  updateProductManualEconomics: (productId: string, partial: Partial<ProductManualEconomicsInputs>) => void;
  addHeliumKeywordFile: (file: File) => Promise<HeliumImportMeta>;
  removeHeliumKeywordSource: (sourceId: string) => void;
  clearHeliumSources: () => void;
  resetAllData: () => Promise<void>;
}

// Every configured product always has a manual-economics record — new
// products (added via Settings, or on first-ever load) are seeded with the
// known Rose/Coconut/Mango/Vanilla starting values when recognized, or a
// fully blank (nothing guessed) record otherwise.
function seedMissingManualEconomics(
  existing: Record<string, ProductManualEconomicsInputs>,
  products: Product[],
): Record<string, ProductManualEconomicsInputs> {
  const next = { ...existing };
  for (const p of products) {
    if (!next[p.id]) {
      next[p.id] = DEFAULT_PRODUCT_MANUAL_ECONOMICS[p.id] ?? blankManualEconomics(p.id);
    }
  }
  return next;
}

async function persistReports(reportMeta: AppState['reportMeta'], reportRows: ReportRowsByType) {
  const combined: Partial<Record<ReportType, PersistedImport>> = {};
  for (const type of Object.keys(reportMeta) as ReportType[]) {
    const meta = reportMeta[type];
    if (!meta) continue;
    combined[type] = { meta, rows: reportRows[type] as unknown[] };
  }
  await localDb.set(DB_KEYS.reportImports, combined);
}

export const useAppStore = create<AppState>((set, get) => ({
  hydrated: false,
  settings: DEFAULT_SETTINGS,
  products: DEFAULT_PRODUCTS,
  savedAdGroupMappings: [],
  reportMeta: {},
  reportRows: EMPTY_ROWS,
  reportSnapshots: [],
  customDateRange: null,
  accountNetProfitByPeriod: {},
  shadowSnapshots: [],
  deliveryWorkflow: {},
  manualKeywordHistory: [],
  productManualEconomics: DEFAULT_PRODUCT_MANUAL_ECONOMICS,
  heliumSources: [],

  hydrate: async () => {
    const [settings, products, mappings, reports, anp, shadows, deliveryWf, manualKw, manualEcon, heliumSources, snapshotsPersisted, customRangePersisted] = await Promise.all([
      localDb.get<Settings>(DB_KEYS.settings),
      localDb.get<Product[]>(DB_KEYS.products),
      localDb.get<SavedAdGroupMapping[]>(DB_KEYS.savedAdGroupMappings),
      localDb.get<Partial<Record<ReportType, PersistedImport>>>(DB_KEYS.reportImports),
      localDb.get<Record<string, AccountNetProfitEntry>>(DB_KEYS.accountNetProfit),
      localDb.get<ShadowSnapshot[]>(DB_KEYS.shadowSnapshots),
      localDb.get<Record<string, DeliveryWorkflowEntry>>(DB_KEYS.deliveryWorkflow),
      localDb.get<{ keyword: string; productId: string | null }[]>(DB_KEYS.manualKeywordHistory),
      localDb.get<Record<string, ProductManualEconomicsInputs>>(DB_KEYS.productManualEconomics),
      localDb.get<HeliumImportSource[]>(DB_KEYS.heliumKeywordImport),
      localDb.get<ReportSnapshot[]>(DB_KEYS.reportSnapshots),
      localDb.get<DateRange | null>(DB_KEYS.customDateRange),
    ]);

    const reportMeta: AppState['reportMeta'] = {};
    const reportRows: ReportRowsByType = { ...EMPTY_ROWS };
    if (reports) {
      for (const type of Object.keys(reports) as ReportType[]) {
        const entry = reports[type];
        if (!entry) continue;
        reportMeta[type] = entry.meta;
        (reportRows as Record<ReportType, unknown[]>)[type] = entry.rows;
      }
    }

    const resolvedProducts = products ?? DEFAULT_PRODUCTS;
    const resolvedManualEconomics = seedMissingManualEconomics(manualEcon ?? {}, resolvedProducts);
    const resolvedSettings = settings ?? DEFAULT_SETTINGS;

    // Migration: pre-marketplace installs have report data (reportMeta/
    // reportRows) but no reportSnapshots at all. Back-fill it into the new
    // history as a United States snapshot WITHOUT touching or clearing
    // reportMeta/reportRows themselves — the active slot loads exactly as
    // it always did, so existing users see zero change; it's now ALSO
    // safely backed up into history. Runs at most once per install: after
    // the first hydrate, reportSnapshots is always non-empty going forward
    // (even an empty array is persisted the first time any snapshot action
    // runs), so this never re-fires and overwrite newer history.
    let resolvedSnapshots = Array.isArray(snapshotsPersisted) ? snapshotsPersisted : [];
    if (resolvedSnapshots.length === 0 && Object.keys(reportMeta).length > 0) {
      resolvedSnapshots = upsertActiveSnapshot([], resolvedSettings.country, reportMeta, reportRows);
    }

    set({
      hydrated: true,
      settings: resolvedSettings,
      products: resolvedProducts,
      savedAdGroupMappings: mappings ?? [],
      reportMeta,
      reportRows,
      reportSnapshots: resolvedSnapshots,
      customDateRange: customRangePersisted ?? null,
      accountNetProfitByPeriod: anp ?? {},
      shadowSnapshots: shadows ?? [],
      deliveryWorkflow: deliveryWf ?? {},
      manualKeywordHistory: manualKw ?? [],
      productManualEconomics: resolvedManualEconomics,
      // Defensive: a valid persisted value is always an array; anything
      // else (e.g. leftover data from an earlier single-source shape) is
      // treated as no sources loaded, never guessed at or partially reused.
      heliumSources: Array.isArray(heliumSources) ? heliumSources : [],
    });
    void localDb.set(DB_KEYS.productManualEconomics, resolvedManualEconomics);
    void localDb.set(DB_KEYS.reportSnapshots, resolvedSnapshots);
  },

  updateSettings: (partial) => {
    const next = { ...get().settings, ...partial };
    set({ settings: next });
    void localDb.set(DB_KEYS.settings, next);
  },

  addProduct: (p) => {
    const next = [...get().products, p];
    set({ products: next });
    void localDb.set(DB_KEYS.products, next);
    // New products always get a manual-economics record (blank — nothing guessed).
    const nextEcon = seedMissingManualEconomics(get().productManualEconomics, next);
    set({ productManualEconomics: nextEcon });
    void localDb.set(DB_KEYS.productManualEconomics, nextEcon);
  },
  updateProduct: (id, partial) => {
    const next = get().products.map((p) => (p.id === id ? { ...p, ...partial } : p));
    set({ products: next });
    void localDb.set(DB_KEYS.products, next);
  },
  removeProduct: (id) => {
    const next = get().products.filter((p) => p.id !== id);
    set({ products: next });
    void localDb.set(DB_KEYS.products, next);
  },

  addSavedMapping: (m) => {
    const entry: SavedAdGroupMapping = { ...m, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    const next = [...get().savedAdGroupMappings, entry];
    set({ savedAdGroupMappings: next });
    void localDb.set(DB_KEYS.savedAdGroupMappings, next);
  },
  removeSavedMapping: (id) => {
    const next = get().savedAdGroupMappings.filter((m) => m.id !== id);
    set({ savedAdGroupMappings: next });
    void localDb.set(DB_KEYS.savedAdGroupMappings, next);
  },

  importReportFile: async (type, file) => {
    const raw = await parseUploadedFile(file);
    const fileDesc = { name: file.name, size: file.size };
    let meta: ReportImportMeta;
    let rows: unknown[];
    switch (type) {
      case 'campaign': { const r = importCampaignReport(fileDesc, raw); meta = r.meta; rows = r.rows; break; }
      case 'targeting': { const r = importTargetingReport(fileDesc, raw); meta = r.meta; rows = r.rows; break; }
      case 'searchTerm': { const r = importSearchTermReport(fileDesc, raw); meta = r.meta; rows = r.rows; break; }
      case 'advertisedProduct': { const r = importAdvertisedProductReport(fileDesc, raw); meta = r.meta; rows = r.rows; break; }
      case 'sellerboardProduct': { const r = importSellerboardProductReport(fileDesc, raw); meta = r.meta; rows = r.rows; break; }
      case 'sellerboardKeyword': { const r = importSellerboardKeywordReport(fileDesc, raw); meta = r.meta; rows = r.rows; break; }
    }
    const nextMeta = { ...get().reportMeta, [type]: meta };
    const nextRows = { ...get().reportRows, [type]: rows } as ReportRowsByType;
    const nextSnapshots = upsertActiveSnapshot(get().reportSnapshots, get().settings.country, nextMeta, nextRows);
    set({ reportMeta: nextMeta, reportRows: nextRows, reportSnapshots: nextSnapshots });
    await persistReports(nextMeta, nextRows);
    void localDb.set(DB_KEYS.reportSnapshots, nextSnapshots);
    return meta;
  },

  deleteReport: (type) => {
    const nextMeta = { ...get().reportMeta };
    delete nextMeta[type];
    const nextRows = { ...get().reportRows, [type]: [] } as ReportRowsByType;
    const nextSnapshots = upsertActiveSnapshot(get().reportSnapshots, get().settings.country, nextMeta, nextRows);
    set({ reportMeta: nextMeta, reportRows: nextRows, reportSnapshots: nextSnapshots });
    void persistReports(nextMeta, nextRows);
    void localDb.set(DB_KEYS.reportSnapshots, nextSnapshots);
  },

  confirmReportPeriod: (type, period) => {
    const existing = get().reportMeta[type];
    if (!existing) return;
    const nextMeta = { ...get().reportMeta, [type]: { ...existing, requestedPeriod: period, periodConfirmedManually: true } };
    const nextSnapshots = upsertActiveSnapshot(get().reportSnapshots, get().settings.country, nextMeta, get().reportRows);
    set({ reportMeta: nextMeta, reportSnapshots: nextSnapshots });
    void persistReports(nextMeta, get().reportRows);
    void localDb.set(DB_KEYS.reportSnapshots, nextSnapshots);
  },

  setActiveMarketplace: (country) => {
    const marketplace = SUPPORTED_MARKETPLACES.find((m) => m.country === country);
    if (!marketplace) return;
    const state = get();
    // Save whatever's currently active before switching away — never lost,
    // even if it hasn't reached a confirmed period yet (saved as a draft).
    const saved = upsertActiveSnapshot(state.reportSnapshots, state.settings.country, state.reportMeta, state.reportRows);
    const candidates = saved.filter((s) => s.marketplace === marketplace.country);
    const toLoad = pickMostRecentSnapshot(candidates);
    const nextSettings = { ...state.settings, country: marketplace.country, currency: marketplace.currency };
    const nextMeta = toLoad ? toLoad.reportMeta : {};
    const nextRows = toLoad ? toLoad.reportRows : EMPTY_ROWS;
    set({ settings: nextSettings, reportSnapshots: saved, reportMeta: nextMeta, reportRows: nextRows, customDateRange: null });
    void localDb.set(DB_KEYS.settings, nextSettings);
    void localDb.set(DB_KEYS.reportSnapshots, saved);
    void persistReports(nextMeta, nextRows);
    void localDb.set(DB_KEYS.customDateRange, null);
  },

  setActivePeriod: (id) => {
    const state = get();
    const target = state.reportSnapshots.find((s) => s.id === id);
    if (!target || target.marketplace !== state.settings.country) return;
    const saved = upsertActiveSnapshot(state.reportSnapshots, state.settings.country, state.reportMeta, state.reportRows);
    set({ reportSnapshots: saved, reportMeta: target.reportMeta, reportRows: target.reportRows, customDateRange: null });
    void localDb.set(DB_KEYS.reportSnapshots, saved);
    void persistReports(target.reportMeta, target.reportRows);
    void localDb.set(DB_KEYS.customDateRange, null);
  },

  startNewReportingPeriod: () => {
    const state = get();
    const saved = upsertActiveSnapshot(state.reportSnapshots, state.settings.country, state.reportMeta, state.reportRows);
    set({ reportSnapshots: saved, reportMeta: {}, reportRows: EMPTY_ROWS, customDateRange: null });
    void localDb.set(DB_KEYS.reportSnapshots, saved);
    void persistReports({}, EMPTY_ROWS);
    void localDb.set(DB_KEYS.customDateRange, null);
  },

  setCustomDateRange: (range) => {
    set({ customDateRange: range });
    void localDb.set(DB_KEYS.customDateRange, range);
  },

  setAccountNetProfit: (period, value) => {
    const key = periodKey(period);
    const entry: AccountNetProfitEntry = { periodKey: key, period, accountNetProfit: value, enteredAt: new Date().toISOString() };
    const next = { ...get().accountNetProfitByPeriod, [key]: entry };
    set({ accountNetProfitByPeriod: next });
    void localDb.set(DB_KEYS.accountNetProfit, next);
  },

  saveShadowSnapshot: (s) => {
    const next = [...get().shadowSnapshots, s];
    set({ shadowSnapshots: next });
    void localDb.set(DB_KEYS.shadowSnapshots, next);
  },
  saveShadowSnapshotBatch: (snapshots) => {
    // Appends the whole batch in one atomic update — never overwrites
    // previously saved snapshots, and avoids partial-write races that a
    // loop of single saveShadowSnapshot calls could risk.
    const next = [...get().shadowSnapshots, ...snapshots];
    set({ shadowSnapshots: next });
    void localDb.set(DB_KEYS.shadowSnapshots, next);
  },
  markShadowApplied: (id) => {
    const now = new Date().toISOString();
    const next = get().shadowSnapshots.map((s) => (s.id === id ? { ...s, appliedManually: true, appliedAt: now, status: 'APPLIED_MANUALLY' as const, statusUpdatedAt: now } : s));
    set({ shadowSnapshots: next });
    void localDb.set(DB_KEYS.shadowSnapshots, next);
  },
  markShadowAccepted: (id) => {
    // Observational only — does NOT set appliedManually, so it never counts
    // toward directional accuracy (only APPLIED_MANUALLY does).
    const next = get().shadowSnapshots.map((s) => (s.id === id ? { ...s, status: 'ACCEPTED' as const, statusUpdatedAt: new Date().toISOString() } : s));
    set({ shadowSnapshots: next });
    void localDb.set(DB_KEYS.shadowSnapshots, next);
  },
  markShadowRejected: (id) => {
    const next = get().shadowSnapshots.map((s) => (s.id === id ? { ...s, status: 'REJECTED' as const, statusUpdatedAt: new Date().toISOString() } : s));
    set({ shadowSnapshots: next });
    void localDb.set(DB_KEYS.shadowSnapshots, next);
  },

  setDeliveryWorkflowStatus: (targetKey, status, currentPeriod) => {
    const existing = get().deliveryWorkflow[targetKey];
    const entry: DeliveryWorkflowEntry = {
      targetKey,
      status,
      periodsObservedLowNoDelivery: existing?.periodsObservedLowNoDelivery ?? 0,
      updatedAt: new Date().toISOString(),
    };
    void currentPeriod;
    const next = { ...get().deliveryWorkflow, [targetKey]: entry };
    set({ deliveryWorkflow: next });
    void localDb.set(DB_KEYS.deliveryWorkflow, next);
  },

  addManualKeyword: (keyword, productId) => {
    const next = [...get().manualKeywordHistory, { keyword, productId }];
    set({ manualKeywordHistory: next });
    void localDb.set(DB_KEYS.manualKeywordHistory, next);
  },

  updateProductManualEconomics: (productId, partial) => {
    const existing = get().productManualEconomics[productId] ?? blankManualEconomics(productId);
    const entry: ProductManualEconomicsInputs = { ...existing, ...partial, productId, updatedAt: new Date().toISOString() };
    const next = { ...get().productManualEconomics, [productId]: entry };
    set({ productManualEconomics: next });
    void localDb.set(DB_KEYS.productManualEconomics, next);
  },

  addHeliumKeywordFile: async (file) => {
    // Enforced here too (not just by hiding the "Add another file" control
    // in the UI once 4 are loaded) so the 1-4 limit holds regardless of
    // caller.
    if (get().heliumSources.length >= MAX_HELIUM_SOURCES) {
      throw new Error(`Maximum ${MAX_HELIUM_SOURCES} competitor files loaded.`);
    }
    const raw = await parseUploadedFile(file);
    const { meta, rows } = parseHeliumKeywordFile({ name: file.name, size: file.size }, raw);
    const nextSource: HeliumImportSource = { meta, rows };
    const next = [...get().heliumSources, nextSource];
    set({ heliumSources: next });
    await localDb.set(DB_KEYS.heliumKeywordImport, next);
    return meta;
  },

  removeHeliumKeywordSource: (sourceId) => {
    const next = get().heliumSources.filter((s) => s.meta.id !== sourceId);
    set({ heliumSources: next });
    void localDb.set(DB_KEYS.heliumKeywordImport, next);
  },

  clearHeliumSources: () => {
    set({ heliumSources: [] });
    void localDb.set(DB_KEYS.heliumKeywordImport, []);
  },

  resetAllData: async () => {
    await Promise.all(Object.values(DB_KEYS).map((k) => localDb.del(k)));
    set({
      settings: DEFAULT_SETTINGS,
      products: DEFAULT_PRODUCTS,
      savedAdGroupMappings: [],
      reportMeta: {},
      reportRows: EMPTY_ROWS,
      reportSnapshots: [],
      customDateRange: null,
      accountNetProfitByPeriod: {},
      shadowSnapshots: [],
      deliveryWorkflow: {},
      manualKeywordHistory: [],
      productManualEconomics: DEFAULT_PRODUCT_MANUAL_ECONOMICS,
      heliumSources: [],
    });
  },
}));
