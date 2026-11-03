import { useState } from 'react';
import axios from 'axios';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Card, ErrorState, Field, Input, PageHeader, PageLoader, Radio, Select, StatCard, StatGrid, Textarea, useToast, Breadcrumb } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../App';
import { useI18n } from '../context/I18nContext';
import { APPROVAL_TYPES, Attachments, errMsg, FinContext, fmtDate, fmtMoney, FormModal, label, PendingApprovals, Row, Status, Trail, useLoad } from './common';
import { useFinanceSettings } from './FinanceArea';

const CENTRAL = ['treasurer', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson'];
const SOURCE_TYPES = ['contributions', 'general_fund', 'grant', 'sponsorship', 'fundraising', 'department', 'other'];

function useLeaderships() {
  return useLoad<any>('/department-workspace/me', []);
}

export function ProjectsList() {
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const settings = useFinanceSettings();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const list = useLoad<any>(`/projects?limit=100${status ? `&status=${status}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`, [status, search]);
  const me = useLeaderships();
  const departments = useLoad<any[]>((user?.roles ?? []).some((r) => ['secretary', 'assistant_secretary'].includes(r)) ? '/departments' : null, []);
  const chairOf = ((me.data?.departments ?? []) as any[]).filter((d) => d.role === 'department_chairperson');
  const canCreate = (user?.roles ?? []).some((r) => CENTRAL.includes(r)) || chairOf.length > 0;
  const deptOptions = (departments.data ?? chairOf.map((d) => ({ id: d.departmentId, name: d.name }))).map((d: any) => ({ value: d.id, label: d.name }));
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({});
  const [sources, setSources] = useState<{ sourceType: string; name: string; expectedAmount: string }[]>([]);
  const currency = settings.data?.currency ?? 'TZS';

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader title={t('fin.nav.projects')} description="Fellowship-wide projects are central finances, even when a department coordinates them. Department projects belong to that department. Every project is approved by the Treasurer, the Fellowship Secretary and the Chairperson before it can receive or spend money."
        actions={canCreate ? <Button variant="primary" onClick={() => { setF({ scope: chairOf.length && !(user?.roles ?? []).some((r) => CENTRAL.includes(r)) ? 'department' : 'fellowship', name: '', purpose: '', description: '', projectType: '', budgetAmount: '', startDate: '', endDate: '', location: '', departmentId: chairOf[0]?.departmentId ?? '', coordinatingDepartmentId: '' }); setSources([]); setOpen(true); }}><PlusIcon className="h-4 w-4" /> New project</Button> : undefined} />
      <PendingApprovals types={APPROVAL_TYPES.projects} onDone={list.reload} />
      <DataTable rows={list.data?.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        search={{ value: search, onChange: setSearch, placeholder: 'Project name' }}
        toolbar={<Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All statuses' }, ...['DRAFT', 'PENDING_APPROVAL', 'RETURNED', 'APPROVED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CLOSED', 'REJECTED'].map((v) => ({ value: v, label: label(v) }))]} />}
        empty={{ title: 'No projects yet' }}
        columns={[
          { key: 'n', header: 'Project', render: (r: any) => <Link to={`/projects/${r.id}`} className="font-medium text-primary hover:underline">{r.project_number} · {r.name}</Link>, priority: 'primary' },
          { key: 's', header: 'Scope', render: (r: any) => (r.scope === 'department' ? 'Department' : 'Fellowship'), priority: 'meta' },
          { key: 'b', header: 'Budget', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.budget_amount, currency) },
          { key: 'f', header: 'Received', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.financials.fundingReceived, currency) },
          { key: 'p', header: 'Funded', render: (r: any) => `${r.financials.fundingProgressPercent}%` },
          { key: 'st', header: 'Status', render: (r: any) => <Status value={r.status} /> },
        ]} />

      <FormModal open={open} onClose={() => setOpen(false)} title="New project" width="lg" submitLabel="Save and submit for approval"
        onSubmit={async () => {
          const r = await axios.post('/projects', { ...f, submit: true, budgetAmount: Number(f.budgetAmount), departmentId: f.scope === 'department' ? f.departmentId : undefined, coordinatingDepartmentId: f.scope === 'fellowship' && f.coordinatingDepartmentId ? f.coordinatingDepartmentId : undefined, startDate: f.startDate || undefined, endDate: f.endDate || undefined, fundingSources: sources.filter((x) => x.name).map((x) => ({ ...x, expectedAmount: Number(x.expectedAmount || 0) })) }, { withCredentials: true });
          toast.push('success', 'Project submitted for approval'); navigate(`/projects/${r.data.id}`);
        }}>
        <div className="flex flex-wrap gap-4">
          <Radio name="scope" label="Fellowship-wide (central money)" checked={f.scope === 'fellowship'} onChange={() => setF({ ...f, scope: 'fellowship' })} disabled={!(user?.roles ?? []).some((r) => CENTRAL.includes(r)) && !chairOf.length} />
          <Radio name="scope" label="A department's own project" checked={f.scope === 'department'} onChange={() => setF({ ...f, scope: 'department' })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Purpose" required className="sm:col-span-2"><Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
          {f.scope === 'department'
            ? <Field label="Department" required><Select value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })} placeholder="Choose" options={deptOptions} /></Field>
            : <Field label="Coordinated by department"><Select value={f.coordinatingDepartmentId} onChange={(e) => setF({ ...f, coordinatingDepartmentId: e.target.value })} placeholder="None" options={deptOptions} /></Field>}
          <Field label={`Budget (${currency})`} required><Input type="number" min="0" step="0.01" value={f.budgetAmount} onChange={(e) => setF({ ...f, budgetAmount: e.target.value })} /></Field>
          <Field label="Type"><Input value={f.projectType} onChange={(e) => setF({ ...f, projectType: e.target.value })} placeholder="e.g. construction, outreach" /></Field>
          <Field label="Location"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="Start"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="End"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
        <Field label="Description"><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div>
          <p className="label">Planned funding sources</p>
          {sources.map((x, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <Select className="w-40" value={x.sourceType} onChange={(e) => setSources(sources.map((y, j) => (j === i ? { ...y, sourceType: e.target.value } : y)))} options={SOURCE_TYPES.map((v) => ({ value: v, label: label(v) }))} />
              <Input placeholder="Name" value={x.name} onChange={(e) => setSources(sources.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <Input className="w-32" type="number" placeholder="Expected" value={x.expectedAmount} onChange={(e) => setSources(sources.map((y, j) => (j === i ? { ...y, expectedAmount: e.target.value } : y)))} />
              <Button type="button" variant="ghost" size="sm" aria-label="Remove" onClick={() => setSources(sources.filter((_, j) => j !== i))}><TrashIcon className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" size="sm" onClick={() => setSources([...sources, { sourceType: 'contributions', name: '', expectedAmount: '' }])}><PlusIcon className="h-4 w-4" /> Add source</Button>
        </div>
      </FormModal>
    </div>
  );
}

export function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const settings = useFinanceSettings();
  const { data: p, error, reload } = useLoad<any>(`/projects/${id}`, [id]);
  const [closing, setClosing] = useState(false);
  const [alloc, setAlloc] = useState(false);
  const [cf, setCf] = useState<any>({ finalReport: '', unspentDisposition: 'return_to_general_fund', carryForwardProjectId: '' });
  const [amount, setAmount] = useState('');
  const others = useLoad<any>(closing ? '/projects?status=ACTIVE&limit=100' : null, [closing]);
  const currency = settings.data?.currency ?? 'TZS';
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!p) return <PageLoader rows={3} />;
  const f = p.financials;
  const isTreasurer = (user?.roles ?? []).includes('treasurer');
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast.push('success', ok); reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not complete that.')); } };
  const scope = { departmentId: p.scope === 'department' ? p.department_id : null, roles: user?.roles ?? [], currency, paymentMethods: settings.data?.payment_methods ?? ['cash'] };

  return (
    <FinContext.Provider value={scope}>
      <div className="mx-auto max-w-7xl space-y-6">
        <Breadcrumb items={[{ label: 'Projects', to: '/projects' }, { label: p.project_number }]} />
        <PageHeader eyebrow={`${p.project_number} · ${p.scope === 'department' ? `${p.department?.name ?? 'Department'} project` : 'Fellowship-wide project'}${p.coordinatingDepartment ? ` · coordinated by ${p.coordinatingDepartment.name}` : ''}`}
          title={p.name} description={p.purpose}
          actions={<span className="flex flex-wrap gap-2">
            <Status value={p.status} />
            {['DRAFT', 'RETURNED'].includes(p.status) && <Button variant="primary" size="sm" onClick={() => act(() => axios.post(`/projects/${id}/submit`, {}, { withCredentials: true }), 'Submitted for approval')}>Submit for approval</Button>}
            {p.status === 'APPROVED' && <Button size="sm" onClick={() => act(() => axios.post(`/projects/${id}/status`, { status: 'ACTIVE' }, { withCredentials: true }), 'Project started')}>Start</Button>}
            {p.status === 'ACTIVE' && <Button size="sm" onClick={() => act(() => axios.post(`/projects/${id}/status`, { status: 'ON_HOLD' }, { withCredentials: true }), 'On hold')}>Put on hold</Button>}
            {p.status === 'ON_HOLD' && <Button size="sm" onClick={() => act(() => axios.post(`/projects/${id}/status`, { status: 'ACTIVE' }, { withCredentials: true }), 'Resumed')}>Resume</Button>}
            {['ACTIVE', 'ON_HOLD'].includes(p.status) && <Button size="sm" onClick={() => act(() => axios.post(`/projects/${id}/status`, { status: 'COMPLETED' }, { withCredentials: true }), 'Marked completed')}>Mark completed</Button>}
            {isTreasurer && p.scope === 'fellowship' && ['APPROVED', 'ACTIVE'].includes(p.status) && <Button size="sm" onClick={() => { setAmount(''); setAlloc(true); }}>Allocate from General Fund</Button>}
            {['ACTIVE', 'COMPLETED', 'ON_HOLD', 'APPROVED'].includes(p.status) && p.closure_status !== 'pending' && <Button size="sm" onClick={() => setClosing(true)}>Close project</Button>}
          </span>} />
        {p.closure_status === 'pending' && <Alert tone="info">Closure is waiting for approval (Treasurer, Fellowship Secretary, Chairperson).</Alert>}
        {p.status === 'RETURNED' && <Alert tone="warning">Returned for changes. See the approval history below, edit the project and submit it again.</Alert>}

        <StatGrid>
          <StatCard label="Approved budget" value={fmtMoney(f.budget, currency)} tone="primary" />
          <StatCard label="Funds received" value={fmtMoney(f.fundingReceived, currency)} hint={`${f.fundingProgressPercent}% of budget`} tone="success" />
          <StatCard label="Paid" value={fmtMoney(f.expensesPaid, currency)} />
          <StatCard label="Approved, not yet paid" value={fmtMoney(f.commitments, currency)} tone={Number(f.commitments) ? 'warning' : 'neutral'} />
          <StatCard label="Budget left" value={fmtMoney(f.remainingBudget, currency)} tone={Number(f.remainingBudget) < 0 ? 'danger' : 'neutral'} />
        </StatGrid>
        <div className="h-3 overflow-hidden rounded bg-surface-sunken" aria-label={`Funding progress ${f.fundingProgressPercent}%`}><div className="h-full bg-success" style={{ width: `${Math.min(100, f.fundingProgressPercent)}%` }} /></div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="card-pad">
            <h2 className="mb-2 text-sm font-semibold">Funding by source</h2>
            <Row k="Contributions allocated" v={fmtMoney(f.contributions, currency)} />
            <Row k="Project income (grants, sponsors)" v={fmtMoney(f.income, currency)} />
            <Row k="General Fund allocations (net)" v={fmtMoney(f.generalFundAllocations, currency)} />
            {p.fundingSources.length > 0 && <>
              <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">Planned</h3>
              {p.fundingSources.map((x: any) => <Row key={x.id} k={`${x.name} (${label(x.source_type)})`} v={`${fmtMoney(x.expected_amount, currency)}${x.actual ? ` · received ${fmtMoney(x.actual)}` : ''}`} />)}
            </>}
          </Card>
          <Card className="card-pad">
            <h2 className="mb-2 text-sm font-semibold">Details</h2>
            <Row k="Coordinator" v={p.coordinator?.full_name} />
            <Row k="Type" v={p.project_type} />
            <Row k="Location" v={p.location} />
            <Row k="Dates" v={p.start_date ? `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}` : null} />
            {p.description && <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{p.description}</p>}
            <div className="mt-2"><Attachments items={p.attachments} /></div>
            {p.final_report && <><h3 className="mt-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">Final report</h3><p className="whitespace-pre-wrap text-sm">{p.final_report}</p></>}
          </Card>
        </div>

        <Card className="card-pad">
          <h2 className="mb-2 text-sm font-semibold">Spending</h2>
          {p.expenses.length === 0 ? <p className="text-sm text-ink-muted">No spending recorded for this project.</p> : (
            <table className="table w-full text-sm"><thead><tr><th>Expense</th><th>Date</th><th>Status</th><th className="text-right">Amount</th><th className="text-right">Paid</th></tr></thead>
              <tbody>{p.expenses.map((e: any) => <tr key={e.id}><td>{e.expense_number} {e.title}</td><td>{fmtDate(e.date)}</td><td><Status value={e.payment_status === 'paid' ? 'paid' : e.approval_status} /></td><td className="text-right">{fmtMoney(e.amount)}</td><td className="text-right">{e.amount_paid ? fmtMoney(e.amount_paid) : '—'}</td></tr>)}</tbody></table>
          )}
        </Card>

        {p.fundAllocations.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="card-pad"><h2 className="mb-2 text-sm font-semibold">Allocations</h2>{p.fundAllocations.map((a: any) => <Row key={a.id} k={`${a.allocation_number} · ${label(a.kind)}`} v={<>{fmtMoney(a.amount)} <Status value={a.status} /></>} />)}</Card>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="card-pad"><h2 className="mb-2 text-sm font-semibold">Approval history</h2><Trail approvalId={p.approval_workflow_id} /></Card>
          {p.closure_workflow_id && <Card className="card-pad"><h2 className="mb-2 text-sm font-semibold">Closure history</h2><Trail approvalId={p.closure_workflow_id} /></Card>}
        </div>

        <FormModal open={alloc} onClose={() => setAlloc(false)} title="Allocate from the General Fund" description="Earmarks central money for this project. It is an internal allocation, not income, and needs the Secretary and the Chairperson."
          onSubmit={async () => { await axios.post(`/projects/${id}/allocations`, { amount: Number(amount) }, { withCredentials: true }); toast.push('success', 'Allocation sent for approval'); reload(); }}>
          <Field label={`Amount (${currency})`} required><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        </FormModal>

        <FormModal open={closing} onClose={() => setClosing(false)} title="Close the project" description={`Unspent money: ${fmtMoney(f.unspentFunds, currency)}. Before closing, every approved payment must be made and nothing may be waiting for approval.`} width="lg" submitLabel="Send for closure approval"
          onSubmit={async () => { await axios.post(`/projects/${id}/closure`, { finalReport: cf.finalReport, unspentDisposition: cf.unspentDisposition, carryForwardProjectId: cf.carryForwardProjectId || undefined }, { withCredentials: true }); toast.push('success', 'Closure sent for approval'); reload(); }}>
          <Field label="Final report" required><Textarea rows={5} value={cf.finalReport} onChange={(e) => setCf({ ...cf, finalReport: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-4">
            <Radio name="disp" label={p.scope === 'department' ? 'Return to the department\'s general funds' : 'Return to the General Fund'} checked={cf.unspentDisposition === 'return_to_general_fund'} onChange={() => setCf({ ...cf, unspentDisposition: 'return_to_general_fund' })} />
            <Radio name="disp" label="Carry forward to another project" checked={cf.unspentDisposition === 'carry_forward'} onChange={() => setCf({ ...cf, unspentDisposition: 'carry_forward' })} />
          </div>
          {cf.unspentDisposition === 'carry_forward' && <Field label="Project" required><Select value={cf.carryForwardProjectId} onChange={(e) => setCf({ ...cf, carryForwardProjectId: e.target.value })} placeholder="Choose" options={(others.data?.data ?? []).filter((x: any) => x.id !== p.id && x.scope === p.scope).map((x: any) => ({ value: x.id, label: `${x.project_number} · ${x.name}` }))} /></Field>}
        </FormModal>
      </div>
    </FinContext.Provider>
  );
}
