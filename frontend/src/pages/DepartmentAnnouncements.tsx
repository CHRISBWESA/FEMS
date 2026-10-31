import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { PlusIcon, MegaphoneIcon, PencilSquareIcon, ArchiveBoxIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoader, Radio, Tabs, Textarea, useToast } from '../components/ui';
import { StatusBadge, Pager, errMsg, fmtDate } from '../workspace/shared';

type Announcement = { id: string; title: string; content: string; status: string; targetAll: boolean; departments: { id: string; name: string }[]; publishedAt: string | null; createdAt: string };

/** The Fellowship Secretary publishes announcements to all departments or to chosen ones. */
export default function DepartmentAnnouncements() {
  const toast = useToast();
  const [status, setStatus] = useState<'all' | 'draft' | 'published' | 'archived'>('all');
  const [page, setPage] = useState(1);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    setError('');
    const q = new URLSearchParams({ page: String(page), limit: '10' });
    if (status !== 'all') q.set('status', status);
    axios.get(`/department-admin/announcements?${q}`, { withCredentials: true }).then((r) => setD(r.data)).catch((e) => setError(errMsg(e, 'Could not load announcements.')));
  }, [page, status]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [status]);
  const closeEditor = useCallback(() => setEditing(null), []);

  const act = async (a: Announcement, what: 'publish' | 'archive') => {
    setBusy(a.id + what);
    try {
      await axios.post(`/department-admin/announcements/${a.id}/${what}`, {}, { withCredentials: true });
      toast.push('success', what === 'publish' ? 'Published to the department leaders' : 'Archived');
      setArchiving(null);
      load();
    } catch (e) { toast.push('error', errMsg(e, 'That did not work.')); } finally { setBusy(''); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Department Announcements</h1>
          <p className="page-desc">Official announcements for department leaders, who pass them on to their members.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}><PlusIcon className="h-4 w-4" /> New announcement</Button>
      </div>
      <Tabs tabs={[{ key: 'all', label: 'All' }, { key: 'draft', label: 'Drafts' }, { key: 'published', label: 'Published' }, { key: 'archived', label: 'Archived' }]} active={status} onChange={setStatus} />
      {error ? <ErrorState message={error} onRetry={load} /> : !d ? <PageLoader rows={2} /> : d.data.length === 0 ? (
        <EmptyState icon={<MegaphoneIcon className="h-8 w-8" />} title="No announcements" action={<Button variant="primary" onClick={() => setEditing('new')}>New announcement</Button>} />
      ) : (
        <>
          <ul className="space-y-3">
            {d.data.map((a: Announcement) => (
              <li key={a.id}>
                <Card className="card-pad">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-ink">{a.title}</h2>
                      <p className="text-xs text-ink-subtle">{a.publishedAt ? `Published ${fmtDate(a.publishedAt)}` : `Created ${fmtDate(a.createdAt)}`}</p>
                    </div>
                    <StatusBadge status={a.status} label={a.status[0].toUpperCase() + a.status.slice(1)} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">{a.targetAll ? <Badge tone="info">All departments</Badge> : a.departments.map((x) => <Badge key={x.id}>{x.name}</Badge>)}</div>
                  <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-ink">{a.content}</p>
                  {a.status !== 'archived' && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-3">
                      <Button size="sm" onClick={() => setEditing(a)}><PencilSquareIcon className="h-4 w-4" /> Edit</Button>
                      {a.status === 'draft' && <Button size="sm" variant="primary" loading={busy === a.id + 'publish'} onClick={() => act(a, 'publish')}><PaperAirplaneIcon className="h-4 w-4" /> Publish</Button>}
                      <Button size="sm" variant="quiet" onClick={() => setArchiving(a)}><ArchiveBoxIcon className="h-4 w-4" /> Archive</Button>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
          <Pager page={d.page} total={d.total} limit={d.limit} onPage={setPage} />
        </>
      )}
      {editing && <AnnouncementForm announcement={editing === 'new' ? null : editing} onClose={closeEditor} onSaved={(published) => { closeEditor(); toast.push('success', published ? 'Published to the department leaders' : 'Saved'); load(); }} />}
      <ConfirmDialog open={!!archiving} title="Archive announcement" message={`Archive "${archiving?.title}"? Leaders will no longer see it.`} confirmLabel="Archive" tone="primary" loading={!!archiving && busy === archiving.id + 'archive'} onConfirm={() => archiving && act(archiving, 'archive')} onCancel={() => setArchiving(null)} />
    </div>
  );
}

function AnnouncementForm({ announcement, onClose, onSaved }: { announcement: Announcement | null; onClose: () => void; onSaved: (published: boolean) => void }) {
  const [departments, setDepartments] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [title, setTitle] = useState(announcement?.title ?? '');
  const [content, setContent] = useState(announcement?.content ?? '');
  const [targetAll, setTargetAll] = useState(announcement?.targetAll ?? true);
  const [chosen, setChosen] = useState<string[]>(announcement?.departments.map((d) => d.id) ?? []);
  const [saving, setSaving] = useState<'' | 'save' | 'publish'>('');
  const [error, setError] = useState('');
  useEffect(() => { axios.get('/department-admin/departments', { withCredentials: true }).then((r) => setDepartments(r.data)).catch(() => {}); }, []);

  const save = async (publish: boolean) => {
    if (!title.trim() || !content.trim()) { setError('Enter a title and the announcement.'); return; }
    if (!targetAll && chosen.length === 0) { setError('Choose at least one department.'); return; }
    setSaving(publish ? 'publish' : 'save');
    setError('');
    const body = { title: title.trim(), content, targetAll, departmentIds: targetAll ? [] : chosen };
    try {
      if (announcement) {
        await axios.put(`/department-admin/announcements/${announcement.id}`, body, { withCredentials: true });
        if (publish && announcement.status === 'draft') await axios.post(`/department-admin/announcements/${announcement.id}/publish`, {}, { withCredentials: true });
      } else {
        await axios.post('/department-admin/announcements', { ...body, publish }, { withCredentials: true });
      }
      onSaved(publish);
    } catch (e) { setError(errMsg(e, 'Could not save the announcement.')); } finally { setSaving(''); }
  };
  const canPublish = !announcement || announcement.status === 'draft';

  return (
    <Modal open onClose={onClose} width="lg" title={announcement ? 'Edit announcement' : 'New announcement'}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button loading={saving === 'save'} disabled={!!saving} onClick={() => save(false)}>{announcement && announcement.status !== 'draft' ? 'Save changes' : 'Save draft'}</Button>
        {canPublish && <Button variant="primary" loading={saving === 'publish'} disabled={!!saving} onClick={() => save(true)}><PaperAirplaneIcon className="h-4 w-4" /> Publish</Button>}
      </>}>
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Field>
        <Field label="Announcement" required><Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} maxLength={20000} /></Field>
        <fieldset className="space-y-2">
          <legend className="label">Send to</legend>
          <Radio name="target" label="All departments" checked={targetAll} onChange={() => setTargetAll(true)} />
          <Radio name="target" label="Selected departments" checked={!targetAll} onChange={() => setTargetAll(false)} />
          {!targetAll && (
            <div className="ml-6 grid gap-1 sm:grid-cols-2">
              {departments.map((d) => (
                <Checkbox key={d.id} label={<>{d.name}{!d.isActive && <span className="text-ink-subtle"> (inactive)</span>}</>} checked={chosen.includes(d.id)}
                  onChange={(e) => setChosen(e.target.checked ? [...chosen, d.id] : chosen.filter((x) => x !== d.id))} />
              ))}
            </div>
          )}
        </fieldset>
      </div>
    </Modal>
  );
}
