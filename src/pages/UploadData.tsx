import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { CheckIcon } from '../components/ui/Icons';
import { REPORT_LABELS } from '../components/ReportCoverage';
import { useAppStore } from '../state/store';
import { useWorkspace } from '../state/useWorkspace';
import { GlobalContextBar } from '../components/layout/GlobalContextBar';
import type { ReportType } from '../types';

// Display order the seller sees, independent of any internal ordering
// elsewhere — matches the guided-upload sequence in the redesign spec.
const WIZARD_ORDER: ReportType[] = ['campaign', 'targeting', 'searchTerm', 'advertisedProduct', 'sellerboardProduct', 'sellerboardKeyword'];

// The reporting period is driven by whichever of these report types are
// loaded (same set as DashboardTopBars/deriveWorkspace.getCurrentPeriod).
// Several real Amazon exports (Targeting, Search Term, Advertised Product)
// don't carry a per-row date column at all — the seller sets the range
// once here and it's applied to every currently-loaded period-driving
// report at once via the same confirmReportPeriod action each report row
// already uses individually.
const PERIOD_DRIVING_REPORT_TYPES: ReportType[] = ['campaign', 'targeting', 'advertisedProduct'];

// User-facing reconciliation wording only — the underlying
// DashboardReconciliationStatus enum used by the reconciliation engine and
// the Advanced technical dashboard is unchanged.
const RECONCILIATION_FRIENDLY: Record<string, { label: string; tone: 'positive' | 'negative' | 'wait' }> = {
  DATA_RECONCILED: { label: 'Data checks passed', tone: 'positive' },
  DATA_MISMATCH_REVIEW_REQUIRED: { label: 'Data needs review', tone: 'negative' },
  INSUFFICIENT_DATA: { label: 'More data needed', tone: 'wait' },
};

function formatShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatPeriod(period: { start: string; end: string } | null): string {
  if (!period) return '';
  return `${formatShortDate(period.start)} – ${formatShortDate(period.end)}`;
}

function ReportRow({ index, type }: { index: number; type: ReportType }) {
  const meta = useAppStore((s) => s.reportMeta[type]);
  const importReportFile = useAppStore((s) => s.importReportFile);
  const deleteReport = useAppStore((s) => s.deleteReport);
  const confirmReportPeriod = useAppStore((s) => s.confirmReportPeriod);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [editingDates, setEditingDates] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const info = REPORT_LABELS[type];
  const period = meta ? meta.requestedPeriod ?? meta.observedPeriod : null;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await importReportFile(type, file);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-900/[0.06] text-xs font-semibold text-navy-500">{index}</div>
        <div>
          <div className="text-sm font-semibold text-navy-900">
            {info.title}{!info.required && <span className="ml-1.5 text-xs font-normal text-navy-400">— Optional</span>}
          </div>
          {meta ? (
            <div className="mt-0.5 text-xs text-navy-500">
              {period ? formatPeriod(period) : 'Period not detected yet'}
              {meta.status === 'FORMAT_NOT_RECOGNIZED' && <span className="ml-2 text-negative-600">Format not recognized — see Advanced for details</span>}
              {meta.status === 'DEGRADED' && <span className="ml-2 text-navy-500">Report loaded — some optional details unavailable</span>}
            </div>
          ) : (
            <div className="mt-0.5 text-xs text-navy-500">{info.description}</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {meta && meta.status !== 'FORMAT_NOT_RECOGNIZED' ? (
          <Badge tone="positive"><CheckIcon width={12} height={12} /> Uploaded</Badge>
        ) : meta ? (
          <Badge tone="negative">Not recognized</Badge>
        ) : null}

        {!editingDates ? (
          <>
            {meta && (
              <button onClick={() => { setStart(period?.start ?? ''); setEnd(period?.end ?? ''); setEditingDates(true); }} className="rounded-lg border border-border-subtle px-2.5 py-1 text-xs font-medium text-navy-700 hover:bg-navy-900/5">
                Edit dates
              </button>
            )}
            {meta && (
              <button onClick={() => deleteReport(type)} className="rounded-lg border border-negative-600/20 px-2.5 py-1 text-xs font-medium text-negative-600 hover:bg-negative-50">
                Remove
              </button>
            )}
            <button onClick={() => inputRef.current?.click()} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy ? 'Uploading…' : meta ? 'Replace' : 'Upload'}
            </button>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1 text-xs" />
            <span className="text-xs text-navy-400">to</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1 text-xs" />
            <button disabled={!start || !end} onClick={() => { confirmReportPeriod(type, { start, end }); setEditingDates(false); }} className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Save</button>
            <button onClick={() => setEditingDates(false)} className="text-xs text-navy-500 hover:underline">Cancel</button>
          </div>
        )}
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
      </div>
    </div>
  );
}

