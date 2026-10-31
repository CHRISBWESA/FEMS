import { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { MegaphoneIcon, ArrowRightOnRectangleIcon, KeyIcon } from '@heroicons/react/24/outline';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageLoader, useToast } from '../components/ui';
import { useAuth } from '../App';
import { useI18n } from '../context/I18nContext';
import { AttachmentList, Pager, errMsg, fmtDate, useWorkspace } from './shared';

// ------------------------------------------------------------------ Announcements (read only)

export function WsAnnouncements() {
  const { base, department } = useWorkspace();
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    axios.get(`${base}/announcements?page=${page}&limit=10`, { withCredentials: true }).then((r) => setD(r.data)).catch((e) => setError(errMsg(e, 'Could not load announcements.')));
  };
  useEffect(load, [base, page]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('ws.announcements')}</h1>
          <p className="page-desc">Official announcements from the Fellowship Secretary for {department.name}. Share them with your members through your usual channels.</p>
        </div>
      </div>
      {error ? <ErrorState message={error} onRetry={load} /> : !d ? <PageLoader rows={2} /> : d.data.length === 0 ? (
        <EmptyState icon={<MegaphoneIcon className="h-8 w-8" />} title="No announcements yet" description="Announcements the Fellowship Secretary publishes for your department appear here." />
      ) : (
        <>
          <ul className="space-y-4">
            {d.data.map((a: any) => (
              <li key={a.id}>
                <Card className="card-pad">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="text-base font-semibold text-ink">{a.title}</h2>
                    <span className="text-xs text-ink-subtle">{fmtDate(a.publishedAt)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {a.targetAll ? <Badge tone="info">All departments</Badge> : a.departments.map((x: any) => <Badge key={x.id}>{x.name}</Badge>)}
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{a.content}</p>
                  <div className="mt-3"><AttachmentList items={a.attachments} /></div>
                </Card>
              </li>
            ))}
          </ul>
          <Pager page={d.page} total={d.total} limit={d.limit} onPage={setPage} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Leadership

export function WsLeadership() {
  const { base, department } = useWorkspace();
  const { t } = useI18n();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    axios.get(`${base}/leadership`, { withCredentials: true }).then((r) => setD(r.data)).catch((e) => setError(errMsg(e, 'Could not load the leadership.')));
  };
  useEffect(load, [base]);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!d) return <PageLoader rows={2} />;

  const Office = ({ role, holder }: { role: string; holder: any }) => (
    <Card className="card-pad">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{t(`ws.${role}`)}</p>
      {holder ? (
        <>
          <p className="mt-1 text-lg font-semibold text-ink">{holder.fullName}</p>
          <p className="text-sm text-ink-muted">Appointed {fmtDate(holder.startDate)}{holder.appointedBy ? ` by ${holder.appointedBy}` : ''}</p>
          <Badge tone="success">Current</Badge>
        </>
      ) : <p className="mt-1 text-sm text-ink-muted">{t('ws.vacant')}</p>}
    </Card>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('ws.leadership')}</h1>
          <p className="page-desc">The leaders of {department.name}. Only the Fellowship Secretary appoints or replaces them.</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Office role="department_chairperson" holder={d.chairperson} />
        <Office role="department_secretary" holder={d.secretary} />
      </div>
      <Card className="card-pad">
        <h2 className="mb-3 text-sm font-semibold text-ink">Leadership history</h2>
        <div className="overflow-x-auto">
          <table className="table w-full text-sm">
            <thead><tr><th>Office</th><th>Name</th><th>From</th><th>To</th><th>Status</th></tr></thead>
            <tbody>
              {d.history.map((h: any) => (
                <tr key={h.id}>
                  <td>{t(`ws.${h.role}`)}</td>
                  <td>{h.fullName ?? '—'}</td>
                  <td>{fmtDate(h.startDate)}</td>
                  <td>{h.endDate ? fmtDate(h.endDate) : '—'}</td>
                  <td>{h.current ? <Badge tone="success">Current</Badge> : <span className="capitalize text-ink-muted">{h.endReason ?? 'ended'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Account settings

export function WsAccount() {
  const { user, logout } = useAuth();
  const { departments } = useWorkspace();
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.next !== f.confirm) { setError('The new passwords do not match.'); return; }
    setSaving(true);
    setError('');
    try {
      const r = await axios.post('/auth/change-password', { oldPassword: f.current, newPassword: f.next }, { withCredentials: true });
      // The server ends every other session; keep this one with the fresh tokens it returns.
      if (r.data?.accessToken) localStorage.setItem('accessToken', r.data.accessToken);
      if (r.data?.refreshToken) localStorage.setItem('refreshToken', r.data.refreshToken);
      setF({ current: '', next: '', confirm: '' });
      toast.push('success', 'Password changed');
    } catch (err) { setError(errMsg(err, 'Could not change the password.')); } finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="page-header"><div><h1 className="page-title">{t('ws.account')}</h1></div></div>
      <Card className="card-pad">
        <h2 className="mb-3 text-sm font-semibold text-ink">Account</h2>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div><dt className="text-ink-subtle">Name</dt><dd className="text-ink">{user?.firstName} {user?.lastName}</dd></div>
          <div><dt className="text-ink-subtle">E-mail (login)</dt><dd className="text-ink">{user?.email}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-ink-subtle">Your name and e-mail come from your member record. Ask the Fellowship Secretary to correct them.</p>
      </Card>
      <Card className="card-pad">
        <h2 className="mb-3 text-sm font-semibold text-ink">Your departments</h2>
        <ul className="divide-y divide-hairline text-sm">
          {departments.map((d) => (
            <li key={d.departmentId} className="flex justify-between py-2"><span className="text-ink">{d.name}</span><span className="text-ink-muted">{t(`ws.${d.role}`)} · since {fmtDate(d.since)}</span></li>
          ))}
        </ul>
      </Card>
      <Card className="card-pad">
        <form onSubmit={change} className="space-y-4">
          <h2 className="text-sm font-semibold text-ink">Change password</h2>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Current password" required><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></Field>
          <Field label="New password" required hint="At least 10 characters; avoid your name or e-mail."><Input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required minLength={10} /></Field>
          <Field label="Confirm new password" required><Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></Field>
          <Button type="submit" variant="primary" loading={saving}><KeyIcon className="h-4 w-4" /> Change password</Button>
        </form>
      </Card>
      <Button onClick={async () => { await logout(); navigate('/login'); }}><ArrowRightOnRectangleIcon className="h-4 w-4" /> {t('ws.logout')}</Button>
    </div>
  );
}
