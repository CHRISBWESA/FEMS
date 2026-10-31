import { useState } from 'react';
import axios from 'axios';
import { PlusIcon, GlobeAltIcon, QrCodeIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Field, Input, Modal, PageHeader, Select, Textarea, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import { errMsg, fmtDate, fmtMoney, FormModal, ProjectSelect, scopeQuery, Status, today, useFin, useLoad } from './common';

const publicUrl = (slug: string) => `${window.location.origin}/give/${slug}`;

export function Campaigns() {
  const s = useFin();
  const { t } = useI18n();
  const toast = useToast();
  const list = useLoad<any[]>(`/finance/campaigns?${scopeQuery(s)}`, [s.departmentId]);
  const [edit, setEdit] = useState<any>(null);
  const [lines, setLines] = useState<{ item: string; amount: string }[]>([]);
  const [qr, setQr] = useState<{ svg: string; url: string } | null>(null);
  const [upd, setUpd] = useState<any>(null);
  const updates = useLoad<any[]>(upd ? `/finance/campaigns/${upd.id}/updates` : null, [upd?.id]);
  const [u, setU] = useState({ title: '', body: '' });
  const canManage = s.departmentId ? s.leaderRole === 'department_chairperson' : s.roles.some((r) => ['treasurer', 'secretary'].includes(r));

  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast.push('success', ok); list.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not complete that.')); } };
  const showQr = async (c: any) => {
    try {
      const r = await axios.get(`/finance/campaigns/${c.id}/qr`, { withCredentials: true, responseType: 'text' });
      setQr({ svg: r.data, url: publicUrl(c.public_slug) });
    } catch (e) { toast.push('error', errMsg(e, 'Publish the campaign first.')); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('fin.nav.campaigns')} description="Fundraising for projects. A campaign can have a public page once its project is approved; the page shows totals only, never who gave."
        actions={canManage ? <Button variant="primary" onClick={() => { setEdit({ name: '', description: '', targetAmount: '', startDate: today(), endDate: '', projectId: '', status: 'active' }); setLines([]); }}><PlusIcon className="h-4 w-4" /> New campaign</Button> : undefined} />
      <DataTable rows={list.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        empty={{ title: 'No campaigns' }}
        columns={[
          { key: 'n', header: 'Campaign', render: (r: any) => <span className="font-medium">{r.name}</span>, priority: 'primary' },
          { key: 'd', header: 'Dates', render: (r: any) => `${fmtDate(r.start_date)} – ${r.end_date ? fmtDate(r.end_date) : 'open'}`, priority: 'meta' },
          { key: 't', header: 'Target', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.target_amount, s.currency) },
          { key: 'r', header: 'Raised', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.progress?.raised, s.currency) },
          { key: 'p', header: 'Progress', render: (r: any) => (r.progress?.percentOfTarget === null || r.progress?.percentOfTarget === undefined ? '—' : (
            <span className="flex items-center gap-2"><span className="h-2 w-20 overflow-hidden rounded bg-surface-sunken"><span className="block h-full bg-primary" style={{ width: `${r.progress.percentOfTarget}%` }} /></span>{r.progress.percentOfTarget}%</span>)) },
          { key: 's', header: 'Status', render: (r: any) => <span className="inline-flex gap-1"><Status value={r.status} />{r.is_public && <Status value="open" />}</span> },
        ]}
        rowActions={(r: any) => canManage ? (
          <span className="inline-flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" onClick={() => { setEdit({ id: r.id, name: r.name, description: r.description ?? '', targetAmount: r.target_amount ?? '', startDate: r.start_date?.slice(0, 10), endDate: r.end_date?.slice(0, 10) ?? '', projectId: r.project_id ?? '', status: r.status }); setLines((r.budget_breakdown ?? []).map((b: any) => ({ item: b.item, amount: String(b.amount) }))); }}>Edit</Button>
            {r.is_public
              ? <><Button size="sm" variant="ghost" onClick={() => showQr(r)}><QrCodeIcon className="h-4 w-4" /> Link</Button><Button size="sm" variant="ghost" onClick={() => act(() => axios.post(`/finance/campaigns/${r.id}/unpublish`, {}, { withCredentials: true }), 'Removed from the website')}>Unpublish</Button></>
              : <Button size="sm" variant="ghost" onClick={() => act(() => axios.post(`/finance/campaigns/${r.id}/publish`, {}, { withCredentials: true }), 'Published')}><GlobeAltIcon className="h-4 w-4" /> Publish</Button>}
            <Button size="sm" variant="ghost" onClick={() => setUpd(r)}>Updates</Button>
          </span>
        ) : null} />

      <FormModal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit campaign' : 'New campaign'} width="lg"
        onSubmit={async () => {
          const body = { name: edit.name, description: edit.description || undefined, targetAmount: edit.targetAmount === '' ? null : Number(edit.targetAmount), endDate: edit.endDate || null, projectId: edit.projectId || null, status: edit.status, budgetBreakdown: lines.filter((l) => l.item && l.amount).map((l) => ({ item: l.item, amount: Number(l.amount) })) };
          if (edit.id) await axios.put(`/finance/campaigns/${edit.id}`, body, { withCredentials: true });
          else await axios.post('/finance/campaigns', { ...body, startDate: edit.startDate, departmentId: s.departmentId ?? undefined }, { withCredentials: true });
          toast.push('success', 'Saved'); list.reload();
        }}>
        <Field label="Title" required><Input value={edit?.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="What is it for"><Textarea rows={3} value={edit?.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Target (${s.currency})`}><Input type="number" min="0" step="0.01" value={edit?.targetAmount ?? ''} onChange={(e) => setEdit({ ...edit, targetAmount: e.target.value })} /></Field>
          <Field label="Project" hint="Required for a public page"><ProjectSelect value={edit?.projectId ?? ''} onChange={(v) => setEdit({ ...edit, projectId: v })} /></Field>
          {!edit?.id && <Field label="Starts" required><Input type="date" value={edit?.startDate ?? ''} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} /></Field>}
          <Field label="Ends"><Input type="date" value={edit?.endDate ?? ''} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} /></Field>
          <Field label="Status"><Select value={edit?.status ?? 'active'} onChange={(e) => setEdit({ ...edit, status: e.target.value })} options={(edit?.id ? ['active', 'paused', 'closed', 'draft'] : ['active', 'draft']).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))} /></Field>
        </div>
        <div>
          <p className="label">Budget breakdown (shown on the public page)</p>
          {lines.map((l, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <Input placeholder="Item" value={l.item} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} />
              <Input className="w-36" type="number" placeholder="Amount" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <Button type="button" variant="ghost" size="sm" aria-label="Remove item" onClick={() => setLines(lines.filter((_, j) => j !== i))}><TrashIcon className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" size="sm" onClick={() => setLines([...lines, { item: '', amount: '' }])}><PlusIcon className="h-4 w-4" /> Add item</Button>
        </div>
      </FormModal>

      <Modal open={!!qr} onClose={() => setQr(null)} title="Public page">
        {qr && (
          <div className="space-y-3 text-center">
            <div className="mx-auto w-64 rounded bg-white p-2" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <p className="break-all text-sm"><a className="text-primary hover:underline" href={qr.url} target="_blank" rel="noreferrer">{qr.url}</a></p>
            <Button size="sm" onClick={() => { navigator.clipboard?.writeText(qr.url); toast.push('success', 'Link copied'); }}>Copy link</Button>
          </div>
        )}
      </Modal>

      <Modal open={!!upd} onClose={() => setUpd(null)} title={`Updates: ${upd?.name ?? ''}`} width="lg">
        <div className="space-y-4">
          <Alert tone="info">Published updates appear on the public page. Do not include personal details of contributors.</Alert>
          <Field label="Title"><Input value={u.title} onChange={(e) => setU({ ...u, title: e.target.value })} /></Field>
          <Field label="Update"><Textarea rows={3} value={u.body} onChange={(e) => setU({ ...u, body: e.target.value })} /></Field>
          <Button variant="primary" disabled={!u.title || !u.body} onClick={async () => { try { await axios.post(`/finance/campaigns/${upd.id}/updates`, u, { withCredentials: true }); setU({ title: '', body: '' }); updates.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not post.')); } }}>Post update</Button>
          <ul className="space-y-2">{(updates.data ?? []).map((x) => (
            <li key={x.id} className="rounded-control bg-surface-sunken px-3 py-2 text-sm">
              <div className="flex justify-between"><span className="font-medium">{x.title}</span><button className="text-xs text-primary hover:underline" onClick={async () => { await axios.put(`/finance/campaigns/${upd.id}/updates/${x.id}`, { isPublished: !x.is_published }, { withCredentials: true }); updates.reload(); }}>{x.is_published ? 'Hide' : 'Show'}</button></div>
              <p className="text-ink-muted">{x.body}</p><p className="text-xs text-ink-subtle">{fmtDate(x.created_at)}{x.is_published ? '' : ' · hidden'}</p>
            </li>
          ))}</ul>
        </div>
      </Modal>
    </div>
  );
}