function ReportingPeriodBar() {
  const ws = useWorkspace();
  const reportMeta = useAppStore((s) => s.reportMeta);
  const confirmReportPeriod = useAppStore((s) => s.confirmReportPeriod);
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const loadedPeriodTypes = PERIOD_DRIVING_REPORT_TYPES.filter((t) => reportMeta[t]);
  const canEdit = loadedPeriodTypes.length > 0;

  function begin() {
    if (!canEdit) return;
    setStart(ws.currentPeriod?.start ?? '');
    setEnd(ws.currentPeriod?.end ?? '');
    setEditing(true);
  }

  function apply() {
    if (!start || !end) return;
    for (const type of loadedPeriodTypes) confirmReportPeriod(type, { start, end });
    setEditing(false);
  }

  return (
    <Card title="Reporting Period" subtitle="Applies to every uploaded report at once — most Amazon exports don't include their own date range.">
      {!editing ? (
        <div className="flex items-center gap-3">
          <button
            onClick={begin}
            disabled={!canEdit}
            title={canEdit ? 'Click to set the reporting period for all uploaded reports' : 'Upload a Campaign, Targeting, or Advertised Product report first'}
            className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm font-medium text-navy-900 hover:bg-navy-900/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ws.currentPeriod ? `${ws.currentPeriod.start} → ${ws.currentPeriod.end}` : 'Not set — upload a report first'}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1.5 text-sm" />
          <span className="text-navy-400">→</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1.5 text-sm" />
          <button onClick={apply} disabled={!start || !end} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">Apply to all</button>
          <button onClick={() => setEditing(false)} className="rounded-lg px-2 py-1.5 text-xs text-navy-500 hover:bg-navy-900/5">Cancel</button>
        </div>
      )}
    </Card>
  );
}

export function UploadData() {
  const reportMeta = useAppStore((s) => s.reportMeta);
  const ws = useWorkspace();
  const navigate = useNavigate();

  const requiredTypes = WIZARD_ORDER.filter((t) => REPORT_LABELS[t].required);
  const missingRequired = requiredTypes.filter((t) => !reportMeta[t] || reportMeta[t]?.status === 'FORMAT_NOT_RECOGNIZED');
  const ready = missingRequired.length === 0;
  const reconciliation = RECONCILIATION_FRIENDLY[ws.reconciliation.status] ?? { label: ws.reconciliation.status, tone: 'wait' as const };

  return (
    <div>
      <PageHeader title="Update Your Data" subtitle="Files stay on this device. Nothing is uploaded to a remote server." />
      <div className="space-y-6 p-8">
        <GlobalContextBar />
        <ReportingPeriodBar />

        <Card>
          <div className="space-y-2.5">
            {WIZARD_ORDER.map((t, i) => <ReportRow key={t} index={i + 1} type={t} />)}
          </div>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                {ready ? <CheckIcon className="text-positive-600" width={16} height={16} /> : null}
                <span className={ready ? 'font-medium text-positive-600' : 'text-navy-600'}>
                  {ready ? 'Data ready for analysis' : `${missingRequired.length} required report${missingRequired.length === 1 ? '' : 's'} still needed`}
                </span>
              </div>
              {ready && (
                <div className="flex items-center gap-2 text-sm">
                  <Badge tone={reconciliation.tone}>{reconciliation.label}</Badge>
                </div>
              )}
            </div>
            <button
              onClick={() => navigate('/')}
              disabled={!ready}
              className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ANALYZE MY PPC
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
