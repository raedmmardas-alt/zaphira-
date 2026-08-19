import { Fragment, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import { CheckIcon, UploadIcon } from '../components/ui/Icons';
import { useAppStore } from '../state/store';
import { useWorkspace } from '../state/useWorkspace';
import { formatCurrency, formatNumber } from '../lib/engine/metrics';
import { aggregateHeliumKeywords } from '../lib/aggregate/heliumKeywords';
import {
  analyzeHeliumKeywords, buildKeywordBlueprint, buildKeywordCampaignSummary, selectRecommendedCampaignKeywords, sortKeywordResults,
} from '../lib/engine/keywordIntelligence';
import { downloadCsv } from '../lib/export/csv';
import { nextSortState, sortKeywordResultsForDisplay, type SortColumn, type SortDirection } from '../lib/engine/keywordSorting';
import { MAX_HELIUM_SOURCES } from '../types/helium';
import type { KeywordAction, KeywordIntelligenceResult } from '../types/helium';

// UI shell for the Helium 10 / Cerebro keyword intelligence system. Layout
// is approved and unchanged — this file only connects real parsing,
// analysis, scoring, bid recommendations, campaign-budget recommendations,
// and column sorting to it.
const ACTION_TONE: Record<KeywordAction, BadgeTone> = { LAUNCH: 'positive', TEST: 'brand', WATCH: 'watch', AVOID: 'negative' };
const RISK_TONE: Record<string, BadgeTone> = { LOW: 'positive', MEDIUM: 'watch', HIGH: 'negative', EXTREME: 'negative' };

// A large multi-competitor Cerebro import can produce tens of thousands of
// analyzed keywords (e.g. ~24,795 unique keywords across 4 sources). The
// intelligence engine itself handles that in well under a second, but
// rendering every row as a DOM <tr> at once does not — real-data testing
// crashed the browser tab. Paginating the (already fully analyzed, already
// fully sorted) results array keeps every keyword included in the dataset
// and every keyword reachable, while only ever mounting one page of rows.
const OPPORTUNITIES_PAGE_SIZE = 100;

const SORT_HEADERS: { label: string; column: SortColumn }[] = [
  { label: 'Keyword', column: 'keyword' },
  { label: 'Search Volume', column: 'searchVolume' },
  { label: 'Competitor Strength', column: 'competitorStrength' },
  { label: 'Zaphira PPC History', column: 'zaphiraHistory' },
  { label: 'Opportunity Score', column: 'opportunityScore' },
  { label: 'Risk', column: 'risk' },
  { label: 'Recommended Match Type', column: 'matchType' },
  { label: 'Recommended Bid', column: 'recommendedBid' },
  { label: 'Maximum Safe Bid', column: 'maxSafeBid' },
  { label: 'Recommended Daily Budget', column: 'recommendedDailyBudget' },
  { label: 'Action', column: 'action' },
];

function SortableTh({ label, column, sortColumn, sortDirection, onSort }: {
  label: string; column: SortColumn; sortColumn: SortColumn | null; sortDirection: SortDirection; onSort: (c: SortColumn) => void;
}) {
  const active = sortColumn === column;
  const icon = !active ? '↕' : sortDirection === 'asc' ? '↑' : '↓';
  return (
    <Th>
      <button onClick={() => onSort(column)} className="flex items-center gap-1 whitespace-nowrap hover:text-navy-900">
        <span>{label}</span>
        <span className={active ? 'text-brand-700' : 'text-navy-300'}>{icon}</span>
      </button>
    </Th>
  );
}

// Short cell text for a missing bid — the full reason is always in the
// title tooltip and in the "Why?" panel.
function compactBidReason(r: KeywordIntelligenceResult): string | null {
  if (r.bidUnavailableReason === null) return null;
  return r.isProductDefinite ? 'Confirm economics' : 'Assign product';
}

export function KeywordFinder() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(0);

  const heliumSources = useAppStore((s) => s.heliumSources);
  const addHeliumKeywordFile = useAppStore((s) => s.addHeliumKeywordFile);
  const removeHeliumKeywordSource = useAppStore((s) => s.removeHeliumKeywordSource);
  const clearHeliumSources = useAppStore((s) => s.clearHeliumSources);
  const products = useAppStore((s) => s.products);
  const settings = useAppStore((s) => s.settings);
  const productManualEconomics = useAppStore((s) => s.productManualEconomics);
  const ws = useWorkspace();

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await addHeliumKeywordFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this file.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleClearAll() {
    if (confirm('Remove all loaded Helium 10 / Cerebro competitor files? This only removes data stored on this device.')) {
      clearHeliumSources();
      setExpanded(new Set());
      setSortColumn(null);
    }
  }

  function handleSort(column: SortColumn) {
    const next = nextSortState({ column: sortColumn, direction: sortDirection }, column);
    setSortColumn(next.column);
    setSortDirection(next.direction);
    setPage(0);
  }

  // Kept as its own memo so a re-sort (below) never re-runs the intelligence
  // engine — only heliumSources/products/economics changes recompute this.
  const results = useMemo(() => {
    const allRows = heliumSources.flatMap((s) => s.rows);
    if (allRows.length === 0) return [];
    const aggregates = aggregateHeliumKeywords(allRows);
    const analyzed = analyzeHeliumKeywords(aggregates, {
      products, targets: ws.targets, searchTerms: ws.searchTerms, economicsById: ws.economicsById, productManualEconomics, settings,
    });
    return sortKeywordResults(analyzed);
  }, [heliumSources, products, ws.targets, ws.searchTerms, ws.economicsById, productManualEconomics, settings]);

  const displayedResults = useMemo(() => sortKeywordResultsForDisplay(results, sortColumn, sortDirection), [results, sortColumn, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(displayedResults.length / OPPORTUNITIES_PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageStart = clampedPage * OPPORTUNITIES_PAGE_SIZE;
  const pagedResults = useMemo(
    () => displayedResults.slice(pageStart, pageStart + OPPORTUNITIES_PAGE_SIZE),
    [displayedResults, pageStart],
  );

  const maxDailyPpcBudget = settings.maxDailyPpcBudget;
  const summary = useMemo(() => buildKeywordCampaignSummary(results, maxDailyPpcBudget), [results, maxDailyPpcBudget]);
  const blueprint = useMemo(() => buildKeywordBlueprint(results, maxDailyPpcBudget), [results, maxDailyPpcBudget]);
  // Which opportunities made the ranked, budget-capped shortlist — used only
  // to tag rows in the (unfiltered) Keyword Opportunities table below.
  // Every analyzed keyword still appears in that table regardless of
  // selection; this never hides an opportunity.
  const selectedKeywordSet = useMemo(
    () => new Set(selectRecommendedCampaignKeywords(results, maxDailyPpcBudget).map((r) => r.normalizedKeyword)),
    [results, maxDailyPpcBudget],
  );

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function exportBlueprintCsv() {
    downloadCsv(
      'zaphira_keyword_campaign_blueprint.csv',
      ['Product', 'Campaign Name', 'Keyword', 'Match Type', 'Recommended Bid', 'Maximum Safe Bid', 'Recommended Daily Allocation', 'Action', 'Reason'],
      blueprint.map((b) => [
        b.productName, b.campaignName, b.keyword, b.matchType,
        b.recommendedBid !== null ? b.recommendedBid.toFixed(2) : '', b.maxSafeBid !== null ? b.maxSafeBid.toFixed(2) : '',
        b.recommendedDailyAllocation !== null ? b.recommendedDailyAllocation.toFixed(2) : '', b.action, b.reason,
      ]),
    );
  }

  const atMax = heliumSources.length >= MAX_HELIUM_SOURCES;

  return (
    <div>
      <PageHeader title="Find New Keywords" subtitle="Upload Helium 10 / Cerebro keyword data and let Zaphira analyze the best opportunities." />
      <div className="space-y-6 p-8">
        <Card title="Upload Helium 10 CSV / XLSX" subtitle="Upload 1-4 competitor/source files — Zaphira merges and deduplicates them automatically.">
          {heliumSources.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-subtle px-6 py-10 text-center">
              <UploadIcon className="text-navy-400" width={28} height={28} />
              <button
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? 'Analyzing…' : 'Upload Helium 10 CSV / XLSX'}
              </button>
              <p className="mt-3 max-w-md text-xs text-navy-500">Files stay on this device. Nothing is uploaded to a remote server.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {heliumSources.map((s, i) => (
                <div key={s.meta.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-navy-900">Source {i + 1}</div>
                    <div className="text-xs text-navy-600">{s.meta.filename}</div>
                    {s.meta.status !== 'FORMAT_NOT_RECOGNIZED' ? (
                      <div className="text-xs text-navy-500">{formatNumber(s.meta.rowCount)} keyword{s.meta.rowCount === 1 ? '' : 's'}</div>
                    ) : (
                      <div className="text-xs text-negative-600">No usable keyword column found in this file.</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {s.meta.status !== 'FORMAT_NOT_RECOGNIZED' ? (
                      <Badge tone="positive"><CheckIcon width={12} height={12} /> Loaded</Badge>
                    ) : (
                      <Badge tone="negative">Not recognized</Badge>
                    )}
                    <button onClick={() => removeHeliumKeywordSource(s.meta.id)} className="text-xs font-medium text-negative-600 hover:underline">Remove</button>
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div>
                  {!atMax ? (
                    <button
                      onClick={() => inputRef.current?.click()}
                      disabled={busy}
                      className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                    >
                      {busy ? 'Analyzing…' : '+ Add another file'}
                    </button>
                  ) : (
                    <p className="text-xs text-navy-500">Maximum 4 competitor files loaded.</p>
                  )}
                </div>
                <button onClick={handleClearAll} className="text-xs font-medium text-negative-600 hover:underline">Clear Helium Data</button>
              </div>
              {results.length > 0 && (
                <p className="text-xs text-navy-500">
                  {results.length} unique keyword{results.length === 1 ? '' : 's'} analyzed across {heliumSources.length} source{heliumSources.length === 1 ? '' : 's'}.
                </p>
              )}
            </div>
          )}
          {error && <p className="mt-2 text-xs text-negative-600">{error}</p>}
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
        </Card>

        <Card title="Recommended Campaign" subtitle={`A ranked shortlist of buildable keywords (LAUNCH/TEST, definite product, calculated safe bid) that fits inside your ${formatCurrency(maxDailyPpcBudget)}/day account PPC budget. An estimated planning maximum, not guaranteed spend.`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border-subtle p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-navy-500">Keywords</div>
              <div className={`mt-1 text-2xl font-semibold ${summary.keywordCount > 0 ? 'text-navy-900' : 'text-navy-300'}`}>{summary.keywordCount > 0 ? summary.keywordCount : '—'}</div>
            </div>
            <div className="rounded-xl border border-border-subtle p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-navy-500">Recommended Daily Budget</div>
              <div className={`mt-1 text-2xl font-semibold ${summary.keywordCount > 0 ? 'text-navy-900' : 'text-navy-300'}`}>{summary.keywordCount > 0 ? formatCurrency(summary.recommendedDailyBudget) : '—'}</div>
            </div>
            <div className="rounded-xl border border-border-subtle p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-navy-500">Estimated Monthly Budget</div>
              <div className={`mt-1 text-2xl font-semibold ${summary.keywordCount > 0 ? 'text-navy-900' : 'text-navy-300'}`}>{summary.keywordCount > 0 ? formatCurrency(summary.estimatedMonthlyBudget) : '—'}</div>
            </div>
          </div>
          {summary.additionalBuildableKeywordsAvailable > 0 && (
            <p className="mt-3 text-xs text-navy-500">
              {summary.additionalBuildableKeywordsAvailable} more buildable keyword{summary.additionalBuildableKeywordsAvailable === 1 ? '' : 's'} available if your daily PPC budget is increased above {formatCurrency(maxDailyPpcBudget)}.
            </p>
          )}
        </Card>

        <Card title="Keyword Opportunities" subtitle="Click a column header to sort. This table will populate once Helium 10 data has been uploaded and analyzed.">
          <Table>
            <thead>
              <tr>
                {SORT_HEADERS.map((h) => (
                  <SortableTh key={h.column} label={h.label} column={h.column} sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedResults.length === 0 && (
                <tr><Td colSpan={SORT_HEADERS.length} className="text-navy-500">No keyword data uploaded yet. Upload a Helium 10 / Cerebro export above to get started.</Td></tr>
              )}
              {pagedResults.map((r) => (
                <Fragment key={r.normalizedKeyword}>
                  <tr onClick={() => toggleExpanded(r.normalizedKeyword)} className="cursor-pointer hover:bg-navy-900/[0.02]" title="Click for why this keyword was scored this way">
                    <Td className="max-w-[220px] truncate font-medium text-navy-900">{r.keyword}</Td>
                    <Td>{r.searchVolume !== null ? formatNumber(r.searchVolume) : '—'}</Td>
                    <Td className="max-w-[200px] truncate text-xs text-navy-600" title={r.competitorStrengthLabel}>{r.competitorStrengthLabel}</Td>
                    <Td className="max-w-[220px] truncate text-xs text-navy-600" title={r.zaphiraHistory.label}>{r.zaphiraHistory.label}</Td>
                    <Td>{r.opportunityScore}</Td>
                    <Td><Badge tone={RISK_TONE[r.risk]}>{r.risk}</Badge></Td>
                    <Td className="text-xs">{r.recommendedMatchType}</Td>
                    <Td>
                      {r.recommendedBid !== null
                        ? formatCurrency(r.recommendedBid)
                        : <span className="text-xs text-navy-400" title={r.bidUnavailableReason ?? undefined}>{compactBidReason(r)}</span>}
                    </Td>
                    <Td>
                      {r.maxSafeBid !== null
                        ? formatCurrency(r.maxSafeBid)
                        : <span className="text-xs text-navy-400" title={r.bidUnavailableReason ?? undefined}>{compactBidReason(r)}</span>}
                    </Td>
                    <Td>{r.recommendedDailyBudget !== null ? formatCurrency(r.recommendedDailyBudget) : '—'}</Td>
                    <Td>
                      <Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge>
                      {selectedKeywordSet.has(r.normalizedKeyword) && <div className="mt-0.5 text-[10px] font-medium text-brand-700">✓ In Campaign</div>}
                    </Td>
                  </tr>
                  {expanded.has(r.normalizedKeyword) && (
                    <tr>
                      <Td colSpan={SORT_HEADERS.length} className="bg-navy-900/[0.02] text-xs text-navy-600">
                        <span className="font-medium text-navy-500">Why? </span>{r.explanation}
                        {r.productName && <span className="ml-2 text-navy-400">Product: {r.productName}{!r.isProductDefinite ? ' (needs confirmation)' : ''}</span>}
                        <span className="ml-2 text-navy-400">Confidence: {r.confidence}</span>
                      </Td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
          {displayedResults.length > OPPORTUNITIES_PAGE_SIZE && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
              <span className="text-xs text-navy-500">
                Showing {pageStart + 1}–{Math.min(pageStart + OPPORTUNITIES_PAGE_SIZE, displayedResults.length)} of {formatNumber(displayedResults.length)} keywords
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={clampedPage === 0}
                  className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-navy-700 hover:bg-navy-900/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-xs text-navy-500">Page {clampedPage + 1} of {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={clampedPage >= totalPages - 1}
                  className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-navy-700 hover:bg-navy-900/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-navy-500">Actions:</span>
            <Badge tone="positive">LAUNCH</Badge>
            <Badge tone="brand">TEST</Badge>
            <Badge tone="negative">AVOID</Badge>
            <Badge tone="watch">WATCH</Badge>
            <span className="ml-2 text-xs text-navy-400">Click a row for why it was scored this way.</span>
          </div>
        </Card>

        {blueprint.length > 0 && (
          <Card
            title="Campaign Blueprint"
            subtitle={`A build sheet to follow manually in Seller Central. Only the selected shortlist above — the keywords that fit inside your ${formatCurrency(maxDailyPpcBudget)}/day account PPC budget — appears here. Zaphira never publishes anything to Amazon automatically.`}
            actions={<button onClick={exportBlueprintCsv} className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-navy-900/5">Download Blueprint CSV</button>}
          >
            <Table>
              <thead>
                <tr><Th>Product</Th><Th>Suggested Campaign Name</Th><Th>Keyword</Th><Th>Match Type</Th><Th>Recommended Bid</Th><Th>Maximum Safe Bid</Th><Th>Recommended Daily Allocation</Th><Th>Action</Th><Th>Reason</Th></tr>
              </thead>
              <tbody>
                {blueprint.map((b, i) => (
                  <tr key={`${b.campaignName}-${b.keyword}-${i}`}>
                    <Td>{b.productName}</Td>
                    <Td className="font-mono text-xs">{b.campaignName}</Td>
                    <Td className="max-w-[200px] truncate font-medium text-navy-900">{b.keyword}</Td>
                    <Td className="text-xs">{b.matchType}</Td>
                    <Td>{b.recommendedBid !== null ? formatCurrency(b.recommendedBid) : '—'}</Td>
                    <Td>{b.maxSafeBid !== null ? formatCurrency(b.maxSafeBid) : '—'}</Td>
                    <Td>{b.recommendedDailyAllocation !== null ? formatCurrency(b.recommendedDailyAllocation) : '—'}</Td>
                    <Td><Badge tone={ACTION_TONE[b.action]}>{b.action}</Badge></Td>
                    <Td className="max-w-[280px] truncate text-xs text-navy-600" title={b.reason}>{b.reason}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}
