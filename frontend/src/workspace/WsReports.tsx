import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { PlusIcon, PencilSquareIcon, PaperAirplaneIcon, PrinterIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Card, Field, Input, Modal, StatCard, StatGrid, Tabs, Textarea, useToast } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import { AttachmentList, AttachmentsField, Attachment, Detail, ExportButton, HistoryTimeline, StatusBadge, errMsg, fmtDate, fmtDateTime, fmtMoney, useWorkspace } from './shared';

type Report = {
  id: string; activityId: string | null; activityTitle: string; activityDate: string | null; description: string; objectives: string | null;
  participants: number | null; achievements: string | null; outcomes: string | null; challenges: string | null; recommendations: string | null;
  photos: Attachment[]; documents: Attachment[]; status: string; statusLabel: string; version: number; submittedAt: string | null;
  submissions?: { version: number; submittedAt: string; data: any }[]; history?: any[];
};

const FILTERS = [
  { key: 'all', label: 'All', statuses: '' },
  { key: 'draft', label: 'Drafts & returned', statuses: 'DRAFT,RETURNED' },
  { key: 'review', label: 'Under review', statuses: 'SUBMITTED,RESUBMITTED,UNDER_REVIEW,APPROVED' },
  { key: 'approved', label: 'Approved', statuses: 'FINAL_APPROVED' },
  { key: 'rejected', label: 'Rejected', statuses: 'REJECTED' },
];

export default function WsReports() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'reports' | 'analytics'>('reports');
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="page-header print:hidden">
        <div>
          <h1 className="page-title">{t('ws.reports')}</h1>
          <p className="page-desc">Reports on your activities, reviewed by the Fellowship Secretary and the Fellowship Chairperson, and the department's figures.</p>
        </div>
      </div>
      <div className="print:hidden"><Tabs tabs={[{ key: 'reports', label: 'Activity reports' }, { key: 'analytics', label: 'Summary & downloads' }]} active={tab} onChange={setTab} /></div>
      {tab === 'reports' ? <ReportsList /> : <Analytics />}
    </div>
  );
}

