import { useState } from 'react';
import axios from 'axios';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Card, Checkbox, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import { errMsg, fmtDate, fmtMoney, FormModal, label, ProjectSelect, Row, scopeQuery, Status, Trail, useFin, useLoad } from './common';

type Line = { id?: string; name: string; amount: string; notes?: string };

function LinesEditor({ value, onChange }: { value: Line[]; onChange: (v: Line[]) => void }) {
  const total = value.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  return (
    <div className="space-y-2">
      <p className="label">Budget lines</p>
      {value.map((l, i) => (
        <div key={i} className="flex gap-2">
          <Input placeholder="e.g. Transport" value={l.name} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <Input className="w-36" type="number" min="0" step="0.01" placeholder="Amount" value={l.amount} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          <Button type="button" variant="ghost" size="sm" aria-label="Remove line" onClick={() => onChange(value.filter((_, j) => j !== i))}><TrashIcon className="h-4 w-4" /></Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button type="button" size="sm" onClick={() => onChange([...value, { name: '', amount: '' }])}><PlusIcon className="h-4 w-4" /> Add line</Button>
        <span className="text-sm font-semibold text-ink">Total {fmtMoney(total)}</span>
      </div>
    </div>
  );
}

const cleanLines = (lines: Line[]) => lines.filter((l) => l.name && l.amount !== '').map((l) => ({ id: l.id, name: l.name, amount: Number(l.amount), notes: l.notes }));

export function Budgets() {
  const s = useFin();
  const { t } = useI18n();
  const [tab, setTab] = useState<'budgets' | 'calls'>('budgets');
  return (
    <div className="space-y-4">
      <PageHeader title={t('fin.nav.budgets')} description={s.departmentId ? 'The department\'s budgets. They are reviewed by the Treasurer, then the Fellowship Secretary, and approved by the Fellowship Chairperson.' : 'Budgets are approved before money is charged to them. Revisions need a reason and approval; the old version is kept.'} />
      <Tabs tabs={[{ key: 'budgets', label: 'Budgets' }, { key: 'calls', label: 'Budget submissions' }]} active={tab} onChange={setTab} />
      {tab === 'budgets' ? <BudgetList /> : <BudgetCalls />}
    </div>
  );
}

function BudgetList() {
  const s = useFin();
  const toast = useToast();
  const list = useLoad<any[]>(`/finance/budgets?${scopeQuery(s)}&limit=200`, [s.departmentId]);
  const calls = useLoad<any[]>(s.departmentId ? '/finance/budget-calls' : null, []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [view, setView] = useState<string | null>(null);
  const detail = useLoad<any>(view ? `/finance/budgets/${view}` : null, [view]);
  const [revise, setRevise] = useState(false);
  const [rl, setRl] = useState<Line[]>([]);
  const [reason, setReason] = useState('');
  const canPrepare = s.departmentId ? !!s.leaderRole : s.roles.some((r) => ['treasurer', 'secretary'].includes(r));

  return (
    <>
      <div className="flex justify-end">{canPrepare && <Button variant="primary" onClick={() => { setF({ title: '', fiscalYear: String(new Date().getFullYear()), budgetType: s.departmentId ? 'department' : 'annual', projectId: '', budgetCallId: '', description: '' }); setLines([{ name: '', amount: '' }]); setOpen(true); }}><PlusIcon className="h-4 w-4" /> New budget</Button>}</div>
      <DataTable rows={list.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id} clientPaging pageSize={25}
        empty={{ title: 'No budgets yet' }}
        columns={[
          { key: 'n', header: 'Budget', render: (r: any) => <button className="font-medium text-primary hover:underline" onClick={() => setView(r.id)}>{r.budget_number ?? '—'} · {r.title}</button>, priority: 'primary' },
          { key: 'y', header: 'Year', render: (r: any) => r.fiscal_year },
          { key: 't', header: 'Type', render: (r: any) => label(r.budget_type), priority: 'meta' },
          { key: 'a', header: 'Amount', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.amount, s.currency) },
          { key: 'v', header: 'Version', render: (r: any) => r.version ?? 1, priority: 'meta' },
          { key: 's', header: 'Status', render: (r: any) => <Status value={r.approval_status} /> },
        ]} />

      <FormModal open={open} onClose={() => setOpen(false)} title="New budget" width="lg"
        onSubmit={async () => {
          await axios.post('/finance/budgets', { departmentId: s.departmentId ?? undefined, title: f.title, fiscalYear: f.fiscalYear, budgetType: f.budgetType, projectId: f.projectId || undefined, budgetCallId: f.budgetCallId || undefined, description: f.description || undefined, lines: cleanLines(lines) }, { withCredentials: true });
          toast.push('success', 'Budget submitted for approval'); list.reload();
        }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Financial year" required hint="e.g. 2026 or 2026-27"><Input value={f.fiscalYear} onChange={(e) => setF({ ...f, fiscalYear: e.target.value })} /></Field>
          <Field label="Type"><Select value={f.budgetType} onChange={(e) => setF({ ...f, budgetType: e.target.value })} options={['annual', 'department', 'project', 'activity', 'fundraising'].map((v) => ({ value: v, label: label(v) }))} /></Field>
          {f.budgetType === 'project' && <Field label="Project"><ProjectSelect value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} /></Field>}
          {s.departmentId && <Field label="In answer to"><Select value={f.budgetCallId} onChange={(e) => setF({ ...f, budgetCallId: e.target.value })} placeholder="No budget call" options={(calls.data ?? []).filter((c) => c.status === 'open').map((c) => ({ value: c.id, label: `${c.title} (due ${fmtDate(c.deadline)})` }))} /></Field>}
        </div>
        <LinesEditor value={lines} onChange={setLines} />
        <Field label="Notes"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </FormModal>

      <Modal open={!!view} onClose={() => { setView(null); setRevise(false); }} title={detail.data ? `${detail.data.budget_number ?? ''} ${detail.data.title}` : 'Budget'} width="lg"
        footer={detail.data?.approval_status === 'FINAL_APPROVED' && canPrepare && !revise ? <Button onClick={() => { setRl(detail.data.lines.filter((l: any) => l.isActive).map((l: any) => ({ id: l.id, name: l.name, amount: l.approved }))); setReason(''); setRevise(true); }}>Propose a revision</Button> : undefined}>
        {detail.error && <Alert tone="danger">{detail.error}</Alert>}
        {detail.data && !revise && (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-4">
              {[['Approved', detail.data.position.approved], ['Spent', detail.data.position.spent], ['Committed', detail.data.position.committed], ['Remaining', detail.data.position.remaining]].map(([k, v]) => (
                <Card key={k} className="card-pad"><p className="text-xs text-ink-subtle">{k}</p><p className="font-semibold tabular-nums">{fmtMoney(v)}</p></Card>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="table w-full text-sm">
                <thead><tr><th>Line</th><th className="text-right">Approved</th><th className="text-right">Spent</th><th className="text-right">Committed</th><th className="text-right">Left</th><th>Used</th></tr></thead>
                <tbody>
                  {detail.data.lines.map((l: any) => (
                    <tr key={l.id} className={l.isActive ? '' : 'opacity-60'}>
                      <td>{l.name}{!l.isActive && ' (removed)'}</td>
                      <td className="text-right tabular-nums">{fmtMoney(l.approved)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(l.spent)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(l.committed)}</td>
                      <td className={`text-right tabular-nums ${l.overspent ? 'text-danger' : ''}`}>{fmtMoney(l.remaining)}</td>
                      <td><span className={l.overspent ? 'text-danger' : l.warning ? 'text-warning' : 'text-ink-muted'}>{l.utilisationPercent}%</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Row k="Status" v={<Status value={detail.data.approval_status} />} />
            <Row k="Version" v={detail.data.version} />
            {detail.data.revisions.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Revisions</h3>
                <ul className="space-y-2 text-sm">{detail.data.revisions.map((r: any) => <li key={r.id} className="rounded-control bg-surface-sunken px-3 py-2"><Status value={r.status} /> v{r.from_version} → {fmtMoney(r.proposed_amount)} <span className="text-ink-muted">· {r.reason}</span>{r.previous_amount && <span className="text-ink-subtle"> (was {fmtMoney(r.previous_amount)})</span>}</li>)}</ul>
              </div>
            )}
            <div><h3 className="mb-2 text-sm font-semibold">Approval history</h3><Trail approvalId={detail.data.workflow?.id ?? detail.data.approval_workflow_id} /></div>
          </div>
        )}
        {revise && (
          <div className="space-y-4">
            <Alert tone="info">The current version stays in force until the revision is approved by the Treasurer, the Fellowship Secretary and the Chairperson.</Alert>
            <LinesEditor value={rl} onChange={setRl} />
            <Field label="Reason for the revision" required><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setRevise(false)}>Back</Button>
              <Button variant="primary" disabled={!reason.trim()} onClick={async () => { try { await axios.post(`/finance/budgets/${view}/revisions`, { reason, lines: cleanLines(rl) }, { withCredentials: true }); toast.push('success', 'Revision sent for approval'); setRevise(false); detail.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not propose the revision.')); } }}>Send for approval</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function BudgetCalls() {
  const s = useFin();
  const toast = useToast();
  const calls = useLoad<any[]>('/finance/budget-calls', []);
  const departments = useLoad<any[]>(!s.departmentId ? '/departments' : null, []);
  const isSecretary = !s.departmentId && s.roles.some((r) => ['secretary', 'assistant_secretary'].includes(r));
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({});
  const [statusFor, setStatusFor] = useState<string | null>(null);
  const status = useLoad<any>(statusFor ? `/finance/budget-calls/${statusFor}/status` : null, [statusFor]);
  const y = new Date().getFullYear() + 1;
  return (
    <>
      <div className="flex justify-end">{isSecretary && <Button variant="primary" onClick={() => { setF({ title: `${y} department budgets`, fiscalYear: String(y), periodStart: `${y}-01-01`, periodEnd: `${y}-12-31`, deadline: '', instructions: '', allDepartments: true, departmentIds: [] }); setOpen(true); }}><PlusIcon className="h-4 w-4" /> Ask departments for budgets</Button>}</div>
      <DataTable rows={calls.data} loading={calls.loading && !calls.data} error={calls.error || null} onRetry={calls.reload} rowKey={(r: any) => r.id}
        empty={{ title: 'No budget submissions requested', description: s.departmentId ? 'The Fellowship Secretary will tell you when budgets are due.' : undefined }}
        columns={[
          { key: 't', header: 'Request', render: (r: any) => r.title, priority: 'primary' },
          { key: 'y', header: 'Year', render: (r: any) => r.fiscal_year },
          { key: 'd', header: 'Deadline', render: (r: any) => fmtDate(r.deadline) },
          { key: 'i', header: 'Instructions', render: (r: any) => <span className="line-clamp-2">{r.instructions ?? '—'}</span>, priority: 'meta' },
          { key: 's', header: 'Status', render: (r: any) => <Status value={r.status} /> },
        ]}
        rowActions={(r: any) => (!s.departmentId ? (
          <span className="inline-flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setStatusFor(r.id)}>Who has submitted</Button>
            {isSecretary && r.status === 'open' && <Button size="sm" variant="ghost" onClick={async () => { try { await axios.post(`/finance/budget-calls/${r.id}/close`, {}, { withCredentials: true }); calls.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not close.')); } }}>Close</Button>}
          </span>
        ) : null)} />

      <FormModal open={open} onClose={() => setOpen(false)} title="Ask departments for budgets" width="lg"
        onSubmit={async () => { await axios.post('/finance/budget-calls', f, { withCredentials: true }); toast.push('success', 'Departments notified'); calls.reload(); }}>
        <Field label="Title" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Financial year" required><Input value={f.fiscalYear} onChange={(e) => setF({ ...f, fiscalYear: e.target.value })} /></Field>
          <Field label="Submission deadline" required><Input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
          <Field label="Budget period from" required><Input type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></Field>
          <Field label="to" required><Input type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></Field>
        </div>
        <Field label="What to include"><Textarea rows={3} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
        <Checkbox label="All active departments" checked={f.allDepartments} onChange={(e) => setF({ ...f, allDepartments: e.target.checked })} />
        {!f.allDepartments && (
          <div className="grid gap-1 sm:grid-cols-2">
            {(departments.data ?? []).map((d: any) => (
              <Checkbox key={d.id} label={d.name} checked={f.departmentIds.includes(d.id)} onChange={(e) => setF({ ...f, departmentIds: e.target.checked ? [...f.departmentIds, d.id] : f.departmentIds.filter((x: string) => x !== d.id) })} />
            ))}
          </div>
        )}
      </FormModal>

      <Modal open={!!statusFor} onClose={() => setStatusFor(null)} title={status.data?.call.title ?? 'Submissions'} width="lg">
        {status.data && (
          <table className="table w-full text-sm">
            <thead><tr><th>Department</th><th>Budget</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{status.data.departments.map((d: any) => <tr key={d.departmentId}><td>{d.name}</td><td>{d.number ?? '—'}</td><td><Status value={d.status === 'NOT_SUBMITTED' ? (d.late ? 'overdue' : 'pending') : d.status} />{d.late && d.submitted ? ' late' : ''}</td><td className="text-right">{d.amount ? fmtMoney(d.amount) : '—'}</td></tr>)}</tbody>
          </table>
        )}
      </Modal>
    </>
  );
}
