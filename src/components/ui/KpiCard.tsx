export function KpiCard({ label, value, sublabel, tone = 'neutral' }: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'neutral' | 'positive' | 'negative';
}) {
  const valueColor = tone === 'positive' ? 'text-positive-600' : tone === 'negative' ? 'text-negative-600' : 'text-navy-900';
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-navy-500">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${valueColor}`}>{value}</div>
      {sublabel && <div className="mt-1 text-xs text-navy-500">{sublabel}</div>}
    </div>
  );
}
