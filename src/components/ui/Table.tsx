import type { ReactNode } from 'react';

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle">
      <table className="w-full min-w-max text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children }: { children?: ReactNode }) {
  return <th className="whitespace-nowrap border-b border-border-subtle bg-navy-900/[0.03] px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-navy-500">{children}</th>;
}

export function Td({ children, className = '', title }: { children: ReactNode; className?: string; title?: string }) {
  return <td title={title} className={`whitespace-nowrap border-b border-border-subtle px-3 py-2.5 text-navy-800 ${className}`}>{children}</td>;
}
