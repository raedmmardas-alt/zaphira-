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
  analyzeHeliumKeywords, buildKeywordBlueprint, buildKeywordCampaignSummary, sortKeywordResults,
} from '../lib/engine/keywordIntelligence';
import { downloadCsv } from '../lib/export/csv';
import { MAX_HELIUM_SOURCES } from '../types/helium';
import type { KeywordAction } from '../types/helium';

// UI shell for the Helium 10 / Cerebro keyword intelligence system. Layout
// is approved and unchanged — this file only connects real parsing,
// analysis, scoring, bid recommendations, and campaign-budget
// recommendations to it.
const FUTURE_COLUMNS = [
  'Keyword', 'Search Volume', 'Competitor Strength', 'Zaphira PPC History', 'Opportunity Score',
  'Risk', 'Recommended Match Type', 'Recommended Bid', 'Maximum Safe Bid', 'Recommended Daily Budget', 'Action',
];

const ACTION_TONE: Record<KeywordAction, BadgeTone> = { LAUNCH: 'positive', TEST: 'brand', WATCH: 'watch', AVOID: 'negative' };
const RISK_TONE: Record<string, BadgeTone> = { LOW: 'positive', MEDIUM: 'watch', HIGH: 'negative', EXTREME: 'negative' };

export function KeywordFinder() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const heliumSources = useAppStore((s) => s.heliumSources);
  const addHeliumKeywordFile = useAppStore((s) => s.addHeliumKeywordFile);
  const removeHeliumKeywordSource = useAppStore((s) => s.removeHeliumKeywordSource);
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

  const results = useMemo(() => {
    const allRows = heliumSources.flatMap((s) => s.rows);
    if (allRows.length === 0) return [];
    const aggregates = aggregateHeliumKeywords(allRows);
    const analyzed = analyzeHeliumKeywords(aggregates, {
      products, targets: ws.targets, searchTerms: ws.searchTerms, economicsById: ws.economicsById, productManualEconomics, settings,
    });
    return sortKeywordResults(analyzed);
  }, [heliumSources, products, ws.targets, ws.searchTerms, ws.economicsById, productManualEconomics, settings]);

  const summary = useMemo(() => buildKeywordCampaignSummary(results), [results]);
  const blueprint = useMemo(() => buildKeywordBlueprint(results), [results]);

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

              <div className="pt-1">
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

        <Card title="Recommended Campaign" subtitle="Only counts keywords classified LAUNCH or TEST below — an estimated planning maximum, not guaranteed spend.">
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
        </Card>

        <Card title="Keyword Opportunities" subtitle="This table will populate once Helium 10 data has been uploaded and analyzed.">
          <Table>
            <thead>
              <tr>{FUTURE_COLUMNS.map((c) => <Th key={c}>{c}</Th>)}</tr>
            </thead>
            <tbody>
              {results.length === 0 && (
                <tr><Td colSpan={FUTURE_COLUMNS.length} className="text-navy-500">No keyword data uploaded yet. Upload a Helium 10 / Cerebro export above to get started.</Td></tr>
              )}
              {results.map((r) => (
                <Fragment key={r.normalizedKeyword}>
                  <tr onClick={() => toggleExpanded(r.normalizedKeyword)} className="cursor-pointer hover:bg-navy-900/[0.02]" title="Click for why this keyword was scored this way">
                    <Td className="max-w-[220px] truncate font-medium text-navy-900">{r.keyword}</Td>
                    <Td>{r.searchVolume !== null ? formatNumber(r.searchVolume) : '—'}</Td>
                    <Td className="max-w-[200px] truncate text-xs text-navy-600" title={r.competitorStrengthLabel}>{r.competitorStrengthLabel}</Td>
                    <Td className="max-w-[220px] truncate text-xs text-navy-600" title={r.zaphiraHistory.label}>{r.zaphiraHistory.label}</Td>
                    <Td>{r.opportunityScore}</Td>
                    <Td><Badge tone={RISK_TONE[r.risk]}>{r.risk}</Badge></Td>
                    <Td className="text-xs">{r.recommendedMatchType}</Td>
                    <Td>{r.recommendedBid !== null ? formatCurrency(r.recommendedBid) : '—'}</Td>
                    <Td>{r.maxSafeBid !== null ? formatCurrency(r.maxSafeBid) : '—'}</Td>
                    <Td>{r.recommendedDailyBudget !== null ? formatCurrency(r.recommendedDailyBudget) : '—'}</Td>
                    <Td><Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge></Td>
                  </tr>
                  {expanded.has(r.normalizedKeyword) && (
                    <tr>
                      <Td colSpan={FUTURE_COLUMNS.length} className="bg-navy-900/[0.02] text-xs text-navy-600">
                        <span className="font-medium text-navy-500">Why? </span>{r.explanation}
                        {r.productName && <span className="ml-2 text-navy-400">Product: {r.productName}</span>}
                        <span className="ml-2 text-navy-400">Confidence: {r.confidence}</span>
                      </Td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
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
            subtitle="A build sheet to follow manually in Seller Central. Zaphira never publishes anything to Amazon automatically."
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
