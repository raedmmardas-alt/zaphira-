import { create } from 'zustand';
import type {
  AccountNetProfitEntry, AdvertisedProductRow, CampaignRow, DateRange, DeliveryWorkflowEntry, DeliveryWorkflowStatus,
  Product, ProductManualEconomicsInputs, ReportImportMeta, ReportType, SavedAdGroupMapping, SearchTermRow, Settings, ShadowSnapshot,
  SellerboardKeywordRow, SellerboardProductRow, TargetingRow,
} from '../types';
import { DEFAULT_PRODUCTS, DEFAULT_PRODUCT_MANUAL_ECONOMICS, DEFAULT_SETTINGS, blankManualEconomics } from '../types';
import { DB_KEYS, localDb } from '../lib/storage/db';
import { parseUploadedFile } from '../lib/parse/fileParser';
import {
  importAdvertisedProductReport, importCampaignReport, importSearchTermReport,
  importSellerboardKeywordReport, importSellerboardProductReport, importTargetingReport,
} from '../lib/parse/reportImporters';
import { periodKey } from '../lib/parse/periodEngine';

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

interface AppState {
  hydrated: boolean;
  settings: Settings;
  products: Product[];
  savedAdGroupMappings: SavedAdGroupMapping[];
  reportMeta: Partial<Record<ReportType, ReportImportMeta>>;
  reportRows: ReportRowsByType;
  accountNetProfitByPeriod: Record<string, AccountNetProfitEntry>;
  shadowSnapshots: ShadowSnapshot[];
  deliveryWorkflow: Record<string, DeliveryWorkflowEntry>;
  manualKeywordHistory: { keyword: string; productId: string | null }[];
  productManualEconomics: Record<string, ProductManualEconomicsInputs>;

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
  setAccountNetProfit: (period: DateRange, value: number) => void;
  saveShadowSnapshot: (s: ShadowSnapshot) => void;
  saveShadowSnapshotBatch: (snapshots: ShadowSnapshot[]) => void;
  markShadowApplied: (id: string) => void;
  setDeliveryWorkflowStatus: (targetKey: string, status: DeliveryWorkflowStatus, currentPeriod: DateRange | null) => void;
  addManualKeyword: (keyword: string, productId: string | null) => void;
  updateProductManualEconomics: (productId: string, partial: Partial<ProductManualEconomicsInputs>) => void;
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
  accountNetProfitByPeriod: {},
  shadowSnapshots: [],
  deliveryWorkflow: {},
  manualKeywordHistory: [],
  productManualEconomics: DEFAULT_PRODUCT_MANUAL_ECONOMICS,

  hydrate: async () => {
    const [settings, products, mappings, reports, anp, shadows, deliveryWf, manualKw, manualEcon] = await Promise.all([
      localDb.get<Settings>(DB_KEYS.settings),
      localDb.get<Product[]>(DB_KEYS.products),
      localDb.get<SavedAdGroupMapping[]>(DB_KEYS.savedAdGroupMappings),
      localDb.get<Partial<Record<ReportType, PersistedImport>>>(DB_KEYS.reportImports),
      localDb.get<Record<string, AccountNetProfitEntry>>(DB_KEYS.accountNetProfit),
      localDb.get<ShadowSnapshot[]>(DB_KEYS.shadowSnapshots),
      localDb.get<Record<string, DeliveryWorkflowEntry>>(DB_KEYS.deliveryWorkflow),
      localDb.get<{ keyword: string; productId: string | null }[]>(DB_KEYS.manualKeywordHistory),
      localDb.get<Record<string, ProductManualEconomicsInputs>>(DB_KEYS.productManualEconomics),
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

    set({
      hydrated: true,
      settings: settings ?? DEFAULT_SETTINGS,
      products: resolvedProducts,
      savedAdGroupMappings: mappings ?? [],
      reportMeta,
      reportRows,
      accountNetProfitByPeriod: anp ?? {},
      shadowSnapshots: shadows ?? [],
      deliveryWorkflow: deliveryWf ?? {},
      manualKeywordHistory: manualKw ?? [],
      productManualEconomics: resolvedManualEconomics,
    });
    void localDb.set(DB_KEYS.productManualEconomics, resolvedManualEconomics);
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
    set({ reportMeta: nextMeta, reportRows: nextRows });
    await persistReports(nextMeta, nextRows);
    return meta;
  },

  deleteReport: (type) => {
    const nextMeta = { ...get().reportMeta };
    delete nextMeta[type];
    const nextRows = { ...get().reportRows, [type]: [] } as ReportRowsByType;
    set({ reportMeta: nextMeta, reportRows: nextRows });
    void persistReports(nextMeta, nextRows);
  },

  confirmReportPeriod: (type, period) => {
    const existing = get().reportMeta[type];
    if (!existing) return;
    const nextMeta = { ...get().reportMeta, [type]: { ...existing, requestedPeriod: period, periodConfirmedManually: true } };
    set({ reportMeta: nextMeta });
    void persistReports(nextMeta, get().reportRows);
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
    const next = get().shadowSnapshots.map((s) => (s.id === id ? { ...s, appliedManually: true, appliedAt: new Date().toISOString() } : s));
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

  resetAllData: async () => {
    await Promise.all(Object.values(DB_KEYS).map((k) => localDb.del(k)));
    set({
      settings: DEFAULT_SETTINGS,
      products: DEFAULT_PRODUCTS,
      savedAdGroupMappings: [],
      reportMeta: {},
      reportRows: EMPTY_ROWS,
      accountNetProfitByPeriod: {},
      shadowSnapshots: [],
      deliveryWorkflow: {},
      manualKeywordHistory: [],
      productManualEconomics: DEFAULT_PRODUCT_MANUAL_ECONOMICS,
    });
  },
}));
