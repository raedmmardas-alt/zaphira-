# Zaphira Amazon Ads API — local backend (READ-ONLY)

A small local Node.js service that lets Zaphira PPC Control retrieve
advertising data from the Amazon Ads API automatically, instead of
requiring manual CSV/XLSX downloads. It is **read-only** — it cannot
create, pause, or edit a campaign, ad group, keyword, bid, or budget. There
is no code path in this service capable of a write/mutation call to
Amazon Ads.

## Architecture

```
Browser UI (Zaphira PPC Control)
    ↓ localhost only
This local Node backend  (binds to 127.0.0.1, never 0.0.0.0)
    ↓
Amazon LWA token service (https://api.amazon.com/auth/o2/token)
    ↓
Amazon Ads API (read-only calls only)
```

Your Amazon Client Secret, refresh token, and access token **never** reach
the browser. They live only in this backend's local `.env.amazon.local`
file (never committed to Git) and in this process's memory.

## Setup

```bash
cd server
npm install
npm run setup
```

`npm run setup` looks for these two files (on this machine, in your home
directory) and imports them automatically:

- `~/zaphira-amazon-tokens.json` — must contain a `refresh_token` field
- `~/zaphira-amazon-profiles.json` — your Amazon Ads profiles; the script
  picks the US-marketplace one automatically (or asks you to choose if
  there's more than one)

It will prompt you for your **LWA Client Secret** using a hidden terminal
prompt — nothing you type is echoed to the screen, and the value is never
printed anywhere, only saved to a local file with restricted permissions
(`chmod 600`).

If either file is missing, the script will ask you to enter the value
directly instead.

This only writes `server/.env.amazon.local`. Nothing is sent anywhere.

## Running

```bash
cd server
npm start
```

Starts the backend on `http://127.0.0.1:4001` (configurable via
`AMAZON_BACKEND_PORT` in `.env.amazon.local`). Bound to `127.0.0.1` only —
never reachable from another machine or the internet.

Then, in the Zaphira PPC Control app: **Settings → Amazon Ads API → Test
Connection**.

## Read-only guarantee

- `server/src/amazonClient.js` contains only `GET` requests against
  read-only Amazon Ads API endpoints. It must never gain a `POST`/`PUT`/
  `DELETE` call against campaigns, ad groups, keywords, targets, negative
  targeting, bids, or budgets.
- `server/src/routes/amazon.js` exposes exactly two routes:
  `GET /api/amazon/status` and `POST /api/amazon/test-connection`
  (itself read-only — it only fetches profile info to verify the
  connection). No other route exists on this backend.
- `server/test/routes.test.js` asserts that write-shaped requests
  (creating/updating/deleting campaigns, bids, budgets, keywords) return
  404 — there is no route registered to handle them.

## Security notes

- Secrets are loaded once from `server/.env.amazon.local` (gitignored) and
  never logged or returned in any API response — see
  `server/src/logger.js`'s `sanitize()`, which every log line and error
  response passes through.
- The access token obtained via LWA refresh lives only in this process's
  memory (`server/src/amazonAuth.js`) — never written to disk, never sent
  to the browser.
- CORS is restricted to `localhost`/`127.0.0.1` origins only.
- Amazon profile IDs (and other Ads API IDs) can exceed
  `Number.MAX_SAFE_INTEGER`. This backend parses them with
  `server/src/safeJson.js` to avoid silent precision loss that could
  otherwise cause a wrong-profile match.

## Data source

This is milestone A–E only: **secure connection, credential loading,
automatic token refresh, US-profile validation, and the Test Connection
button.** Campaign/Targeting/Search Term/Advertised Product data syncing
is a separate, later milestone — not part of this backend yet. Manual
CSV/XLSX upload in the main app is unaffected and remains fully available.
