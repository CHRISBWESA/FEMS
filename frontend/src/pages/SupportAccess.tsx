import { useEffect, useState } from 'react';
import axios from 'axios';
import { Empty, Spinner, errMsg } from '../components/finance/common';

const SCOPE: Record<string, string> = { tenant_config: 'Configuration (settings, modules, department names)', user_directory: 'Account directory (names, e-mails, roles, status)' };
const badge = (s: string) => (s === 'approved' ? 'status-active' : s === 'requested' ? 'status-submitted' : s === 'expired' ? 'status-inactive' : 'status-rejected');

// The fellowship's side of platform support: decide who may look at what, and for how long.
export default function SupportAccess() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => axios.get('/support/grants', { withCredentials: true }).then((r) => { setRows(r.data); setError(''); }).catch((e) => setError(errMsg(e, 'Could not load support requests')));
  useEffect(() => { load(); }, []);
  const act = async (id: string, path: string, body: object = {}) => {
    setBusy(id);
    try { await axios.post(`/support/grants/${id}/${path}`, body, { withCredentials: true }); await load(); } catch (e) { alert(errMsg(e, 'That did not work')); } finally { setBusy(''); }
  };
  return (
    <div className="mx-auto max-w-4xl">
      <div className="page-header">
        <div><h1 className="page-title">Support access</h1><p className="page-desc">The platform support team can only look at your fellowship if you allow it. Access is read-only, limited to what is listed, expires on its own, and you can end it at any time. Members, finances and other records are never included.</p></div>
      </div>
      {error ? <Empty text={error} /> : !rows ? <Spinner /> : rows.length === 0 ? <Empty text="No support requests" /> : (
        <div className="space-y-3">
          {rows.map((g) => (
            <div key={g.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">{g.requestedByName} <span className="text-sm font-normal text-ink-muted">· {new Date(g.createdAt).toLocaleString()}</span></p>
                  <p className="mt-1 text-sm text-ink">“{g.reason}”</p>
                  <ul className="mt-2 list-disc pl-5 text-sm text-ink-muted">{g.scopes.map((s: string) => <li key={s}>{SCOPE[s] || s}</li>)}</ul>
                  <p className="mt-1 text-xs text-ink-subtle">{g.durationMinutes} minutes once approved{g.status === 'approved' && g.expiresAt ? ` · until ${new Date(g.expiresAt).toLocaleTimeString()}` : ''}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`status-badge ${badge(g.status)} capitalize`}>{g.status}</span>
                  {g.status === 'requested' && <div className="space-x-2"><button className="btn btn-primary btn-sm" disabled={busy === g.id} onClick={() => act(g.id, 'decide', { decision: 'approve' })}>Approve</button><button className="btn btn-secondary btn-sm" disabled={busy === g.id} onClick={() => act(g.id, 'decide', { decision: 'deny' })}>Decline</button></div>}
                  {g.status === 'approved' && <button className="btn btn-danger btn-sm" disabled={busy === g.id} onClick={() => window.confirm('End this access now?') && act(g.id, 'revoke')}>End access now</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
