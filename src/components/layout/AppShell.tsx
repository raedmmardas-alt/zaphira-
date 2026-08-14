import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/keywords', label: 'Keywords' },
  { to: '/search-terms', label: 'Search Terms' },
  { to: '/profit-capital', label: 'Profit & Capital' },
  { to: '/shadow-mode', label: 'Shadow Mode' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border-subtle bg-surface">
        <div className="px-6 py-6">
          <div className="text-lg font-semibold tracking-tight text-navy-900">Zaphira</div>
          <div className="text-xs font-medium tracking-widest text-brand-600">PPC CONTROL</div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-600/10 text-brand-700' : 'text-navy-600 hover:bg-navy-900/5 hover:text-navy-900'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-border-subtle px-4 py-4 text-xs text-navy-500">
          <div className="rounded-lg bg-navy-900/5 px-3 py-2 font-medium">BROWSER-ONLY ANALYSIS</div>
          <div className="rounded-lg border border-positive-600/20 bg-positive-50 px-3 py-2 text-positive-600">
            <div className="font-semibold">GUARDRAIL ACTIVE</div>
            <div className="mt-0.5 text-[11px] leading-snug text-positive-600/90">
              Zaphira never changes Amazon campaigns automatically.
            </div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
