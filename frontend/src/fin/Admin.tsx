import { useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { PlusIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, Textarea, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import { DecisionButtons, errMsg, ExportButtons, fmtDate, fmtMoney, FormModal, label, scopeQuery, Status, Trail, useFin, useLoad } from './common';

// ------------------------------------------------------------------ approvals inbox

export function Approvals() {
  const s = useFin();
  const { t } = useI18n();
  const { data, error, reload } = useLoad<any[]>('/finance/approvals', []);
  const [trail, setTrail] = useState<string | null>(null);
  const mine = (data ?? []).filter((a) => (s.departmentId ? a.departmentId === s.departmentId || a.stageRole?.startsWith('department_') : true));
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageLoader rows={2} />;
  return (
    <div className="space-y-4">
      <PageHeader title={t('fin.nav.approvals')} description="Requests waiting for your decision. You never see your own requests here, and you decide only one stage of any request." />
      {mine.length === 0 ? <EmptyState title="Nothing is waiting for you" description="New requests appear here when it is your turn to review them." /> : (
        <ul className="space-y-3">
          {mine.map((a) => (
            <li key={a.approvalId}>
              <Card className="card-pad">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{a.label} · stage {a.stage + 1} of {a.stages} ({label(a.stageRole)})</p>
                    <p className="mt-1 font-medium text-ink">{a.number ? `${a.number} · ` : ''}{a.title}</p>
                    <p className="text-sm text-ink-muted">
                      {a.amount ? fmtMoney(a.amount, s.currency) : ''}{a.previousAmount ? ` (currently ${fmtMoney(a.previousAmount, s.currency)})` : ''} · submitted {fmtDate(a.submittedAt)}
                    </p>
                    {a.reason && <p className="mt-1 text-sm text-ink">Reason: {a.reason}</p>}
                    {a.changes && <p className="mt-1 text-xs text-ink-muted">Proposed changes: {Object.entries(a.changes).map(([k, v]) => `${k} → ${v}`).join(', ')}</p>}
                    {a.projectId && <Link to={`/projects/${a.projectId}`} className="text-sm text-primary hover:underline">Open the project</Link>}
                    <button className="ml-3 text-sm text-primary hover:underline" onClick={() => setTrail(a.approvalId)}>History</button>
                  </div>
                  <DecisionButtons approvalId={a.approvalId} onDone={reload} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!trail} onClose={() => setTrail(null)} title="Approval history"><Trail approvalId={trail} /></Modal>
    </div>
  );
}

// ------------------------------------------------------------------ financial periods

export function Periods() {
  const s = useFin();
  const { t } = useI18n();
  const toast = useToast();
  const list = useLoad<any[]>('/finance/periods', []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({});
  const [reopen, setReopen] = useState<any>(null);
  const [reason, setReason] = useState('');
  const canManage = s.roles.some((r) => ['treasurer', 'secretary'].includes(r));
  const canReopen = s.roles.some((r) => ['secretary', 'chairperson', 'assistant_chairperson'].includes(r));
  return (
    <div className="space-y-4">
      <PageHeader title={t('fin.nav.periods')} description="A closed period is read-only: nothing dated inside it can be recorded or changed. Closing a financial year needs the Secretary and the Chairperson; reopening needs a reason."
        actions={canManage ? <Button variant="primary" onClick={() => { const y = new Date().getFullYear(); setF({ name: `FY ${y}`, periodType: 'year', startDate: `${y}-01-01`, endDate: `${y}-12-31` }); setOpen(true); }}><PlusIcon className="h-4 w-4" /> New period</Button> : undefined} />
      <DataTable rows={list.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        empty={{ title: 'No financial periods' }}
        columns={[
          { key: 'n', header: 'Period', render: (r: any) => r.name, priority: 'primary' },
          { key: 't', header: 'Type', render: (r: any) => label(r.period_type) },
          { key: 'd', header: 'Dates', render: (r: any) => `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` },
          { key: 's', header: 'Status', render: (r: any) => (r.is_closed ? <Status value="CLOSED" /> : r.closure_status === 'pending' ? <Status value="PENDING_APPROVAL" /> : <Status value="open" />) },
          { key: 'r', header: 'Last reopened', render: (r: any) => (r.reopened_at ? `${fmtDate(r.reopened_at)}: ${r.reopen_reason}` : '—'), priority: 'meta' },
        ]}
        rowActions={(r: any) => (
          <span className="inline-flex gap-1">
            {!r.is_closed && canManage && r.closure_status !== 'pending' && <Button size="sm" variant="ghost" onClick={async () => { try { const x = (await axios.post(`/finance/periods/${r.id}/close`, {}, { withCredentials: true })).data; toast.push('success', x.is_closed ? 'Closed' : 'Sent for closure approval'); list.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not close.')); } }}>{r.period_type === 'year' ? 'Request closure' : 'Close'}</Button>}
            {r.is_closed && canReopen && <Button size="sm" variant="ghost" onClick={() => { setReopen(r); setReason(''); }}>Reopen</Button>}
          </span>
        )} />
      <FormModal open={open} onClose={() => setOpen(false)} title="New financial period"
        onSubmit={async () => { await axios.post('/finance/periods', f, { withCredentials: true }); toast.push('success', 'Period created'); list.reload(); }}>
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type"><Select value={f.periodType} onChange={(e) => setF({ ...f, periodType: e.target.value })} options={['year', 'quarter', 'month', 'custom'].map((v) => ({ value: v, label: label(v) }))} /></Field>
          <Field label="From" required><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="To" required><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
      </FormModal>
      <Modal open={!!reopen} onClose={() => setReopen(null)} title={`Reopen ${reopen?.name ?? ''}`}
        footer={<><Button onClick={() => setReopen(null)}>Cancel</Button><Button variant="danger" disabled={!reason.trim()} onClick={async () => { try { await axios.post(`/finance/periods/${reopen.id}/reopen`, { reason }, { withCredentials: true }); toast.push('success', 'Reopened'); setReopen(null); list.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not reopen.')); } }}>Reopen</Button></>}>
        <Field label="Reason" required hint="Kept in the audit history."><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ reports

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
  const canCategories = s.roles.some((r) => ['treasurer', 'secretary'].includes(r));
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

