import { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import FormModal from '../components/resources/FormModal';
import SecretModal from '../components/platform/SecretModal';
import SubscriptionCard from '../components/platform/SubscriptionCard';
import { Empty, Spinner, errMsg } from '../components/finance/common';

type Dialog = null | 'suspend' | 'reactivate' | 'edit' | 'admin';

export default function PlatformTenant() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const manage = hasPermission('platform.tenants_manage');
  const [t, setT] = useState<any>(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [secret, setSecret] = useState<null | { email: string; password: string }>(null);
  const [busy, setBusy] = useState('');

  const load = () => axios.get(`/platform/tenants/${id}`, { withCredentials: true }).then((r) => { setT(r.data); setError(''); }).catch((e) => setError(e.response?.status === 404 ? 'Fellowship not found.' : errMsg(e, 'Could not load the fellowship')));
  useEffect(() => { load(); }, [id]);

  if (error) return <div className="mx-auto max-w-4xl"><button onClick={() => navigate('/platform')} className="mb-4 text-sm text-ink-muted">← Back</button><Empty text={error} /></div>;
  if (!t) return <Spinner />;

  const toggleModule = async (key: string, enabled: boolean) => {
    setBusy(key);
    try { await axios.put(`/platform/tenants/${id}/modules`, { modules: { [key]: enabled } }, { withCredentials: true }); await load(); } catch (e) { alert(errMsg(e, 'Could not change the module')); } finally { setBusy(''); }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <button onClick={() => navigate('/platform')} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeftIcon className="h-4 w-4" /> Back to Platform</button>

      <div className="card mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.name}</h1>
            <p className="mt-1 text-sm text-ink-muted">{t.location || 'No location'} · created {new Date(t.createdAt).toLocaleDateString()}</p>
            {t.description && <p className="mt-2 text-sm text-ink">{t.description}</p>}
          </div>
          <span className={`status-badge ${t.status === 'active' ? 'status-active' : 'status-rejected'} capitalize`}>{t.status}</span>
        </div>
        {t.status === 'suspended' && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Suspended{t.suspendedAt ? ` on ${new Date(t.suspendedAt).toLocaleDateString()}` : ''}: {t.suspensionReason}. Its users cannot sign in.</p>}
        <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-hairline pt-4 text-sm">
          <div><dt className="text-xs uppercase tracking-wider text-ink-subtle">Accounts</dt><dd className="text-lg font-semibold">{t.counts.users}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-ink-subtle">Members</dt><dd className="text-lg font-semibold">{t.counts.members}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-ink-subtle">Active secretaries</dt><dd className={`text-lg font-semibold ${t.counts.activeSecretaries === 0 ? 'text-rose-700' : ''}`}>{t.counts.activeSecretaries}</dd></div>
        </dl>
        {manage && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-4">
            <button className="btn btn-secondary btn-sm" onClick={() => setDialog('edit')}>Edit details</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setDialog('admin')}>Add administrator</button>
            {t.status === 'active'
              ? <button className="btn btn-danger btn-sm" onClick={() => setDialog('suspend')}>Suspend</button>
              : <button className="btn btn-primary btn-sm" onClick={() => setDialog('reactivate')}>Reactivate</button>}
          </div>
        )}
      </div>

      {hasPermission('platform.billing_view') && <SubscriptionCard fellowshipId={t.id} />}

      <div className="card mb-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Modules</h2>
        <p className="mb-3 text-sm text-ink-muted">A switched-off module is closed to this fellowship's users. Existing data is kept. (A subscription plan can also leave modules out; the platform switch always wins.)</p>
        <ul className="divide-y divide-hairline">
          {t.modules.map((m: any) => (
            <li key={m.key} className="flex items-center justify-between py-2 text-sm">
              <span className="text-slate-800">{m.label}</span>
              {manage ? <button disabled={busy === m.key} className={`btn btn-sm ${m.enabled ? 'btn-secondary' : 'btn-primary'}`} onClick={() => toggleModule(m.key, !m.enabled)}>{m.enabled ? 'Switch off' : 'Switch on'}</button>
                : <span className={m.enabled ? 'text-emerald-700' : 'text-ink-subtle'}>{m.enabled ? 'On' : 'Off'}</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Recent support access</h2>
        {t.supportGrants.length === 0 ? <p className="text-sm text-ink-muted">None.</p> : (
          <ul className="space-y-1 text-sm">{t.supportGrants.map((g: any) => <li key={g.id} className="flex justify-between"><span>{g.scopes.join(', ').replace(/_/g, ' ')}</span><span className="capitalize text-ink-muted">{g.status} · {new Date(g.createdAt).toLocaleDateString()}</span></li>)}</ul>
        )}
      </div>

      {dialog === 'suspend' && <FormModal title="Suspend fellowship" submitLabel="Suspend" description="Every user of this fellowship is signed out at once and cannot sign in until it is reactivated. Data is kept." fields={[{ name: 'reason', label: 'Reason (recorded in the audit trail)', type: 'textarea', required: true }]} onSubmit={async (v) => { await axios.post(`/platform/tenants/${id}/suspend`, { reason: v.reason }, { withCredentials: true }); load(); }} onClose={() => setDialog(null)} />}
      {dialog === 'reactivate' && <FormModal title="Reactivate fellowship" submitLabel="Reactivate" fields={[{ name: 'reason', label: 'Note (optional)', type: 'textarea' }]} onSubmit={async (v) => { await axios.post(`/platform/tenants/${id}/reactivate`, { reason: v.reason || undefined }, { withCredentials: true }); load(); }} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <FormModal title="Edit fellowship" initial={{ name: t.name, location: t.location || '', description: t.description || '' }} fields={[{ name: 'name', label: 'Name', required: true }, { name: 'location', label: 'Location' }, { name: 'description', label: 'Description', type: 'textarea' }]} onSubmit={async (v) => { await axios.put(`/platform/tenants/${id}`, { name: v.name, location: v.location || null, description: v.description || null }, { withCredentials: true }); load(); }} onClose={() => setDialog(null)} />}
      {dialog === 'admin' && <FormModal title="Add tenant account" submitLabel="Create account" description="Creates a fellowship account with a temporary password shown once." initial={{ role: 'secretary' }} fields={[{ name: 'firstName', label: 'First name', required: true }, { name: 'lastName', label: 'Last name', required: true }, { name: 'email', label: 'E-mail', required: true }, { name: 'phone', label: 'Phone' }, { name: 'role', label: 'Role', type: 'select', required: true, options: [{ value: 'secretary', label: 'Secretary' }, { value: 'assistant_secretary', label: 'Assistant Secretary' }, { value: 'chairperson', label: 'Chairperson' }, { value: 'assistant_chairperson', label: 'Assistant Chairperson' }, { value: 'treasurer', label: 'Treasurer' }] }]} onSubmit={async (v) => { const r = await axios.post(`/platform/tenants/${id}/administrators`, { firstName: v.firstName, lastName: v.lastName, email: v.email, phone: v.phone || undefined, roles: [v.role] }, { withCredentials: true }); setSecret({ email: r.data.administrator.email, password: r.data.administrator.temporaryPassword }); load(); }} onClose={() => setDialog(null)} />}
      {secret && <SecretModal title="Administrator created" email={secret.email} password={secret.password} onClose={() => setSecret(null)} />}
    </div>
  );
}
