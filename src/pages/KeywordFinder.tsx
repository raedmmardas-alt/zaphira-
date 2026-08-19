import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { UploadIcon } from '../components/ui/Icons';

// UI shell for the upcoming Helium 10 / Cerebro keyword intelligence
// system. No parser or analysis engine exists for this data source yet —
// this page deliberately does not fabricate keyword recommendations. It
// only accepts a file locally (never sent anywhere; nothing is written to
// the app's report store or IndexedDB) and shows what the finished
// experience will look like once the analysis engine ships.
const FUTURE_COLUMNS = [
  'Keyword', 'Search Volume', 'Competitor Strength', 'Zaphira PPC History', 'Opportunity Score',
  'Risk', 'Recommended Match Type', 'Recommended Bid', 'Maximum Safe Bid', 'Recommended Daily Budget', 'Action',
];

export function KeywordFinder() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
  }

  return (
    <div>
      <PageHeader title="Find New Keywords" subtitle="Upload Helium 10 / Cerebro keyword data and let Zaphira analyze the best opportunities." />
      <div className="space-y-6 p-8">
        <Card title="Upload Helium 10 CSV / XLSX">
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-subtle px-6 py-10 text-center">
            <UploadIcon className="text-navy-400" width={28} height={28} />
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Upload Helium 10 CSV / XLSX
            </button>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
            {fileName ? (
              <div className="mt-4 max-w-md text-xs text-navy-600">
                <div className="font-medium text-navy-900">{fileName} received.</div>
                <div className="mt-1">The keyword analysis engine isn't connected yet — this page is a preview of what's coming. Nothing was uploaded anywhere; the file stays on this device only.</div>
              </div>
            ) : (
              <p className="mt-3 max-w-md text-xs text-navy-500">Files stay on this device. Nothing is uploaded to a remote server.</p>
            )}
          </div>
        </Card>

        <Card title="Recommended Campaign" subtitle="Filled in automatically once keyword data has been analyzed.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border-subtle p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-navy-500">Keywords</div>
              <div className="mt-1 text-2xl font-semibold text-navy-300">—</div>
            </div>
            <div className="rounded-xl border border-border-subtle p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-navy-500">Recommended Daily Budget</div>
              <div className="mt-1 text-2xl font-semibold text-navy-300">—</div>
            </div>
            <div className="rounded-xl border border-border-subtle p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-navy-500">Estimated Monthly Budget</div>
              <div className="mt-1 text-2xl font-semibold text-navy-300">—</div>
            </div>
          </div>
        </Card>

        <Card title="Keyword Opportunities" subtitle="This table will populate once Helium 10 data has been uploaded and analyzed.">
          <Table>
            <thead>
              <tr>{FUTURE_COLUMNS.map((c) => <Th key={c}>{c}</Th>)}</tr>
            </thead>
            <tbody>
              <tr><Td colSpan={FUTURE_COLUMNS.length} className="text-navy-500">No keyword data uploaded yet. Upload a Helium 10 / Cerebro export above to get started.</Td></tr>
            </tbody>
          </Table>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-navy-500">Coming actions:</span>
            <Badge tone="positive">LAUNCH</Badge>
            <Badge tone="brand">TEST</Badge>
            <Badge tone="negative">AVOID</Badge>
            <Badge tone="watch">WATCH</Badge>
          </div>
        </Card>
      </div>
    </div>
  );
}
