import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { useAppStore } from './state/store';
import { Home } from './pages/Home';
import { Optimize } from './pages/Optimize';
import { KeywordFinder } from './pages/KeywordFinder';
import { UploadData } from './pages/UploadData';
import { Advanced } from './pages/Advanced';
import { Dashboard } from './pages/Dashboard';
import { DecisionCenter } from './pages/DecisionCenter';
import { Campaigns } from './pages/Campaigns';
import { Keywords } from './pages/Keywords';
import { SearchTerms } from './pages/SearchTerms';
import { ProfitCapital } from './pages/ProfitCapital';
import { ShadowMode } from './pages/ShadowMode';
import { Settings } from './pages/Settings';

export default function App() {
  const hydrate = useAppStore((s) => s.hydrate);
  const hydrated = useAppStore((s) => s.hydrated);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!hydrated) {
    return <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-navy-500">Loading local data…</div>;
  }

  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/optimize" element={<Optimize />} />
          <Route path="/keyword-finder" element={<KeywordFinder />} />
          <Route path="/upload-data" element={<UploadData />} />
          <Route path="/advanced" element={<Advanced />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/decision-center" element={<DecisionCenter />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/keywords" element={<Keywords />} />
          <Route path="/search-terms" element={<SearchTerms />} />
          <Route path="/profit-capital" element={<ProfitCapital />} />
          <Route path="/shadow-mode" element={<ShadowMode />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