function ReportsList() {
  const { base, department } = useWorkspace();
  const { t } = useI18n();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Report[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Report | 'new' | null>(params.get('new') === '1' ? 'new' : null);
  const [viewing, setViewing] = useState<Report | null>(null);
  const statuses = FILTERS.find((f) => f.key === filter)!.statuses;

  const load = useCallback(() => {
    const q = new URLSearchParams({ page: String(page), limit: '20' });
    if (statuses) q.set('status', statuses);
    axios.get(`${base}/reports?${q}`, { withCredentials: true })
      .then((r) => { setRows(r.data.data); setTotal(r.data.total); setError(''); })
      .catch((e) => setError(errMsg(e, 'Could not load reports.')));
  }, [base, page, statuses]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [filter]);
  const open = async (id: string) => {
    try { setViewing((await axios.get(`${base}/reports/${id}`, { withCredentials: true })).data); } catch (e) { toast.push('error', errMsg(e, 'Could not open the report.')); }
  };
  const closeEditor = useCallback(() => { setEditing(null); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } }, [params, setParams]);

  const columns: Column<Report>[] = [
    { key: 'title', header: 'Activity', priority: 'primary', render: (r) => <button className="text-left font-medium text-ink hover:text-primary" onClick={() => open(r.id)}>{r.activityTitle}</button> },
    { key: 'date', header: 'Activity date', priority: 'secondary', render: (r) => fmtDate(r.activityDate) },
    { key: 'submitted', header: 'Submitted', priority: 'secondary', render: (r) => fmtDate(r.submittedAt) },
    { key: 'version', header: 'Version', tabular: true, render: (r) => r.version },
    { key: 'status', header: 'Status', priority: 'meta', render: (r) => <StatusBadge status={r.status} label={r.statusLabel} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={FILTERS.map((f) => ({ key: f.key, label: f.label }))} active={filter} onChange={setFilter} />
        <div className="flex gap-2">
          <ExportButton url={`${base}/reports/export${statuses ? `?status=${statuses}` : ''}`} filename={`${department.name}-reports.csv`} />
          <Button variant="primary" onClick={() => setEditing('new')}><PlusIcon className="h-4 w-4" /> {t('ws.newReport')}</Button>
        </div>
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={rows === null && !error} error={error || null} onRetry={load} caption="Activity reports"
        total={total} page={page} pageSize={20} onPageChange={setPage}
        empty={{ title: 'No reports here', description: 'After an activity has taken place, write a report on it.', action: <Button variant="primary" onClick={() => setEditing('new')}>{t('ws.newReport')}</Button> }} />
      {editing && <ReportForm report={editing === 'new' ? null : editing} onClose={closeEditor} onSaved={(r, submitted) => { closeEditor(); toast.push('success', submitted ? 'Report submitted for review' : 'Draft saved'); load(); open(r.id); }} />}
      {viewing && <ReportDetail report={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} onChanged={(r) => { setViewing(r); load(); }} />}
    </div>
  );
}

function ReportForm({ report, onClose, onSaved }: { report: Report | null; onClose: () => void; onSaved: (r: Report, submitted: boolean) => void }) {
  const { base, department } = useWorkspace();
  const [activities, setActivities] = useState<any[]>([]);
  const [f, setF] = useState({
    activityId: report?.activityId ?? '', activityTitle: report?.activityTitle ?? '', activityDate: report?.activityDate?.slice(0, 10) ?? '',
    description: report?.description ?? '', objectives: report?.objectives ?? '', participants: report?.participants?.toString() ?? '',
    achievements: report?.achievements ?? '', outcomes: report?.outcomes ?? '', challenges: report?.challenges ?? '', recommendations: report?.recommendations ?? '',
  });
  const [photos, setPhotos] = useState<Attachment[]>(report?.photos ?? []);
  const [documents, setDocuments] = useState<Attachment[]>(report?.documents ?? []);
  const [saving, setSaving] = useState<'' | 'draft' | 'submit'>('');
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`${base}/activities?status=APPROVED,COMPLETED&limit=100`, { withCredentials: true }).then((r) => setActivities(r.data.data)).catch(() => {});
  }, [base]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const pickActivity = (id: string) => {
    const a = activities.find((x) => x.id === id);
    setF({ ...f, activityId: id, activityTitle: a ? a.title : f.activityTitle, activityDate: a ? a.date.slice(0, 10) : f.activityDate, objectives: f.objectives || a?.objectives || '' });
  };

  const save = async (submit: boolean) => {
    if (!f.activityTitle.trim() || !f.activityDate || !f.description.trim()) { setError('Enter the activity, its date and a description.'); return; }
    setSaving(submit ? 'submit' : 'draft');
    setError('');
    const body = {
      activityId: f.activityId || null, activityTitle: f.activityTitle.trim(), activityDate: f.activityDate, description: f.description,
      objectives: f.objectives || null, participants: f.participants === '' ? null : Number(f.participants), achievements: f.achievements || null,
      outcomes: f.outcomes || null, challenges: f.challenges || null, recommendations: f.recommendations || null, photos, documents,
    };
    try {
      let saved = report
        ? (await axios.put(`${base}/reports/${report.id}`, body, { withCredentials: true })).data
        : (await axios.post(`${base}/reports`, body, { withCredentials: true })).data;
      if (submit) saved = (await axios.post(`${base}/reports/${saved.id}/submit`, {}, { withCredentials: true })).data;
      onSaved(saved, submit);
    } catch (e) { setError(errMsg(e, 'Could not save the report.')); } finally { setSaving(''); }
  };

  return (
    <Modal open onClose={onClose} width="lg" title={report ? (report.status === 'RETURNED' ? 'Revise report' : 'Edit report') : 'New activity report'} description={`Department: ${department.name}`}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button loading={saving === 'draft'} disabled={!!saving} onClick={() => save(false)}>Save draft</Button>
        <Button variant="primary" loading={saving === 'submit'} disabled={!!saving} onClick={() => save(true)}><PaperAirplaneIcon className="h-4 w-4" /> {report?.status === 'RETURNED' ? 'Resubmit' : 'Submit for review'}</Button>
      </>}
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Activity" hint="Choose an approved activity, or type a title below.">
          <select className="select w-full" value={f.activityId} onChange={(e) => pickActivity(e.target.value)}>
            <option value="">Not linked to an activity</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.title} · {fmtDate(a.date)}</option>)}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Activity title" required><Input value={f.activityTitle} onChange={set('activityTitle')} maxLength={200} /></Field>
          <Field label="Activity date" required><Input type="date" value={f.activityDate} onChange={set('activityDate')} /></Field>
        </div>
        <Field label="Description of the activity" required><Textarea rows={4} value={f.description} onChange={set('description')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Objectives"><Textarea rows={3} value={f.objectives} onChange={set('objectives')} /></Field>
          <Field label="Number of participants"><Input type="number" min={0} value={f.participants} onChange={set('participants')} /></Field>
          <Field label="Achievements"><Textarea rows={3} value={f.achievements} onChange={set('achievements')} /></Field>
          <Field label="Outcomes"><Textarea rows={3} value={f.outcomes} onChange={set('outcomes')} /></Field>
          <Field label="Challenges"><Textarea rows={3} value={f.challenges} onChange={set('challenges')} /></Field>
          <Field label="Recommendations"><Textarea rows={3} value={f.recommendations} onChange={set('recommendations')} /></Field>
        </div>
        <AttachmentsField label="Photographs" value={photos} onChange={setPhotos} accept="image/jpeg,image/png,image/webp,image/gif" />
        <AttachmentsField label="Supporting documents" value={documents} onChange={setDocuments} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" />
      </div>
    </Modal>
  );
}

