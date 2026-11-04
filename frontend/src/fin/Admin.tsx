import { useState } from 'react';
import axios from 'axios';
import { Alert, Button, Card, Field, Input, PageHeader, PageLoader, Select, useToast } from '../components/ui';
import { useI18n } from '../context/I18nContext';
import { errMsg, ExportButtons, fmtDate, fmtMoney, label, scopeQuery, useFin, useLoad } from './common';


export function Reports() {
  const s = useFin();
  const { t } = useI18n();
  const list = useLoad<any[]>('/finance/statements', []);
  const [key, setKey] = useState('income-expenditure');
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const q = `${scopeQuery(s)}&from=${from}${to ? `&to=${to}` : ''}${status ? `&status=${status}` : ''}`;
  const report = useLoad<any>(`/finance/statements/${key}?${q}`, [key, q]);
  const available = (list.data ?? []).filter((r) => !s.departmentId || r.key !== 'departments');
  return (
    <div className="space-y-4">
      <PageHeader title={t('fin.nav.reports')} description="Money received and paid is shown separately from approved spending not yet paid."
        actions={report.data ? <ExportButtons url={`/finance/statements/${key}?${q}`} name={key} /> : undefined} />
      <Card className="card-pad">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Report"><Select value={key} onChange={(e) => setKey(e.target.value)} options={available.map((r) => ({ value: r.key, label: r.title }))} /></Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          {['contributions', 'expenses'].includes(key) && <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)} options={key === 'expenses' ? [{ value: '', label: 'All' }, { value: 'paid', label: 'Paid' }, { value: 'unpaid', label: 'Approved, unpaid' }] : [{ value: '', label: 'Active' }, { value: 'reversed', label: 'Reversed' }, { value: 'all', label: 'All' }]} /></Field>}
        </div>
      </Card>
      {report.error ? <Alert tone="danger">{report.error}</Alert> : !report.data ? <PageLoader rows={2} /> : (
        <Card className="card-pad space-y-4">
          <div><h2 className="text-lg font-semibold text-ink">{report.data.title}</h2><p className="text-sm text-ink-muted">{report.data.subtitle} · {report.data.currency}</p></div>
          {report.data.summary.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-3">{report.data.summary.map((x: any) => <div key={x.label} className="rounded-control bg-surface-sunken px-3 py-2"><p className="text-xs text-ink-subtle">{x.label}</p><p className="font-semibold tabular-nums">{/^-?\d+(\.\d+)?$/.test(x.value) ? fmtMoney(x.value) : x.value}</p></div>)}</div>
          )}
          <div className="overflow-x-auto">
            <table className="table w-full text-sm">
              <thead><tr>{report.data.columns.map((c: any) => <th key={c.key} className={c.money ? 'text-right' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>
                {report.data.rows.length === 0 && <tr><td colSpan={report.data.columns.length} className="text-ink-muted">No records match.</td></tr>}
                {report.data.rows.map((r: any, i: number) => <tr key={i}>{report.data.columns.map((c: any) => <td key={c.key} className={c.money ? 'text-right tabular-nums' : ''}>{c.money ? fmtMoney(r[c.key]) : typeof r[c.key] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r[c.key]) ? fmtDate(r[c.key]) : r[c.key] ?? '—'}</td>)}</tr>)}
                {report.data.totals && <tr className="font-semibold">{report.data.columns.map((c: any, i: number) => <td key={c.key} className={c.money ? 'text-right tabular-nums' : ''}>{report.data.totals[c.key] !== undefined ? fmtMoney(report.data.totals[c.key]) : i === 0 ? 'Total' : ''}</td>)}</tr>}
              </tbody>
            </table>
          </div>
          {(report.data.notes ?? []).map((n: string) => <p key={n} className="text-xs text-ink-subtle">{n}</p>)}
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ settings

export function Settings() {
  const s = useFin();
  const { t } = useI18n();
  const toast = useToast();
  const settings = useLoad<any>('/finance/settings', []);
  const cats = useLoad<any[]>('/finance/categories', []);
  const [f, setF] = useState<any>(null);
  const [cat, setCat] = useState({ kind: 'contribution', name: '' });
  const isTreasurer = s.roles.includes('treasurer');
  const canCategories = isTreasurer;
  if (!settings.data) return <PageLoader rows={2} />;
  const v = f ?? { currency: settings.data.currency, receiptPrefix: settings.data.receipt_prefix, majorExpenseThreshold: settings.data.major_expense_threshold ?? '', budgetWarningPercent: settings.data.budget_warning_percent, financialYearStartMonth: settings.data.financial_year_start_month, paymentMethods: settings.data.payment_methods.join(', ') };
  return (
    <div className="space-y-4">
      <PageHeader title={t('fin.nav.settings')} description="Configuration for the whole fellowship. Deactivating a category never removes past records." />
      <Card className="card-pad space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Currency"><Input disabled={!isTreasurer} value={v.currency} onChange={(e) => setF({ ...v, currency: e.target.value.toUpperCase() })} /></Field>
          <Field label="Receipt prefix" hint="e.g. RCT → RCT-2026-00001"><Input disabled={!isTreasurer} value={v.receiptPrefix} onChange={(e) => setF({ ...v, receiptPrefix: e.target.value.toUpperCase() })} /></Field>
          <Field label="Financial year starts (month 1-12)"><Input disabled={!isTreasurer} type="number" min="1" max="12" value={v.financialYearStartMonth} onChange={(e) => setF({ ...v, financialYearStartMonth: e.target.value })} /></Field>
          <Field label="Department spending needing central approval from" hint="Leave empty for no amount limit."><Input disabled={!isTreasurer} type="number" min="0" value={v.majorExpenseThreshold} onChange={(e) => setF({ ...v, majorExpenseThreshold: e.target.value })} /></Field>
          <Field label="Warn when a budget line is used (%)"><Input disabled={!isTreasurer} type="number" min="1" max="100" value={v.budgetWarningPercent} onChange={(e) => setF({ ...v, budgetWarningPercent: e.target.value })} /></Field>
          <Field label="Payment methods" hint="Comma-separated, e.g. cash, mobile_money"><Input disabled={!isTreasurer} value={v.paymentMethods} onChange={(e) => setF({ ...v, paymentMethods: e.target.value })} /></Field>
        </div>
        {isTreasurer && <Button variant="primary" disabled={!f} onClick={async () => { try { await axios.put('/finance/settings', { currency: v.currency, receiptPrefix: v.receiptPrefix, majorExpenseThreshold: v.majorExpenseThreshold === '' ? null : Number(v.majorExpenseThreshold), budgetWarningPercent: Number(v.budgetWarningPercent), financialYearStartMonth: Number(v.financialYearStartMonth), paymentMethods: String(v.paymentMethods).split(',').map((x: string) => x.trim()).filter(Boolean) }, { withCredentials: true }); toast.push('success', 'Settings saved'); setF(null); settings.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not save.')); } }}>Save settings</Button>}
      </Card>
      <Card className="card-pad space-y-3">
        <h2 className="text-sm font-semibold text-ink">Categories</h2>
        {canCategories && (
          <div className="flex flex-wrap gap-2">
            <Select className="w-44" value={cat.kind} onChange={(e) => setCat({ ...cat, kind: e.target.value })} options={['contribution', 'income', 'expense'].map((k) => ({ value: k, label: label(k) }))} />
            <Input className="max-w-xs" placeholder="New category name" value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} />
            <Button disabled={!cat.name.trim()} onClick={async () => { try { await axios.post('/finance/categories', cat, { withCredentials: true }); setCat({ ...cat, name: '' }); cats.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not add.')); } }}>Add</Button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          {['contribution', 'income', 'expense'].map((k) => (
            <div key={k}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-subtle">{label(k)}</p>
              <ul className="space-y-1 text-sm">{(cats.data ?? []).filter((c) => c.kind === k).map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-control bg-surface-sunken px-2 py-1">
                  <span className={c.is_active ? '' : 'text-ink-subtle line-through'}>{c.name}</span>
                  {canCategories && <button className="text-xs text-primary hover:underline" onClick={async () => { await axios.put(`/finance/categories/${c.id}`, { isActive: !c.is_active }, { withCredentials: true }); cats.reload(); }}>{c.is_active ? 'Deactivate' : 'Activate'}</button>}
                </li>
              ))}</ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

