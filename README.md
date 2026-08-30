# Zaphira PPC Control

A private, browser-only Amazon PPC decision-support and validation system for Zaphira. It ingests Amazon
advertising CSV exports and Sellerboard profitability exports, combines PPC performance with product
economics, and produces conservative, explainable recommendations. **It never modifies Amazon campaigns
automatically and never requires Amazon API credentials.** Uploaded reports stay on this device.

## Architecture summary

- **Stack:** React 19 + TypeScript + Vite, Tailwind CSS v4, Recharts, PapaParse (CSV), SheetJS/xlsx (XLSX),
  Zustand (state), idb-keyval (IndexedDB persistence), Vitest (tests), react-router-dom (navigation).
- **Layers** (`src/`):
  - `lib/parse` — header normalization/aliasing, flexible date parsing, CSV/XLSX file parsing, and the
    report-to-typed-row importers. Also the **date-period engine** (`periodEngine.ts`) that cross-validates
    every imported report's requested vs. observed activity period and produces one of the six alignment
    statuses (`REPORT_PERIODS_ALIGNED` … `REPORT_SET_MISMATCH`).
  - `lib/aggregate` — Sellerboard daily-row aggregation into one economics record per Marketplace+ASIN+SKU,
    the product-mapping hierarchy (ASIN → SKU → Advertised Product report → saved ad-group mapping →
    explicit alias → name inference → unmapped), campaign/target/search-term enrichment, and spend
    reconciliation across reports.
  - `lib/engine` — pure, unit-tested business rules: delivery classification, the conservative target
    action engine (WAIT/WATCH/REDUCE_BID/SCALE/NEGATIVE_PAUSE_CANDIDATE), campaign-level recommendations,
    historical search-term classification, product strategy classification, the "Next $10" ranking engine,
    the break-even scenario calculator, keyword opportunity deduplication, and Shadow Mode evaluation.
  - `state` — a Zustand store persisted to IndexedDB (settings, product mappings, imported reports, Shadow
    Mode snapshots, Account Net Profit by period) plus `deriveWorkspace.ts`, a single pure function that
    turns raw store state into everything the UI renders (current period, alignment, economics, enriched
    targets/campaigns/search terms, reconciliation, KPIs). Recomputed via `useMemo` on every state change —
    nothing is cached stale.
  - `pages` / `components` — the seven screens (Dashboard, Campaigns, Keywords, Search Terms, Profit &
    Capital, Shadow Mode, Settings) and shared UI primitives.
- **Current vs. historical is structural, not cosmetic.** A row is only ever treated as "current period" if
  its own date evidence overlaps the app's established current period *and* isn't materially wider than it
  (a 30-day cumulative search-term export that merely overlaps a 4-day current window is still historical —
  see `classifyPeriod` in `lib/aggregate/amazon.ts`). Campaign `status` text (`ENABLED`/`PAUSED`) is never
  used to infer current live status; only actual date evidence can produce `CURRENT_ACTIVITY_CONFIRMED`.
- **Everything is local.** All parsing, aggregation, and recommendation logic runs in the browser. Report
  data and settings are persisted to this browser's IndexedDB only; nothing is ever sent to a server.

## Run locally

```bash
npm install
npm run dev
```

## Build for production

```bash
npm run build   # tsc -b && vite build, output in dist/
npm run preview # serve the production build locally
```

## Tests run

```bash
npm run typecheck   # tsc -b --noEmit
npm run lint         # oxlint
npm test             # vitest run
```

60 Vitest cases across 9 files, covering the required financial logic and all twelve named failure modes:

- ACoS with sales / ACoS when sales = 0 (never shows 0%) / CTR, CVR, CPC zero-denominator handling
- Sellerboard daily-row aggregation into one product record; SalesOrganic+SalesPPC without double-counting
  SalesSponsoredProducts; absolute-value, non-duplicated ad spend; break-even ACoS excluding PPC spend;
  net profit including PPC spend
- Product mapping priority (ASIN → SKU → Advertised Product report → saved mapping → explicit alias → name
  inference, with low-confidence inference and unmapped rows both flagged, never silently guessed)
- Delivery classification (No/Low/Delivering/High, including configurable thresholds)
- Target action engine (WAIT, WATCH, REDUCE_BID, SCALE, NEGATIVE_PAUSE_CANDIDATE, PRODUCT_MAPPING_REQUIRED,
  break-even-bounded scale blocking, bid guardrail limits)
- Report period mismatch detection, including the spec's own worked example (Campaign/Targeting Aug 9–12
  vs. Search Term Jul 13–Aug 12 → `REPORT_SET_MISMATCH`, even though the shorter range sits entirely inside
  the longer one)
- Current-period vs. historical separation, including that a wider historical range overlapping the current
  window's tail is still historical, and that `ENABLED` status text alone never confirms current activity
- Duplicate keyword/product differentiation (identical keyword text under different products/ad groups)
- Shadow Mode: non-applied snapshots never receive a directional outcome; applied snapshots are evaluated
  POSITIVE/NEGATIVE/MIXED/INSUFFICIENT_DATA/NON_COMPARABLE_PERIOD and always labeled observational-only
- Account Net Profit period isolation (an entry set for one period is never surfaced under another)

The full app was also manually driven end-to-end through a headless browser with realistic multi-product
fixture data (mixed current/historical periods, a deliberately unmapped campaign, zero-sale keywords, an
unprofitable product) to confirm the calculations, badges, and warnings described above render correctly
and that the browser console stays free of errors on all seven pages.

## Known limitations

- Product mapping's "explicit alias"/"name inference" steps use substring matching, not fuzzy matching —
  aliases should be entered to match how they literally appear in campaign/ad-group names.
- The XLSX parser reads the first sheet of a workbook; multi-sheet Sellerboard exports are not supported.
- Report data is stored in this browser's IndexedDB; switching browsers or devices starts fresh (uploads are
  quick to redo, and this is intentional per the "browser-only, nothing leaves this device" requirement).
- The "Next $10" and scenario calculator are decision-support estimates built from available historical/
  current data, not guarantees — this matches the "recommendation-only" mandate but is worth restating.
- No automated Amazon Ads integration exists or is planned; every export/import is manual CSV/XLSX by design.
