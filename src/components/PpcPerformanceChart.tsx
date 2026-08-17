import { useMemo, useState } from 'react';
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card } from './ui/Card';
import { bucketSeries } from '../lib/engine/ppcPerformanceSeries';
import type { ChartGranularity, PerformancePoint } from '../lib/engine/ppcPerformanceSeries';
import { formatCurrency, formatNumber } from '../lib/engine/metrics';

const GRANULARITIES: ChartGranularity[] = ['daily', 'weekly', 'monthly'];

function formatAxisLabel(dateKey: string, granularity: ChartGranularity): string {
  const d = new Date(dateKey + 'T00:00:00Z');
  if (granularity === 'monthly') return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

interface TooltipProps {
  active?: boolean;
  payload?: { payload: PerformancePoint }[];
  granularity: ChartGranularity;
}

function PerformanceTooltip({ active, payload, granularity }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const prefix = granularity === 'weekly' ? 'Week of ' : '';
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2.5 text-xs shadow-lg">
      <div className="mb-1.5 font-semibold text-navy-900">{prefix}{formatAxisLabel(point.date, granularity)}</div>
      <div className="space-y-1 text-navy-600">
        <div className="flex items-center justify-between gap-4"><span>Spend</span><span className="font-medium text-navy-900">{formatCurrency(point.spend)}</span></div>
        <div className="flex items-center justify-between gap-4"><span>Sales</span><span className="font-medium text-navy-900">{formatCurrency(point.sales)}</span></div>
        <div className="flex items-center justify-between gap-4"><span>Clicks</span><span className="font-medium text-navy-900">{formatNumber(point.clicks)}</span></div>
        <div className="flex items-center justify-between gap-4"><span>Impressions</span><span className="font-medium text-navy-900">{formatNumber(point.impressions)}</span></div>
      </div>
    </div>
  );
}

export function PpcPerformanceChart({ dailySeries }: { dailySeries: PerformancePoint[] }) {
  const [granularity, setGranularity] = useState<ChartGranularity>('daily');
  const [showImpressions, setShowImpressions] = useState(false);
  const [showClicks, setShowClicks] = useState(false);

  const data = useMemo(() => bucketSeries(dailySeries, granularity), [dailySeries, granularity]);
  const showCountAxis = showImpressions || showClicks;

  return (
    <Card
      title="PPC Performance"
      subtitle="Spend and attributed sales over time, from the uploaded Campaign report."
      actions={
        <div className="flex items-center gap-1 rounded-lg border border-border-subtle p-1 text-xs">
          {GRANULARITIES.map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`rounded-md px-2.5 py-1 font-medium capitalize transition-colors ${granularity === g ? 'bg-brand-600 text-white' : 'text-navy-600 hover:bg-navy-900/5'}`}
            >
              {g}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-5 text-xs text-navy-600">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-brand-600" />PPC Spend</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-600" />Attributed Sales</span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={showImpressions} onChange={(e) => setShowImpressions(e.target.checked)} />
          Impressions
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={showClicks} onChange={(e) => setShowClicks(e.target.checked)} />
          Clicks
        </label>
      </div>

      {data.length === 0 ? (
        <div className="rounded-lg bg-navy-900/[0.02] px-6 py-10 text-center text-sm text-navy-500">
          No per-day activity found in the uploaded Campaign report. This chart only plots dates that genuinely exist in the file — it never fabricates a daily breakdown from an aggregated report. Export a Campaign report with a date per row to see performance over time.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="zaphiraSalesFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#cd7a97" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#cd7a97" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ec" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d: string) => formatAxisLabel(d, granularity)} tick={{ fontSize: 12 }} />
            <YAxis yAxisId="currency" tick={{ fontSize: 12 }} tickFormatter={(v: number) => `$${v}`} width={56} />
            {showCountAxis && <YAxis yAxisId="count" orientation="right" tick={{ fontSize: 12 }} width={56} />}
            <Tooltip content={<PerformanceTooltip granularity={granularity} />} />
            <Area yAxisId="currency" type="monotone" dataKey="sales" stroke="none" fill="url(#zaphiraSalesFill)" isAnimationActive={false} />
            <Line yAxisId="currency" type="monotone" dataKey="spend" name="PPC Spend" stroke="#3b5bfd" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <Line yAxisId="currency" type="monotone" dataKey="sales" name="Attributed Sales" stroke="#b8577a" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            {showImpressions && (
              <Line yAxisId="count" type="monotone" dataKey="impressions" name="Impressions" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            )}
            {showClicks && (
              <Line yAxisId="count" type="monotone" dataKey="clicks" name="Clicks" stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
