/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Base URL of the read-only Amazon Ads API backend (see /server).
  // Defaults to http://127.0.0.1:4001 (local dev) when unset. For a
  // production build, set this to the deployed backend's own HTTPS URL
  // (e.g. the Railway service URL) -- see server/README.md's "Production
  // deployment (Railway)" section. Never a secret either way -- this is
  // just an address, safe to bundle into the frontend build.
  readonly VITE_AMAZON_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
