import type { ReactNode } from 'react';

export function Card({ children, className = '', title, subtitle, actions }: {
  children: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={`rounded-2xl border border-border-subtle bg-surface shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-6 py-4">
          <div>
            {title && <h3 className="text-sm font-semibold text-navy-900">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-navy-500">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
}
