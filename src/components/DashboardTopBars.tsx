import { useState } from 'react';
import { NumberField } from './ui/NumberField';
import { useAppStore } from '../state/store';
import { useWorkspace } from '../state/useWorkspace';
import type { ReportType } from '../types';

// The reporting period is driven by whichever of these report types are
// loaded — the same set deriveWorkspace.getCurrentPeriod combines. Setting
// the date range here confirms it on every one currently imported, which is
// exactly the existing per-report "Confirm Period" action (Report Coverage)
// applied at once — no new period concept, no change to how current vs
// historical is determined.
const PERIOD_DRIVING_REPORT_TYPES: ReportType[] = ['campaign', 'targeting', 'advertisedProduct'];

export function DashboardTopBars() {
  const ws = useWorkspace();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const reportMeta = useAppStore((s) => s.reportMeta);
  const confirmReportPeriod = useAppStore((s) => s.confirmReportPeriod);

  const [editingDate, setEditingDate] = useState(false);
  const [start, setStart] = useState(ws.currentPeriod?.start ?? '');
  const [end, setEnd] = useState(ws.currentPeriod?.end ?? '');

  const loadedPeriodTypes = PERIOD_DRIVING_REPORT_TYPES.filter((t) => reportMeta[t]);
  const canEditPeriod = loadedPeriodTypes.length > 0;

  function beginEditing() {
    if (!canEditPeriod) return;
    setStart(ws.currentPeriod?.start ?? '');
    setEnd(ws.currentPeriod?.end ?? '');
    setEditingDate(true);
  }

  function applyDateRange() {
    if (!start || !end) return;
    for (const type of loadedPeriodTypes) confirmReportPeriod(type, { start, end });
    setEditingDate(false);
  }

  return (
    <div className="space-y-3">
      {/* Country / Date Range / Currency */}
      <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border-subtle bg-surface px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-navy-400">Country</span>
          <select
            value={settings.country}
            onChange={(e) => updateSettings({ country: e.target.value })}
            className="rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-navy-900 hover:border-border-subtle focus:border-border-subtle"
          >
            <option value="US">United States 🇺🇸</option>
          </select>
        </div>

        <div className="h-4 w-px bg-border-subtle" />

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-navy-400">Date Range</span>
          {!editingDate ? (
            <button
              onClick={beginEditing}
              disabled={!canEditPeriod}
              title={canEditPeriod ? 'Click to change the reporting period' : 'Import a Campaign, Targeting, or Advertised Product report first'}
              className="rounded-lg px-2 py-1 text-sm font-medium text-navy-900 hover:bg-navy-900/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {ws.currentPeriod ? `${ws.currentPeriod.start} → ${ws.currentPeriod.end}` : '— Not set'}
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1 text-sm" />
              <span className="text-navy-400">→</span>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded-lg border border-border-subtle px-2 py-1 text-sm" />
              <button onClick={applyDateRange} disabled={!start || !end} className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
                Apply
              </button>
              <button onClick={() => setEditingDate(false)} className="rounded-lg px-2 py-1 text-xs text-navy-500 hover:bg-navy-900/5">
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="h-4 w-px bg-border-subtle" />

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-navy-400">Currency</span>
          <select
            value={settings.currency}
            onChange={(e) => updateSettings({ currency: e.target.value })}
            className="rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-navy-900 hover:border-border-subtle focus:border-border-subtle"
          >
            <option value="USD">USD</option>
          </select>
        </div>
      </div>

      {/* Daily PPC Budget / Target ACoS */}
      <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border-subtle bg-rose-100/40 px-5 py-3">
        <NumberField label="Daily PPC Budget" value={settings.maxDailyPpcBudget} onChange={(v) => updateSettings({ maxDailyPpcBudget: v })} step={0.5} suffix="$" />
        <NumberField label="Target ACoS" value={+(settings.targetAcosDefault * 100).toFixed(1)} onChange={(v) => updateSettings({ targetAcosDefault: v / 100 })} step={0.5} suffix="%" />
      </div>
    </div>
  );
}
