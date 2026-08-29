/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Base URL of the local, read-only Amazon Ads API backend (see /server).
  // Always a localhost URL -- never a secret, safe to bundle into the
  // frontend. Defaults to http://127.0.0.1:4001 when unset.
  readonly VITE_AMAZON_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
