import { useEffect, useState } from 'react';
import axios from 'axios';
import { EyeIcon } from '@heroicons/react/24/outline';
import { beginImpersonation, currentSession, isImpersonating } from '../../lib/impersonation';
import { Empty, Modal, Spinner, errMsg } from '../finance/common';

const DURATIONS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours (maximum)' },
];

const badge = (s: string, live: boolean) =>
  s === 'active' && live ? 'status-active' : s === 'active' ? 'status-draft' : 'status-inactive';

export default function Impersonation() {
  const [targets, setTargets] = useState<any[] | null>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [fellowships, setFellowships] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [fellowshipId, setFellowshipId] = useState('');
  const [picked, setPicked] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [ending, setEnding] = useState<any>(null);

  const load = () => {
    axios.get('/platform/impersonations/targets?limit=200', { withCredentials: true })
      .then((r) => setTargets(r.data?.data ?? []))
      .catch((e) => { setTargets([]); setError(errMsg(e, 'Could not load accounts')); });
    axios.get('/platform/impersonations?limit=25', { withCredentials: true })
      .then((r) => setHistory(r.data?.data ?? []))
      .catch(() => setHistory([]));
    axios.get('/platform/tenants?limit=200', { withCredentials: true })
      .then((r) => setFellowships(r.data?.data ?? []))
      .catch(() => setFellowships([]));
  };
  useEffect(() => { load(); }, []);

  const filtered = (targets || []).filter((t) => {
    if (fellowshipId && t.fellowshipId !== fellowshipId) return false;
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return `${t.name} ${t.email}`.toLowerCase().includes(needle);
  });

  const start = async (v: any) => {
    if (!picked) return;
    setBusy(picked.id);
    setError('');
    try {
      const r = await axios.post('/platform/impersonations', {
        targetUserId: picked.id,
        reason: v.reason,
        durationMinutes: Number(v.durationMinutes),
      }, { withCredentials: true });
      // The response carries a token for the TARGET, so the administrator's own tokens are put aside first.
      beginImpersonation(
        {
          id: r.data.session.id,
          targetName: r.data.target.name,
          targetEmail: r.data.target.email,
          fellowship: r.data.target.fellowship,
          reason: v.reason,
          expiresAt: r.data.session.expiresAt,
        },
        r.data.accessToken,
        r.data.refreshToken,
      );
      window.location.href = '/dashboard';
    } catch (e: any) {
      setError(errMsg(e, 'Could not start the session'));
    } finally {
      setBusy('');
    }
  };

  const endNow = async (s: any) => {
    setBusy(s.id);
    try {
      await axios.post(`/platform/impersonations/${s.id}/end`, { reason: 'Ended by the administrator.' }, { withCredentials: true });
      load();
    } catch (e: any) {
      setError(errMsg(e, 'Could not end the session'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      {isImpersonating() && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/30">
          You are currently acting as {currentSession()?.targetName}.{' '}
          <button className="font-semibold underline" onClick={() => window.location.reload()}>Return to your own account</button>
        </div>
      )}

      <div className="rounded-lg bg-canvas p-4 text-sm text-ink-muted ring-1 ring-inset ring-hairline">
        <p>
          Acting as a user gives you exactly that person&rsquo;s access to their own fellowship. Every session is
          time-boxed, cannot be extended, is written to the platform audit trail, appears in the
          <em> fellowship&rsquo;s</em> audit trail, notifies the account holder by notification, and can be ended by
          them at any moment. Use it when a client asks you to fix something in their account.
        </p>
      </div>

      {error && <p className="alert alert-danger" role="alert">{error}</p>}

      <div className="card">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Choose an account</h2>
        <p className="mb-4 text-sm text-ink-muted">Only active fellowship accounts appear. Platform accounts cannot be impersonated.</p>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input className="input max-w-xs" placeholder="Search name or e-mail…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select w-56" value={fellowshipId} onChange={(e) => setFellowshipId(e.target.value)}>
            <option value="">All fellowships</option>
            {fellowships.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>

        {!targets ? <Spinner /> : filtered.length === 0 ? (
          <Empty text={q || fellowshipId ? 'No matching accounts' : 'There are no fellowship accounts to act as'} />
        ) : (
          <div className="table-wrap overflow-x-auto">
            <table className="table">
              <thead><tr><th>Name</th><th>E-mail</th><th>Fellowship</th><th>Roles</th><th /></tr></thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium text-ink">{t.name}</td>
                    <td>{t.email}</td>
                    <td className="text-xs text-ink-muted">{t.fellowship || '—'}</td>
                    <td className="text-xs text-ink-muted">{t.roles.join(', ').replace(/_/g, ' ')}</td>
                    <td className="text-right">
                      <button className="btn btn-primary btn-sm" disabled={busy === t.id} onClick={() => setPicked(t)}>
                        <EyeIcon className="h-4 w-4" /> Act as this user
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Session history</h2>
        {!history ? <Spinner /> : history.length === 0 ? <Empty text="No impersonation sessions yet" /> : (
          <div className="table-wrap overflow-x-auto">
            <table className="table">
              <thead><tr><th>Started</th><th>Administrator</th><th>Acted as</th><th>Fellowship</th><th>Reason</th><th>Status</th><th /></tr></thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap text-xs">{s.startedAt ? new Date(s.startedAt).toLocaleString() : '—'}</td>
                    <td className="text-xs">{s.admin?.name || '—'}</td>
                    <td className="text-xs font-medium text-ink">{s.targetEmail}</td>
                    <td className="text-xs text-ink-muted">
                      {fellowships.find((f) => f.id === s.fellowshipId)?.name || '—'}
                    </td>
                    <td className="max-w-xs truncate text-xs text-ink-muted">{s.reason}</td>
                    <td>
                      <span className={`status-badge ${badge(s.status, s.live)}`}>
                        {s.status === 'active' && !s.live ? 'expired' : s.status}
                      </span>
                      {s.live && s.expiresAt && (
                        <p className="mt-1 text-xs text-ink-subtle">until {new Date(s.expiresAt).toLocaleTimeString()}</p>
                      )}
                    </td>
                    <td className="text-right">
                      {s.live && (
                        <button className="btn btn-secondary btn-sm" disabled={busy === s.id} onClick={() => setEnding(s)}>End now</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {picked && (
        <Modal title={`Act as ${picked.name}`} onClose={() => setPicked(null)} max="max-w-lg">
          <form
            onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget as any); start({ reason: f.get('reason'), durationMinutes: f.get('durationMinutes') }); }}
            className="space-y-4"
          >
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              You will be signed in as <strong>{picked.email}</strong> ({picked.fellowship}). You will see and change
              their data exactly as they can.
            </p>
            <div>
              <label className="label">Reason * — the account holder sees this</label>
              <textarea name="reason" required minLength={10} maxLength={500} rows={3} className="input w-full"
                placeholder="e.g. Client phoned: their treasurer cannot record contributions since Friday." />
            </div>
            <div>
              <label className="label">Time limit</label>
              <select name="durationMinutes" className="select w-full" defaultValue="30">
                {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              <p className="mt-1 text-xs text-ink-subtle">The session ends on its own and cannot be extended.</p>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={busy === picked.id} className="btn btn-primary flex-1">
                {busy === picked.id ? <Spinner /> : 'Start session'}
              </button>
              <button type="button" onClick={() => setPicked(null)} className="btn btn-secondary flex-1">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {ending && (
        <Modal title="End this session" onClose={() => setEnding(null)} max="max-w-md">
          <form
            onSubmit={(e) => { e.preventDefault(); endNow(ending); setEnding(null); }}
            className="space-y-4"
          >
            <p className="text-sm text-ink-muted">Ending takes effect on the impersonated session&rsquo;s very next request.</p>
            <div>
              <label className="label">Reason (recorded)</label>
              <input name="reason" className="input w-full" defaultValue="Support issue resolved." />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary flex-1">End session</button>
              <button type="button" onClick={() => setEnding(null)} className="btn btn-secondary flex-1">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
