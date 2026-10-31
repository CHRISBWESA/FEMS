import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { PlusIcon, PencilSquareIcon, PaperAirplaneIcon, NoSymbolIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { Alert, Button, ConfirmDialog, Field, Input, Modal, Tabs, Textarea, useToast } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import { AttachmentList, AttachmentsField, Attachment, Detail, ExportButton, HistoryTimeline, StatusBadge, errMsg, fmtDateTime, useWorkspace } from './shared';

type Activity = {
  id: string; title: string; description: string | null; objectives: string | null; venue: string | null; supportingInfo: string | null;
  date: string; endDate: string | null; attachments: Attachment[]; status: string; statusLabel: string; submittedAt: string | null; history?: any[];
};

const FILTERS: { key: string; label: string; statuses: string }[] = [
  { key: 'all', label: 'All', statuses: '' },
  { key: 'draft', label: 'Drafts & returned', statuses: 'DRAFT,RETURNED' },
  { key: 'pending', label: 'Awaiting approval', statuses: 'PENDING_SECRETARY,PENDING_CHAIRPERSON' },
  { key: 'approved', label: 'Approved', statuses: 'APPROVED' },
  { key: 'done', label: 'Completed', statuses: 'COMPLETED' },
  { key: 'closed', label: 'Rejected & cancelled', statuses: 'REJECTED,CANCELLED' },
];

/** <input type="datetime-local"> wants local time without a zone. */
const toLocal = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function WsActivities() {
  const { base, department } = useWorkspace();
  const { t } = useI18n();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Activity | 'new' | null>(params.get('new') === '1' ? 'new' : null);
  const [viewing, setViewing] = useState<Activity | null>(null);

  const statuses = FILTERS.find((f) => f.key === filter)!.statuses;
  const load = useCallback(() => {
    const q = new URLSearchParams({ page: String(page), limit: '20' });
    if (statuses) q.set('status', statuses);
    if (search) q.set('search', search);
    axios.get(`${base}/activities?${q}`, { withCredentials: true })
      .then((r) => { setRows(r.data.data); setTotal(r.data.total); setError(''); })
      .catch((e) => setError(errMsg(e, 'Could not load activities.')));
  }, [base, page, statuses, search]);
  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [load]);
  useEffect(() => setPage(1), [filter, search]);

  const open = async (id: string) => {
    try { setViewing((await axios.get(`${base}/activities/${id}`, { withCredentials: true })).data); } catch (e) { toast.push('error', errMsg(e, 'Could not open the activity.')); }
  };
  const closeEditor = useCallback(() => { setEditing(null); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } }, [params, setParams]);

  const columns: Column<Activity>[] = [
    { key: 'title', header: 'Activity', priority: 'primary', render: (a) => <button className="text-left font-medium text-ink hover:text-primary" onClick={() => open(a.id)}>{a.title}</button> },
    { key: 'date', header: 'Date', priority: 'secondary', render: (a) => fmtDateTime(a.date) },
    { key: 'venue', header: 'Venue', render: (a) => a.venue || '—' },
    { key: 'status', header: 'Status', priority: 'meta', render: (a) => <StatusBadge status={a.status} label={a.statusLabel} /> },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('ws.activities')}</h1>
          <p className="page-desc">Plan {department.name}'s activities. Each one is approved by the Fellowship Secretary and then the Fellowship Chairperson.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton url={`${base}/activities/export${statuses ? `?status=${statuses}` : ''}`} filename={`${department.name}-activities.csv`} />
          <Button variant="primary" onClick={() => setEditing('new')}><PlusIcon className="h-4 w-4" /> {t('ws.newActivity')}</Button>
        </div>
      </div>
      <Tabs tabs={FILTERS.map((f) => ({ key: f.key, label: f.label }))} active={filter} onChange={setFilter} />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        loading={rows === null && !error}
        error={error || null}
        onRetry={load}
        caption="Activities"
        total={total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        search={{ value: search, onChange: setSearch, placeholder: 'Search activities' }}
        empty={{ title: 'No activities here', description: 'Create an activity and submit it for approval.', action: <Button variant="primary" onClick={() => setEditing('new')}>{t('ws.newActivity')}</Button> }}
      />

      {editing && (
        <ActivityForm
          activity={editing === 'new' ? null : editing}
          onClose={closeEditor}
          onSaved={(a, submitted) => { closeEditor(); toast.push('success', submitted ? 'Submitted for approval' : 'Draft saved'); load(); open(a.id); }}
        />
      )}
      {viewing && (
        <ActivityDetail
          activity={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null); }}
          onChanged={(a) => { setViewing(a); load(); }}
        />
      )}
    </div>
  );
}