function ReportBody({ r }: { r: any }) {
  return (
    <div className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-3">
        <Detail label="Activity date">{fmtDate(r.activityDate)}</Detail>
        <Detail label="Participants">{r.participants ?? null}</Detail>
        <Detail label="Submitted">{r.submittedAt ? fmtDateTime(r.submittedAt) : null}</Detail>
      </dl>
      <dl className="space-y-4">
        <Detail label="Description">{r.description}</Detail>
        <Detail label="Objectives">{r.objectives}</Detail>
        <Detail label="Achievements">{r.achievements}</Detail>
        <Detail label="Outcomes">{r.outcomes}</Detail>
        <Detail label="Challenges">{r.challenges}</Detail>
        <Detail label="Recommendations">{r.recommendations}</Detail>
      </dl>
      <AttachmentList items={r.photos} title="Photographs" />
      <AttachmentList items={r.documents} title="Supporting documents" />
    </div>
  );
}

function ReportDetail({ report: r, onClose, onEdit, onChanged }: { report: Report; onClose: () => void; onEdit: () => void; onChanged: (r: Report) => void }) {
  const { base } = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const editable = ['DRAFT', 'RETURNED'].includes(r.status);
  const lastReturn = [...(r.history ?? [])].reverse().find((h: any) => h.action === 'returned');
  const older = version ? r.submissions?.find((s) => s.version === version) : null;
  const submit = async () => {
    setBusy(true);
    try { onChanged((await axios.post(`${base}/reports/${r.id}/submit`, {}, { withCredentials: true })).data); toast.push('success', 'Report submitted for review'); }
    catch (e) { toast.push('error', errMsg(e, 'Could not submit the report.')); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="lg" title={r.activityTitle} description={<span className="inline-flex items-center gap-2"><StatusBadge status={r.status} label={r.statusLabel} /> <span className="text-xs">Version {r.version}</span></span>}
      footer={<>
        <Button onClick={() => window.print()}><PrinterIcon className="h-4 w-4" /> Print / PDF</Button>
        {editable && <Button onClick={onEdit}><PencilSquareIcon className="h-4 w-4" /> {r.status === 'RETURNED' ? 'Revise' : 'Edit'}</Button>}
        {editable && <Button variant="primary" loading={busy} onClick={submit}><PaperAirplaneIcon className="h-4 w-4" /> {r.status === 'RETURNED' ? 'Resubmit' : 'Submit'}</Button>}
      </>}
    >
      <div className="space-y-5">
        {r.status === 'RETURNED' && lastReturn?.comment && <Alert tone="warning" title="Returned for revision">{lastReturn.comment}</Alert>}
        {(r.submissions?.length ?? 0) > 1 && (
          <Field label="Version">
            <select className="select w-auto" value={version ?? ''} onChange={(e) => setVersion(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Current</option>
              {r.submissions!.map((s) => <option key={s.version} value={s.version}>Version {s.version} · submitted {fmtDate(s.submittedAt)}</option>)}
            </select>
          </Field>
        )}
        <ReportBody r={older ? older.data : r} />
        <HistoryTimeline events={r.history} />
      </div>
    </Modal>
  );
}

function Analytics() {
  const { base, department } = useWorkspace();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const range = new URLSearchParams();
  if (from) range.set('from', from);
  if (to) range.set('to', to);
  const qs = range.toString();
  useEffect(() => {
    setD(null);
    axios.get(`${base}/analytics${qs ? `?${qs}` : ''}`, { withCredentials: true }).then((r) => { setD(r.data); setError(''); }).catch((e) => setError(errMsg(e, 'Could not load the figures.')));
  }, [base, qs]);
  const n = (o: any, ...keys: string[]) => keys.reduce((s, k) => s + (typeof o?.[k] === 'number' ? o[k] : o?.[k]?.count ?? 0), 0);
  const withQs = (p: string, extra = '') => `${base}/${p}?${[qs, extra].filter(Boolean).join('&')}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field label="From"><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button onClick={() => window.print()}><PrinterIcon className="h-4 w-4" /> Print / save as PDF</Button>
      </div>
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">{department.name} — department report</h1>
        <p className="text-sm">{from || 'Beginning'} to {to || 'today'} · printed {new Date().toLocaleDateString()}</p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {d && (
        <>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Membership</h2>
            <StatGrid>
              <StatCard label="Members" value={d.members.total} />
              <StatCard label="Male" value={d.members.male} hint={d.members.total ? `${Math.round((d.members.male / d.members.total) * 100)}%` : undefined} />
              <StatCard label="Female" value={d.members.female} hint={d.members.total ? `${Math.round((d.members.female / d.members.total) * 100)}%` : undefined} />
              <StatCard label="Active" value={d.members.active} hint={`${d.members.inactive} inactive · ${d.members.graduated} graduated`} />
            </StatGrid>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Activities</h2>
            <StatGrid>
              <StatCard label="Completed" value={n(d.activities, 'COMPLETED')} />
              <StatCard label="Approved (upcoming or held)" value={n(d.activities, 'APPROVED')} />
              <StatCard label="Awaiting approval" value={n(d.activities, 'PENDING_SECRETARY', 'PENDING_CHAIRPERSON')} tone="warning" />
              <StatCard label="Returned or rejected" value={n(d.activities, 'RETURNED', 'REJECTED')} />
            </StatGrid>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Reports</h2>
            <StatGrid>
              <StatCard label="Submitted, under review" value={n(d.reports, 'SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW', 'APPROVED')} />
              <StatCard label="Approved" value={n(d.reports, 'FINAL_APPROVED')} tone="success" />
              <StatCard label="Returned" value={n(d.reports, 'RETURNED')} tone="warning" />
              <StatCard label="Drafts" value={n(d.reports, 'DRAFT')} />
            </StatGrid>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Financial requests</h2>
            <StatGrid>
              <StatCard label="In review" value={n(d.financialRequests, 'SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW', 'APPROVED')} />
              <StatCard label="Fully approved" value={n(d.financialRequests, 'FINAL_APPROVED')} tone="success" />
              <StatCard label="Approved amount" value={fmtMoney(d.approvedAmount)} />
              <StatCard label="Returned or rejected" value={n(d.financialRequests, 'RETURNED', 'REJECTED')} />
            </StatGrid>
          </section>
          <Card className="card-pad print:hidden">
            <h2 className="mb-1 text-sm font-semibold text-ink">Download</h2>
            <p className="mb-3 text-sm text-ink-muted">CSV files open in Excel. The date range above applies to activities, reports and requests.</p>
            <div className="flex flex-wrap gap-2">
              <ExportButton url={`${base}/members/export`} filename={`${department.name}-members.csv`} label="Member list" />
              <ExportButton url={withQs('activities/export', 'status=COMPLETED')} filename={`${department.name}-completed-activities.csv`} label="Completed activities" />
              <ExportButton url={withQs('activities/export', 'status=PENDING_SECRETARY,PENDING_CHAIRPERSON')} filename={`${department.name}-pending-activities.csv`} label="Pending approvals" />
              <ExportButton url={withQs('reports/export')} filename={`${department.name}-reports.csv`} label="All reports" />
              <ExportButton url={withQs('reports/export', 'status=FINAL_APPROVED')} filename={`${department.name}-approved-reports.csv`} label="Approved reports" />
              <ExportButton url={withQs('reports/export', 'status=RETURNED')} filename={`${department.name}-returned-reports.csv`} label="Returned reports" />
              <ExportButton url={withQs('financial-requests/export')} filename={`${department.name}-financial-requests.csv`} label="Financial requests" />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
