import { get, set, del } from 'idb-keyval';

// Thin wrapper so the rest of the app doesn't depend on idb-keyval directly.
// All uploaded report data and settings stay in this browser's IndexedDB —
// nothing is ever sent to a remote server.
export const localDb = {
  get: <T>(key: string) => get<T>(key),
  set: <T>(key: string, value: T) => set(key, value),
  del: (key: string) => del(key),
};

export const DB_KEYS = {
  settings: 'zaphira/settings',
  products: 'zaphira/products',
  savedAdGroupMappings: 'zaphira/savedAdGroupMappings',
  reportImports: 'zaphira/reportImports',
  accountNetProfit: 'zaphira/accountNetProfit',
  shadowSnapshots: 'zaphira/shadowSnapshots',
  deliveryWorkflow: 'zaphira/deliveryWorkflow',
  manualKeywordHistory: 'zaphira/manualKeywordHistory',
} as const;
