export function NumberField({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-navy-600">{label}</span>
      <div className="flex items-center gap-1">
        <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-28 rounded-lg border border-border-subtle px-3 py-1.5 text-sm" />
        {suffix && <span className="text-xs text-navy-500">{suffix}</span>}
      </div>
    </label>
  );
}
