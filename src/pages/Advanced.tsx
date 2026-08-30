import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { ChevronRightIcon } from '../components/ui/Icons';

interface AdvancedLink {
  to: string;
  title: string;
  description: string;
}

const SECTIONS: { heading: string; links: AdvancedLink[] }[] = [
  {
    heading: 'Data & Diagnostics',
    links: [
      { to: '/dashboard', title: 'Full Technical Dashboard', description: 'Business overview, product performance, PPC health, report coverage, data reconciliation, and period validation — the complete diagnostic view, including Advertised Product report coverage and mapping.' },
      { to: '/upload-data', title: 'Report Uploads', description: 'Upload, replace, or remove Amazon and Sellerboard reports, and confirm reporting periods.' },
    ],
  },
  {
    heading: 'Campaign Detail',
    links: [
      { to: '/campaigns', title: 'Campaign Details', description: 'Every campaign with status confidence, full performance metrics, and recommendation text.' },
      { to: '/keywords', title: 'Keyword Details', description: 'Every current-period keyword/target with delivery, mapping, and pause workflow controls.' },
      { to: '/search-terms', title: 'Search Terms', description: 'Customer search term intelligence and keyword opportunities, historical vs. current.' },
      { to: '/decision-center', title: 'Decision Center', description: 'The full technical recommendation view — evidence, prediction ranges, variant intelligence, and shadow-snapshot tools.' },
    ],
  },
  {
    heading: 'Financials',
    links: [
      { to: '/profit-capital', title: 'Profit & Capital', description: 'Account-level profit, TACoS, margin, and product economics scenario planning.' },
    ],
  },
  {
    heading: 'System',
    links: [
      { to: '/shadow-mode', title: 'Shadow Mode', description: 'Track recommendations you applied manually in Seller Central and evaluate their outcomes.' },
      { to: '/settings', title: 'Settings', description: 'Strategy posture, bid guardrails, delivery thresholds, product mapping, and local data management.' },
    ],
  },
];

export function Advanced() {
  return (
    <div>
      <PageHeader title="Advanced" subtitle="Technical and analyst tools. Day-to-day PPC work lives on Home, Optimize, Keyword Finder, and Upload Data." />
      <div className="space-y-8 p-8">
        {SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2 className="mb-3 text-sm font-semibold text-navy-700">{section.heading}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {section.links.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm transition-colors hover:border-brand-600/40"
                >
                  <div>
                    <div className="text-sm font-semibold text-navy-900">{link.title}</div>
                    <div className="mt-1 text-xs text-navy-500">{link.description}</div>
                  </div>
                  <ChevronRightIcon className="mt-0.5 shrink-0 text-navy-300" width={16} height={16} />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
