import { useState } from 'react';
import axios from 'axios';
import { Alert, Button, Card, Field, Input, PageHeader, PageLoader, Select, useToast } from '../components/ui';
import { useI18n } from '../context/I18nContext';
import { errMsg, ExportButtons, fmtDate, fmtMoney, label, useLoad } from '../fin/common';
import { invQuery, isTreasurer, useInv } from './InventoryArea';
import { conditionOptions, useCatalog } from './Register';

export function InvReports() {
  const s = useInv();
  const { t } = useI18n();
  const list = useLoad<any[]>('/inventory/reports', []);
  const cats = useCatalog('categories');
  const [key, setKey] = useState(s.departmentId ? 'department-inventory' : 'central-inventory');
  const [f, setF] = useState({ from: '', to: '', categoryId: '', ownership: '', condition: '', status: '' });
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), ...(s.departmentId ? { departmentId: s.departmentId } : {}) } as any).toString();
  const report = useLoad<any>(`/inventory/reports/${key}?${q}`, [key, q]);
  return (
    <div className="space-y-4">
      <PageHeader title={t('inv.nav.reports')} description="Inventory, ownership, movement, borrowing, maintenance, losses, disposals and stock. Departments only ever see their own." actions={report.data ? <ExportButtons url={`/inventory/reports/${key}?${q}`} name={key} /> : undefined} />
      <Card className="card-pad">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Report"><Select value={key} onChange={(e) => setKey(e.target.value)} options={(list.data ?? []).map((r) => ({ value: r.key, label: r.title }))} /></Field>
          <Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          <Field label="Category"><Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} options={[{ value: '', label: 'All' }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} /></Field>
          <Field label="Ownership"><Select value={f.ownership} onChange={(e) => setF({ ...f, ownership: e.target.value })} options={[{ value: '', label: 'All' }, ...['fellowship', 'department', 'donated', 'borrowed'].map((v) => ({ value: v, label: label(v) }))]} /></Field>
          <Field label="Condition"><Select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} options={[{ value: '', label: 'Any' }, ...conditionOptions]} /></Field>
          <Field label="Availability"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: '', label: 'Any' }, ...['available', 'assigned', 'borrowed', 'in_maintenance', 'lost', 'disposed'].map((v) => ({ value: v, label: label(v) }))]} /></Field>
        </div>
      </Card>
      {report.error ? <Alert tone="danger">{report.error}</Alert> : !report.data ? <PageLoader rows={2} /> : (
        <Card className="card-pad space-y-4">
          <div><h2 className="text-lg font-semibold">{report.data.title}</h2><p className="text-sm text-ink-muted">{report.data.subtitle}</p></div>
          {report.data.summary.length > 0 && <div className="grid gap-2 sm:grid-cols-4">{report.data.summary.map((x: any) => <div key={x.label} className="rounded-control bg-surface-sunken px-3 py-2"><p className="text-xs text-ink-subtle">{x.label}</p><p className="font-semibold">{/^\d+\.\d{2}$/.test(x.value) ? fmtMoney(x.value) : x.value}</p></div>)}</div>}
          <div className="overflow-x-auto">
            <table className="table w-full text-sm">
              <thead><tr>{report.data.columns.map((c: any) => <th key={c.key} className={c.money ? 'text-right' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>
                {report.data.rows.length === 0 && <tr><td colSpan={report.data.columns.length} className="text-ink-muted">Nothing matches.</td></tr>}
                {report.data.rows.map((r: any, i: number) => <tr key={i}>{report.data.columns.map((c: any) => <td key={c.key} className={c.money ? 'text-right tabular-nums' : ''}>{c.money ? (r[c.key] ? fmtMoney(r[c.key]) : '') : typeof r[c.key] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r[c.key]) ? fmtDate(r[c.key]) : r[c.key] ?? '—'}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          {(report.data.notes ?? []).map((n: string) => <p key={n} className="text-xs text-ink-subtle">{n}</p>)}
        </Card>
      )}
      <p className="text-xs text-ink-subtle">{invQuery(s) ? 'Showing this department only.' : ''}</p>
    </div>
  );
}

function CatalogEditor({ kind, canEdit }: { kind: 'categories' | 'locations'; canEdit: boolean }) {
  const toast = useToast();
  const list = useCatalog(kind);
  const [name, setName] = useState('');
  return (
    <Card className="card-pad space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{kind === 'categories' ? 'Resource categories' : 'Locations'}</h2>
        {canEdit && kind === 'categories' && <Button size="sm" onClick={async () => { const r = (await axios.post('/inventory/categories/defaults', {}, { withCredentials: true })).data; toast.push('success', `${r.added} suggested categories added`); list.reload(); }}>Add suggested categories</Button>}
      </div>
      {canEdit && <div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'categories' ? 'New category' : 'New location'} /><Button disabled={!name.trim()} onClick={async () => { try { await axios.post(`/inventory/${kind}`, { name }, { withCredentials: true }); setName(''); list.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not add.')); } }}>Add</Button></div>}
      <ul className="grid gap-1 text-sm sm:grid-cols-2">{(list.data ?? []).map((c) => (
        <li key={c.id} className="flex items-center justify-between rounded-control bg-surface-sunken px-2 py-1">
          <span className={c.is_active ? '' : 'text-ink-subtle line-through'}>{c.name}</span>
          {canEdit && <button className="text-xs text-primary hover:underline" onClick={async () => { await axios.put(`/inventory/${kind}/${c.id}`, { isActive: !c.is_active }, { withCredentials: true }); list.reload(); }}>{c.is_active ? 'Deactivate' : 'Activate'}</button>}
        </li>
      ))}</ul>
      <p className="text-xs text-ink-subtle">Deactivating never removes it from existing resources.</p>
    </Card>
  );
}

export function InvSettings() {
  const s = useInv();
  const { t } = useI18n();
  const toast = useToast();
  const settings = useLoad<any>('/inventory/settings', []);
  const [f, setF] = useState<any>(null);
  const canEdit = isTreasurer(s);
  if (!settings.data) return <PageLoader rows={2} />;
  const v = f ?? { tagPrefix: settings.data.tag_prefix, units: settings.data.units.join(', '), maintenanceCategories: settings.data.maintenance_categories.join(', '), majorDisposalValue: settings.data.major_disposal_value ?? '', lowStockNotifications: settings.data.low_stock_notifications, returnReminderDays: settings.data.return_reminder_days };
  return (
    <div className="space-y-4">
      <PageHeader title={t('inv.nav.settings')} description="Managed by the Treasurer, the fellowship's Resource Manager." />
      <Card className="card-pad space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Asset number prefix" hint="e.g. AST → AST-2026-00001"><Input disabled={!canEdit} value={v.tagPrefix} onChange={(e) => setF({ ...v, tagPrefix: e.target.value.toUpperCase() })} /></Field>
          <Field label="Units of measurement"><Input disabled={!canEdit} value={v.units} onChange={(e) => setF({ ...v, units: e.target.value })} /></Field>
          <Field label="Maintenance categories"><Input disabled={!canEdit} value={v.maintenanceCategories} onChange={(e) => setF({ ...v, maintenanceCategories: e.target.value })} /></Field>
          <Field label="Department disposals needing the Secretary and Chairperson from" hint="Value; empty = never"><Input disabled={!canEdit} type="number" value={v.majorDisposalValue} onChange={(e) => setF({ ...v, majorDisposalValue: e.target.value })} /></Field>
          <Field label="Remind about returns (days before)"><Input disabled={!canEdit} type="number" min="0" value={v.returnReminderDays} onChange={(e) => setF({ ...v, returnReminderDays: e.target.value })} /></Field>
          <Field label="Low-stock notifications"><Select disabled={!canEdit} value={v.lowStockNotifications ? 'on' : 'off'} onChange={(e) => setF({ ...v, lowStockNotifications: e.target.value === 'on' })} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} /></Field>
        </div>
        {canEdit && <Button variant="primary" disabled={!f} onClick={async () => { try { await axios.put('/inventory/settings', { tagPrefix: v.tagPrefix, units: String(v.units).split(',').map((x: string) => x.trim()).filter(Boolean), maintenanceCategories: String(v.maintenanceCategories).split(',').map((x: string) => x.trim()).filter(Boolean), majorDisposalValue: v.majorDisposalValue === '' ? null : Number(v.majorDisposalValue), lowStockNotifications: v.lowStockNotifications, returnReminderDays: Number(v.returnReminderDays) }, { withCredentials: true }); toast.push('success', 'Saved'); setF(null); settings.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not save.')); } }}>Save</Button>}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <CatalogEditor kind="categories" canEdit={canEdit} />
        <CatalogEditor kind="locations" canEdit={canEdit} />
      </div>
    </div>
  );
}
