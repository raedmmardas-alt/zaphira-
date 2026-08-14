import { useState } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table, Th, Td } from '../components/ui/Table';
import { useAppStore } from '../state/store';
import { useWorkspace } from '../state/useWorkspace';
import { formatCurrency } from '../lib/engine/metrics';
import type { Product, StrategyPosture } from '../types';

function NumberField({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
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

export function Settings() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const products = useAppStore((s) => s.products);
  const addProduct = useAppStore((s) => s.addProduct);
  const updateProduct = useAppStore((s) => s.updateProduct);
  const removeProduct = useAppStore((s) => s.removeProduct);
  const savedAdGroupMappings = useAppStore((s) => s.savedAdGroupMappings);
  const removeSavedMapping = useAppStore((s) => s.removeSavedMapping);
  const setAccountNetProfit = useAppStore((s) => s.setAccountNetProfit);
  const resetAllData = useAppStore((s) => s.resetAllData);
  const ws = useWorkspace();

  const [anpValue, setAnpValue] = useState('');
  const [newProduct, setNewProduct] = useState<Partial<Product>>({ name: '', asin: '', sku: '', sellingPrice: null });

  return (
    <div>
      <PageHeader title="Settings" subtitle="All settings persist locally on this device." />
      <div className="space-y-6 p-8">
        <Card title="Strategy Posture & Bid Guardrails">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy-600">Strategy Posture</span>
              <select
                value={settings.strategyPosture}
                onChange={(e) => updateSettings({ strategyPosture: e.target.value as StrategyPosture })}
                className="w-full rounded-lg border border-border-subtle px-3 py-1.5 text-sm"
              >
                <option value="MAINTENANCE">Maintenance</option>
                <option value="GROWTH">Growth</option>
                <option value="AGGRESSIVE_GROWTH">Aggressive Growth</option>
              </select>
            </label>
            <NumberField label="Target ACoS" value={settings.targetAcosDefault * 100} onChange={(v) => updateSettings({ targetAcosDefault: v / 100 })} suffix="%" />
            <NumberField label="Max Daily PPC Budget" value={settings.maxDailyPpcBudget} onChange={(v) => updateSettings({ maxDailyPpcBudget: v })} suffix="$" />
            <NumberField label="Max Bid Increase" value={settings.maxBidIncreasePct * 100} onChange={(v) => updateSettings({ maxBidIncreasePct: v / 100 })} suffix="%" />
            <NumberField label="Max Bid Reduction" value={settings.maxBidReductionPct * 100} onChange={(v) => updateSettings({ maxBidReductionPct: v / 100 })} suffix="%" />
            <NumberField label="Stop-loss Clicks" value={settings.stopLossClicks} onChange={(v) => updateSettings({ stopLossClicks: v })} />
            <NumberField label="Stop-loss Spend" value={settings.stopLossSpend} onChange={(v) => updateSettings({ stopLossSpend: v })} suffix="$" />
          </div>
        </Card>

        <Card title="Delivery Thresholds">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <NumberField
              label="Low Delivery max impressions"
              value={settings.deliveryThresholds.lowDeliveryMaxImpressions}
              onChange={(v) => updateSettings({ deliveryThresholds: { ...settings.deliveryThresholds, lowDeliveryMaxImpressions: v } })}
            />
            <NumberField
              label="High Delivery min impressions"
              value={settings.deliveryThresholds.highDeliveryMinImpressions}
              onChange={(v) => updateSettings({ deliveryThresholds: { ...settings.deliveryThresholds, highDeliveryMinImpressions: v } })}
            />
            <NumberField
              label="High Delivery min clicks"
              value={settings.deliveryThresholds.highDeliveryMinClicks}
              onChange={(v) => updateSettings({ deliveryThresholds: { ...settings.deliveryThresholds, highDeliveryMinClicks: v } })}
            />
          </div>
        </Card>

        <Card title="Product Mapping">
          <Table>
            <thead><tr><Th>Name</Th><Th>ASIN</Th><Th>SKU</Th><Th>Selling Price</Th><Th>Aliases</Th><Th></Th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <Td><input defaultValue={p.name} onBlur={(e) => updateProduct(p.id, { name: e.target.value })} className="rounded border border-transparent px-1 py-0.5 hover:border-border-subtle focus:border-border-subtle" /></Td>
                  <Td><input defaultValue={p.asin} onBlur={(e) => updateProduct(p.id, { asin: e.target.value })} className="rounded border border-transparent px-1 py-0.5 font-mono text-xs hover:border-border-subtle focus:border-border-subtle" /></Td>
                  <Td><input defaultValue={p.sku} onBlur={(e) => updateProduct(p.id, { sku: e.target.value })} className="rounded border border-transparent px-1 py-0.5 hover:border-border-subtle focus:border-border-subtle" /></Td>
                  <Td><input defaultValue={p.sellingPrice ?? ''} type="number" onBlur={(e) => updateProduct(p.id, { sellingPrice: e.target.value ? Number(e.target.value) : null })} className="w-20 rounded border border-transparent px-1 py-0.5 hover:border-border-subtle focus:border-border-subtle" /></Td>
                  <Td><input defaultValue={p.aliases.join(', ')} onBlur={(e) => updateProduct(p.id, { aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} className="w-40 rounded border border-transparent px-1 py-0.5 text-xs hover:border-border-subtle focus:border-border-subtle" /></Td>
                  <Td><button onClick={() => removeProduct(p.id)} className="text-xs text-negative-600 hover:underline">Remove</button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="block"><span className="mb-1 block text-xs font-medium text-navy-600">Name</span><input value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} className="w-32 rounded-lg border border-border-subtle px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-navy-600">ASIN</span><input value={newProduct.asin} onChange={(e) => setNewProduct({ ...newProduct, asin: e.target.value })} className="w-32 rounded-lg border border-border-subtle px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-navy-600">SKU</span><input value={newProduct.sku} onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })} className="w-32 rounded-lg border border-border-subtle px-2 py-1.5 text-sm" /></label>
            <button
              onClick={() => {
                if (!newProduct.name) return;
                addProduct({ id: crypto.randomUUID(), name: newProduct.name!, asin: newProduct.asin ?? '', sku: newProduct.sku ?? '', sellingPrice: null, aliases: [], campaignAliases: [], adGroupAliases: [] });
                setNewProduct({ name: '', asin: '', sku: '', sellingPrice: null });
              }}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
            >
              Add Product
            </button>
          </div>
        </Card>

        <Card title="Manual Ad-Group Mappings" subtitle="Persisted locally; used in the product mapping hierarchy before name inference.">
          <Table>
            <thead><tr><Th>Campaign</Th><Th>Ad Group</Th><Th>Product</Th><Th></Th></tr></thead>
            <tbody>
              {savedAdGroupMappings.length === 0 && <tr><Td className="text-navy-500">No manual mappings yet — map unmapped keywords on the Keywords page.</Td></tr>}
              {savedAdGroupMappings.map((m) => (
                <tr key={m.id}>
                  <Td className="max-w-[220px] truncate">{m.campaignName}</Td>
                  <Td className="max-w-[220px] truncate">{m.adGroupName ?? <span className="text-navy-400">(whole campaign)</span>}</Td>
                  <Td>{products.find((p) => p.id === m.productId)?.name ?? m.productId}</Td>
                  <Td><button onClick={() => removeSavedMapping(m.id)} className="text-xs text-negative-600 hover:underline">Remove</button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Account Net Profit by Report Period" subtitle="Stored per period — never carried over into a different date range.">
          {ws.currentPeriod ? (
            <div className="flex items-end gap-2">
              <div className="text-sm text-navy-600">Current period: <span className="font-medium text-navy-900">{ws.currentPeriod.start} → {ws.currentPeriod.end}</span></div>
              <label className="ml-4 block">
                <span className="mb-1 block text-xs font-medium text-navy-600">Account Net Profit ($)</span>
                <input value={anpValue} onChange={(e) => setAnpValue(e.target.value)} type="number" className="w-32 rounded-lg border border-border-subtle px-3 py-1.5 text-sm" placeholder={ws.accountNetProfitEntry ? String(ws.accountNetProfitEntry.accountNetProfit) : '—'} />
              </label>
              <button
                onClick={() => { if (ws.currentPeriod && anpValue !== '') { setAccountNetProfit(ws.currentPeriod, Number(anpValue)); setAnpValue(''); } }}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
              >
                Save
              </button>
            </div>
          ) : (
            <p className="text-sm text-navy-500">No current period established yet — import Amazon reports first.</p>
          )}
          {ws.accountNetProfitEntry && <p className="mt-2 text-xs text-navy-500">Currently set to {formatCurrency(ws.accountNetProfitEntry.accountNetProfit)} for this period.</p>}
        </Card>

        <Card title="Data Reset / Export">
          <button
            onClick={() => { if (confirm('This will permanently delete all locally stored reports, settings, mappings, and shadow snapshots. Continue?')) void resetAllData(); }}
            className="rounded-lg border border-negative-600/30 px-4 py-2 text-sm font-medium text-negative-600 hover:bg-negative-50"
          >
            Reset All Local Data
          </button>
          <p className="mt-2 text-xs text-navy-500">This only affects data stored in this browser. No data was ever sent to a remote server, so there is nothing to delete elsewhere.</p>
        </Card>
      </div>
    </div>
  );
}
