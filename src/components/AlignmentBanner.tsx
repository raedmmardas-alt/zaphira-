import type { AlignmentResult } from '../lib/parse/periodEngine';

const STATUS_STYLE: Record<AlignmentResult['status'], { label: string; className: string }> = {
  REPORT_PERIODS_ALIGNED: { label: 'REPORT PERIODS ALIGNED', className: 'border-positive-600/20 bg-positive-50 text-positive-600' },
  AUTO_ALIGNED_HIGH_CONFIDENCE: { label: 'AUTO-ALIGNED — HIGH CONFIDENCE', className: 'border-positive-600/20 bg-positive-50 text-positive-600' },
  CONFIRM_PERIOD: { label: 'CONFIRM PERIOD', className: 'border-watch-600/20 bg-watch-50 text-watch-600' },
  POSSIBLE_DATE_MISMATCH: { label: 'POSSIBLE DATE MISMATCH', className: 'border-watch-600/20 bg-watch-50 text-watch-600' },
  OLD_FILE_WARNING: { label: 'OLD FILE WARNING', className: 'border-watch-600/20 bg-watch-50 text-watch-600' },
  REPORT_SET_MISMATCH: { label: 'REPORT SET MISMATCH', className: 'border-negative-600/20 bg-negative-50 text-negative-600' },
};

export function AlignmentBanner({ alignment }: { alignment: AlignmentResult }) {
  const style = STATUS_STYLE[alignment.status];
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${style.className}`}>
      <div className="font-semibold tracking-wide">{style.label}</div>
      <div className="mt-0.5 text-[13px] opacity-90">{alignment.message}</div>
      {alignment.effectivePeriod && (
        <div className="mt-1 text-[13px] font-medium opacity-90">
          Period: {alignment.effectivePeriod.start} → {alignment.effectivePeriod.end}
        </div>
      )}
    </div>
  );
}
