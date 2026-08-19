import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ReportType } from '../types';
import { useAppStore } from '../state/store';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';

export const REPORT_LABELS: Record<ReportType, { title: string; description: string; required: boolean }> = {
  campaign: { title: 'Amazon Campaign Report', description: 'Campaign-level performance export', required: true },
  targeting: { title: 'Amazon Targeting Report', description: 'Keyword/target-level performance export', required: true },
  searchTerm: { title: 'Amazon Search Term Report', description: 'Customer search term performance export', required: false },
  advertisedProduct: { title: 'Amazon Advertised Product Report', description: 'Used to strengthen product mapping', required: false },
  sellerboardProduct: { title: 'Sellerboard Product Profitability', description: 'Daily product economics export (CSV/XLSX)', required: true },
  sellerboardKeyword: { title: 'Sellerboard Keyword Report', description: 'Optional keyword-level intelligence', required: false },
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ReportSlot({ type }: { type: ReportType }) {
  const meta = useAppStore((s) => s.reportMeta[type]);
  const importReportFile = useAppStore((s) => s.importReportFile);
  const deleteReport = useAppStore((s) => s.deleteReport);
  const confirmReportPeriod = useAppStore((s) => s.confirmReportPeriod);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const info = REPORT_LABELS[type];

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
    <div className="rounded-xl border border-border-subtle p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-navy-900">
            {info.title} {info.required && <span className="text-negative-600">*</span>}
          </div>
          <div className="text-xs text-navy-500">{info.description}</div>
        </div>
        {meta && (
          <Badge tone={meta.status === 'OK' ? 'positive' : meta.status === 'DEGRADED' ? 'watch' : 'negative'}>
            {meta.status === 'OK' ? 'OK' : meta.status === 'DEGRADED' ? 'DEGRADED' : 'FORMAT NOT RECOGNIZED'}
          </Badge>
        )}
      </div>

      {meta ? (
        <div className="mt-3 space-y-1.5 text-xs text-navy-600">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span>File: <span className="font-medium text-navy-900">{meta.filename}</span></span>
            <span>Size: {formatBytes(meta.fileSizeBytes)}</span>
            <span>Rows: {meta.rowCount.toLocaleString()}</span>
            <span>Imported: {new Date(meta.importedAt).toLocaleString()}</span>
          </div>
          <div>
            Requested period: {meta.requestedPeriod ? `${meta.requestedPeriod.start} → ${meta.requestedPeriod.end}` : '— not detected'}
            {meta.periodConfirmedManually && <span className="ml-1 text-positive-600">(confirmed)</span>}
          </div>
          <div>Observed activity: {meta.observedPeriod ? `${meta.observedPeriod.start} → ${meta.observedPeriod.end}` : '— none detected'}</div>

          {meta.status === 'FORMAT_NOT_RECOGNIZED' && (
            <div className="mt-2 rounded-lg bg-negative-50 p-2 text-negative-600">
              <div className="font-semibold">REPORT FORMAT NOT RECOGNIZED</div>
              <div>Missing required fields: {meta.missingRequiredFields.join(', ')}</div>
              <div className="mt-1">Detected columns: {meta.detectedColumns.join(', ') || '(none)'}</div>
            </div>
          )}
          {meta.status === 'DEGRADED' && meta.missingOptionalFields.length > 0 && (
            <div className="mt-2 rounded-lg bg-watch-50 p-2 text-watch-600">
              Optional fields not found (degraded functionality): {meta.missingOptionalFields.join(', ')}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => inputRef.current?.click()}
              className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-navy-900/5"
            >
              Replace
            </button>
            <button
              onClick={() => deleteReport(type)}
              className="rounded-lg border border-negative-600/20 px-3 py-1.5 text-xs font-medium text-negative-600 hover:bg-negative-50"
            >
              Delete
            </button>
            {!confirming ? (
              <button
                onClick={() => setConfirming(true)}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-navy-900/5"
              >
                Confirm Period
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1 text-xs" />
                <span className="text-xs text-navy-500">to</span>
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1 text-xs" />
                <button
                  disabled={!start || !end}
                  onClick={() => { confirmReportPeriod(type, { start, end }); setConfirming(false); }}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-3 w-full rounded-lg border border-dashed border-border-subtle py-3 text-xs font-medium text-navy-500 hover:border-brand-600 hover:text-brand-700 disabled:opacity-50"
        >
          {busy ? 'Importing…' : 'Upload CSV / XLSX'}
        </button>
      )}
      <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
    </div>
  );
}

export function ReportCoverage() {
  const types: ReportType[] = ['campaign', 'targeting', 'searchTerm', 'advertisedProduct', 'sellerboardProduct', 'sellerboardKeyword'];
  return (
    <Card title="Report Coverage" subtitle="Files stay on this device. Nothing is uploaded to a remote server.">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {types.map((t) => <ReportSlot key={t} type={t} />)}
      </div>
    </Card>
  );
}