function ActivityForm({ activity, onClose, onSaved }: { activity: Activity | null; onClose: () => void; onSaved: (a: Activity, submitted: boolean) => void }) {
  const { base } = useWorkspace();
  const [f, setF] = useState({
    title: activity?.title ?? '', description: activity?.description ?? '', objectives: activity?.objectives ?? '', venue: activity?.venue ?? '',
    supportingInfo: activity?.supportingInfo ?? '', date: toLocal(activity?.date), endDate: toLocal(activity?.endDate),
  });
  const [attachments, setAttachments] = useState<Attachment[]>(activity?.attachments ?? []);
  const [saving, setSaving] = useState<'' | 'draft' | 'submit'>('');
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const save = async (submit: boolean) => {
    if (!f.title.trim() || !f.date) { setError('Enter a title and the date and start time.'); return; }
    if (f.endDate && new Date(f.endDate) < new Date(f.date)) { setError('The end time must be after the start time.'); return; }
    setSaving(submit ? 'submit' : 'draft');
    setError('');
    const body = {
      title: f.title.trim(), description: f.description || null, objectives: f.objectives || null, venue: f.venue || null, supportingInfo: f.supportingInfo || null,
      date: new Date(f.date).toISOString(), endDate: f.endDate ? new Date(f.endDate).toISOString() : null, attachments,
    };
    try {
      let saved = activity
        ? (await axios.put(`${base}/activities/${activity.id}`, body, { withCredentials: true })).data
        : (await axios.post(`${base}/activities`, body, { withCredentials: true })).data;
      if (submit) saved = (await axios.post(`${base}/activities/${saved.id}/submit`, {}, { withCredentials: true })).data;
      onSaved(saved, submit);
    } catch (e) {
      setError(errMsg(e, 'Could not save the activity.'));
    } finally {
      setSaving('');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title={activity ? (activity.status === 'RETURNED' ? 'Revise activity' : 'Edit activity') : 'New activity'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button loading={saving === 'draft'} disabled={!!saving} onClick={() => save(false)}>Save draft</Button>
          <Button variant="primary" loading={saving === 'submit'} disabled={!!saving} onClick={() => save(true)}><PaperAirplaneIcon className="h-4 w-4" /> {activity?.status === 'RETURNED' ? 'Resubmit' : 'Submit for approval'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Title" required><Input value={f.title} onChange={set('title')} maxLength={200} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date and start time" required><Input type="datetime-local" value={f.date} onChange={set('date')} /></Field>
          <Field label="End time"><Input type="datetime-local" value={f.endDate} min={f.date} onChange={set('endDate')} /></Field>
        </div>
        <Field label="Venue"><Input value={f.venue} onChange={set('venue')} maxLength={300} /></Field>
        <Field label="Description"><Textarea rows={3} value={f.description} onChange={set('description')} maxLength={5000} /></Field>
        <Field label="Objectives"><Textarea rows={3} value={f.objectives} onChange={set('objectives')} maxLength={3000} /></Field>
        <Field label="Supporting information" hint="Budget, programme, people involved, anything the reviewers should know."><Textarea rows={3} value={f.supportingInfo} onChange={set('supportingInfo')} maxLength={5000} /></Field>
        <AttachmentsField label="Supporting files" value={attachments} onChange={setAttachments} />
      </div>
    </Modal>
  );
}

function ActivityDetail({ activity: a, onClose, onEdit, onChanged }: { activity: Activity; onClose: () => void; onEdit: () => void; onChanged: (a: Activity) => void }) {
  const { base } = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const act = async (what: 'submit' | 'cancel' | 'complete') => {
    setBusy(what);
    try {
      await axios.post(`${base}/activities/${a.id}/${what}`, {}, { withCredentials: true });
      onChanged((await axios.get(`${base}/activities/${a.id}`, { withCredentials: true })).data);
      toast.push('success', what === 'submit' ? 'Submitted for approval' : what === 'cancel' ? 'Activity cancelled' : 'Marked as completed');
    } catch (e) { toast.push('error', errMsg(e, 'That did not work.')); } finally { setBusy(''); setConfirmCancel(false); }
  };
  const editable = ['DRAFT', 'RETURNED'].includes(a.status);
  const lastReturn = [...(a.history ?? [])].reverse().find((h: any) => h.action === 'returned');

  return (
    <Modal open onClose={onClose} width="lg" title={a.title} description={<StatusBadge status={a.status} label={a.statusLabel} />}
      footer={
        <>
          {!['CANCELLED', 'REJECTED', 'COMPLETED'].includes(a.status) && <Button variant="danger-quiet" disabled={!!busy} onClick={() => setConfirmCancel(true)}><NoSymbolIcon className="h-4 w-4" /> Cancel activity</Button>}
          {a.status === 'APPROVED' && new Date(a.date) <= new Date() && <Button loading={busy === 'complete'} onClick={() => act('complete')}><CheckCircleIcon className="h-4 w-4" /> Mark completed</Button>}
          {editable && <Button onClick={onEdit}><PencilSquareIcon className="h-4 w-4" /> {a.status === 'RETURNED' ? 'Revise' : 'Edit'}</Button>}
          {editable && <Button variant="primary" loading={busy === 'submit'} onClick={() => act('submit')}><PaperAirplaneIcon className="h-4 w-4" /> {a.status === 'RETURNED' ? 'Resubmit' : 'Submit'}</Button>}
        </>
      }
    >
      <div className="space-y-5">
        {a.status === 'RETURNED' && lastReturn?.comment && <Alert tone="warning" title="Returned for revision">{lastReturn.comment}</Alert>}
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label="Starts">{fmtDateTime(a.date)}</Detail>
          <Detail label="Ends">{a.endDate ? fmtDateTime(a.endDate) : null}</Detail>
          <Detail label="Venue">{a.venue}</Detail>
          <Detail label="Submitted">{a.submittedAt ? fmtDateTime(a.submittedAt) : null}</Detail>
        </dl>
        <dl className="space-y-4">
          <Detail label="Description">{a.description}</Detail>
          <Detail label="Objectives">{a.objectives}</Detail>
          <Detail label="Supporting information">{a.supportingInfo}</Detail>
        </dl>
        <AttachmentList items={a.attachments} title="Supporting files" />
        <HistoryTimeline events={a.history} />
      </div>
      <ConfirmDialog open={confirmCancel} title="Cancel activity" message={`Cancel "${a.title}"? It is kept on record as cancelled.`} confirmLabel="Cancel activity" loading={busy === 'cancel'} onConfirm={() => act('cancel')} onCancel={() => setConfirmCancel(false)} />
    </Modal>
  );
}
