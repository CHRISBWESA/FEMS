import { useState } from 'react';
import axios from 'axios';
import { PlusIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Card, Checkbox, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import { errMsg, fmtDate, fmtMoney, FormModal, label, scopeQuery, Status, today, useFin, useLoad } from './common';

export function Accounts() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'accounts' | 'transfers' | 'ledger'>('accounts');
  return (
    <div className="space-y-4">
      <PageHeader title={t('fin.nav.accounts')} description="Cash, bank and mobile money accounts. A balance changes only through recorded transactions; mistakes are corrected with reversals or reconciliation adjustments." />
      <Tabs tabs={[{ key: 'accounts', label: 'Accounts' }, { key: 'transfers', label: 'Transfers' }, { key: 'ledger', label: 'All transactions' }]} active={tab} onChange={setTab} />
      {tab === 'accounts' ? <AccountList /> : tab === 'transfers' ? <Transfers /> : <Ledger />}
    </div>
  );
}

function AccountList() {
  const s = useFin();
  const toast = useToast();
  const list = useLoad<any[]>(`/finance/accounts?${scopeQuery(s)}&includeInactive=true`, [s.departmentId]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({});
  const [view, setView] = useState<any>(null);
  const entries = useLoad<any>(view ? `/finance/accounts/${view.id}/entries?limit=100` : null, [view?.id]);
  const recs = useLoad<any[]>(view ? `/finance/accounts/${view.id}/reconciliations` : null, [view?.id]);
  const [rec, setRec] = useState<any>(null);
  const canManage = s.departmentId ? s.leaderRole === 'department_chairperson' : s.roles.includes('treasurer');
  const total = (list.data ?? []).filter((a) => a.is_active).reduce((x, a) => x + Number(a.balance), 0);

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">Total in active accounts: <span className="font-semibold text-ink">{fmtMoney(total, s.currency)}</span></p>
        {canManage && <Button variant="primary" onClick={() => { setF({ name: '', accountType: 'cash', reference: '', openingBalance: '', openingDate: today(), description: '' }); setOpen(true); }}><PlusIcon className="h-4 w-4" /> New account</Button>}
      </div>
      <DataTable rows={list.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        empty={{ title: 'No accounts yet', description: 'A "Cash in hand" account is created automatically with the first transaction.' }}
        columns={[
          { key: 'n', header: 'Account', render: (r: any) => <button className="font-medium text-primary hover:underline" onClick={() => setView(r)}>{r.name}</button>, priority: 'primary' },
          { key: 't', header: 'Type', render: (r: any) => label(r.account_type) },
          { key: 'd', header: 'Owner', render: (r: any) => r.department?.name ?? 'Central', priority: 'meta' },
          { key: 'r', header: 'Reference', render: (r: any) => r.reference ?? '—', priority: 'meta' },
          { key: 'rc', header: 'Reconciled', render: (r: any) => fmtDate(r.last_reconciled_at), priority: 'meta' },
          { key: 'b', header: 'Balance', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.balance, r.currency) },
          { key: 's', header: 'Status', render: (r: any) => <Status value={r.is_active ? 'active' : 'closed'} /> },
        ]} />

      <FormModal open={open} onClose={() => setOpen(false)} title="New account"
        onSubmit={async () => { await axios.post('/finance/accounts', { ...f, departmentId: s.departmentId ?? undefined, openingBalance: f.openingBalance === '' ? undefined : Number(f.openingBalance) }, { withCredentials: true }); toast.push('success', 'Account opened'); list.reload(); }}>
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. NMB savings" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type"><Select value={f.accountType} onChange={(e) => setF({ ...f, accountType: e.target.value })} options={['cash', 'bank', 'mobile_money', 'other'].map((v) => ({ value: v, label: label(v) }))} /></Field>
          <Field label="Account number / phone"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label={`Opening balance (${s.currency})`} hint="Money already held when the account is added."><Input type="number" min="0" step="0.01" value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} /></Field>
          <Field label="As of"><Input type="date" value={f.openingDate} onChange={(e) => setF({ ...f, openingDate: e.target.value })} /></Field>
        </div>
      </FormModal>

      <Modal open={!!view} onClose={() => setView(null)} title={view?.name ?? ''} width="lg"
        footer={view && canManage ? (
          <span className="flex gap-2">
            <Button onClick={() => setRec({ statementDate: today(), statementBalance: view.balance, notes: '', postAdjustment: false, reason: '' })}>Reconcile</Button>
            <Button variant="danger-quiet" onClick={async () => { try { await axios.put(`/finance/accounts/${view.id}`, { isActive: !view.is_active }, { withCredentials: true }); toast.push('success', view.is_active ? 'Account deactivated' : 'Account reactivated'); setView(null); list.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not change the account.')); } }}>{view.is_active ? 'Deactivate' : 'Reactivate'}</Button>
          </span>
        ) : undefined}>
        {view && (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <Card className="card-pad"><p className="text-xs text-ink-subtle">Balance</p><p className="font-semibold">{fmtMoney(view.balance, view.currency)}</p></Card>
              <Card className="card-pad"><p className="text-xs text-ink-subtle">Opening balance</p><p className="font-semibold">{fmtMoney(view.opening_balance, view.currency)}</p></Card>
              <Card className="card-pad"><p className="text-xs text-ink-subtle">Last reconciled</p><p className="font-semibold">{fmtDate(view.last_reconciled_at)}</p></Card>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Transactions</h3>
              {entries.data?.data?.length ? (
                <div className="max-h-80 overflow-auto">
                  <table className="table w-full text-sm">
                    <thead><tr><th>Date</th><th>What</th><th className="text-right">Amount</th><th className="text-right">Balance</th></tr></thead>
                    <tbody>{entries.data.data.map((e: any) => <tr key={e.id}><td>{fmtDate(e.entry_date)}</td><td>{e.description ?? label(e.entry_type)} <span className="text-xs text-ink-subtle">{e.reference}</span></td><td className={`text-right tabular-nums ${Number(e.amount) < 0 ? 'text-danger' : 'text-success'}`}>{fmtMoney(e.amount)}</td><td className="text-right tabular-nums">{fmtMoney(e.balance_after)}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-ink-muted">No transactions yet.</p>}
            </div>
            {recs.data?.length ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Reconciliations</h3>
                <ul className="text-sm">{recs.data.map((r) => <li key={r.id} className="flex justify-between border-b border-hairline py-1"><span>{fmtDate(r.statement_date)} · statement {fmtMoney(r.statement_balance)}</span><span className={Number(r.difference) === 0 ? 'text-success' : 'text-warning'}>difference {fmtMoney(r.difference)}{r.adjustment_entry_id ? ' (adjusted)' : ''}</span></li>)}</ul>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <FormModal open={!!rec} onClose={() => setRec(null)} title={`Reconcile ${view?.name ?? ''}`} description="Compare FEMS with the bank or cash statement. A difference can be posted as an adjustment, with a reason; nothing else changes."
        onSubmit={async () => { const r = await axios.post(`/finance/accounts/${view.id}/reconcile`, { ...rec, statementBalance: Number(rec.statementBalance) }, { withCredentials: true }); toast.push('success', Number(r.data.difference) === 0 ? 'Balanced' : `Difference ${fmtMoney(r.data.difference)}${r.data.adjustment_entry_id ? ' adjusted' : ' recorded'}`); setView(null); list.reload(); }}>
        {rec && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Statement date" required><Input type="date" value={rec.statementDate} onChange={(e) => setRec({ ...rec, statementDate: e.target.value })} /></Field>
              <Field label={`Statement balance (${s.currency})`} required><Input type="number" step="0.01" value={rec.statementBalance} onChange={(e) => setRec({ ...rec, statementBalance: e.target.value })} /></Field>
            </div>
            <p className="text-sm text-ink-muted">FEMS balance: {fmtMoney(view?.balance, s.currency)} · difference {fmtMoney(Number(rec.statementBalance || 0) - Number(view?.balance ?? 0))}</p>
            <Checkbox label="Post an adjustment for the difference" checked={rec.postAdjustment} onChange={(e) => setRec({ ...rec, postAdjustment: e.target.checked })} />
            {rec.postAdjustment && <Field label="Reason" required><Input value={rec.reason} onChange={(e) => setRec({ ...rec, reason: e.target.value })} placeholder="e.g. bank charges" /></Field>}
            <Field label="Notes"><Textarea rows={2} value={rec.notes} onChange={(e) => setRec({ ...rec, notes: e.target.value })} /></Field>
          </>
        )}
      </FormModal>
    </>
  );
}

function Transfers() {
  const s = useFin();
  const toast = useToast();
  const list = useLoad<any>(`/finance/transfers?limit=100${s.departmentId ? `&departmentId=${s.departmentId}` : ''}`, [s.departmentId]);
  const mine = useLoad<any[]>(`/finance/accounts?${scopeQuery(s)}`, [s.departmentId]);
  const all = useLoad<any[]>(!s.departmentId && s.roles.includes('treasurer') ? '/finance/accounts' : null, []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({});
  const destinations = s.departmentId ? mine.data ?? [] : all.data ?? mine.data ?? [];
  const canMove = s.departmentId ? !!s.leaderRole : s.roles.includes('treasurer');
  return (
    <>
      <div className="flex justify-end">{canMove && <Button variant="primary" onClick={() => { setF({ fromAccountId: '', toAccountId: '', amount: '', date: today(), reference: '', description: '' }); setOpen(true); }}><ArrowsRightLeftIcon className="h-4 w-4" /> Move money</Button>}</div>
      <DataTable rows={list.data?.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        empty={{ title: 'No transfers' }}
        columns={[
          { key: 'n', header: 'Transfer', render: (r: any) => r.transfer_number, priority: 'primary' },
          { key: 'd', header: 'Date', render: (r: any) => fmtDate(r.transfer_date) },
          { key: 'f', header: 'From', render: (r: any) => r.fromAccount.name },
          { key: 't', header: 'To', render: (r: any) => r.toAccount.name },
          { key: 'a', header: 'Amount', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.amount, s.currency) },
          { key: 's', header: 'Status', render: (r: any) => <Status value={r.status} /> },
        ]}
        rowActions={(r: any) => (r.status === 'PENDING' ? <Button size="sm" variant="ghost" onClick={async () => { try { await axios.post(`/finance/transfers/${r.id}/cancel`, {}, { withCredentials: true }); list.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not cancel.')); } }}>Cancel</Button> : null)} />
      <FormModal open={open} onClose={() => setOpen(false)} title="Move money between accounts" description="Between two accounts of the same fund the move is immediate. Between central and department funds it needs the Fellowship Secretary and Chairperson. A transfer is never income or expense."
        onSubmit={async () => { const r = await axios.post('/finance/transfers', { ...f, amount: Number(f.amount) }, { withCredentials: true }); toast.push('success', r.data.status === 'PENDING' ? 'Sent for approval' : 'Moved'); list.reload(); }}>
        <Field label="From" required><Select value={f.fromAccountId} onChange={(e) => setF({ ...f, fromAccountId: e.target.value })} placeholder="Choose" options={(mine.data ?? []).map((a) => ({ value: a.id, label: `${a.name} · ${fmtMoney(a.balance)}` }))} /></Field>
        <Field label="To" required><Select value={f.toAccountId} onChange={(e) => setF({ ...f, toAccountId: e.target.value })} placeholder="Choose" options={destinations.filter((a: any) => a.id !== f.fromAccountId).map((a: any) => ({ value: a.id, label: `${a.name}${a.department ? ` (${a.department.name})` : ''}` }))} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Amount (${s.currency})`} required><Input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
        <Field label="Why"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </FormModal>
    </>
  );
}

function Ledger() {
  const s = useFin();
  const [page, setPage] = useState(1);
  const list = useLoad<any>(`/finance/ledger?${scopeQuery(s)}&page=${page}&limit=50`, [s.departmentId, page]);
  return (
    <>
      <Alert tone="info">Every movement of money, in order. Entries are never edited; a correction appears as a reversal or adjustment.</Alert>
      <DataTable rows={list.data?.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        total={list.data?.total} page={page} pageSize={50} onPageChange={setPage}
        empty={{ title: 'No transactions yet' }}
        columns={[
          { key: 'd', header: 'Date', render: (r: any) => fmtDate(r.entry_date), priority: 'primary' },
          { key: 'a', header: 'Account', render: (r: any) => r.account.name },
          { key: 't', header: 'Type', render: (r: any) => label(r.entry_type) },
          { key: 'w', header: 'Description', render: (r: any) => <>{r.description} <span className="text-xs text-ink-subtle">{r.reference}</span></> },
          { key: 'm', header: 'Amount', align: 'right', tabular: true, render: (r: any) => <span className={Number(r.amount) < 0 ? 'text-danger' : 'text-success'}>{fmtMoney(r.amount)}</span> },
          { key: 'b', header: 'Balance', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.balance_after), priority: 'meta' },
        ]} />
    </>
  );
}
