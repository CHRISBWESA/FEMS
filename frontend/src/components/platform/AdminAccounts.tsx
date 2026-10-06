import { useEffect, useState } from 'react';
import axios from 'axios';
import { PlusIcon } from '@heroicons/react/24/outline';
import SecretModal from './SecretModal';
import FormModal from '../resources/FormModal';
import { errMsg } from '../finance/common';
import { DataTable, SearchInput } from '../DataTable';
import { Alert, Button } from '../ui';

/**
 * System (platform) accounts: the people who run FEMS itself rather than a fellowship. They belong to no
 * fellowship, which is why they are listed by their own endpoint and not with tenant accounts.
 *
 * Only a support account can be created here. A platform administrator holds the most powerful role in the
 * system, so those accounts are deliberately provisioned out of band - this screen says so rather than
 * offering a button that would create one.
 */
export default function AdminAccounts({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<null | { email: string; password: string }>(null);
  const [q, setQ] = useState('');

  const load = () =>
    axios
      .get('/platform/staff', { withCredentials: true })
      .then((r) => { setRows(Array.isArray(r.data) ? r.data : []); setError(''); })
      .catch((e) => { setRows([]); setError(errMsg(e, 'Could not load system accounts')); });
  useEffect(() => { load(); }, []);

  const toggle = async (s: any) => {
    setBusy(s.id);
    setError('');
    try {
      await axios.post(`/platform/staff/${s.id}/${s.isActive ? 'deactivate' : 'activate'}`, {}, { withCredentials: true });
      await load();
    } catch (e: any) {
      setError(errMsg(e, 'Could not change the account'));
    } finally {
      setBusy('');
    }
  };

  const filtered = (rows || []).filter((s) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return `${s.firstName} ${s.lastName}`.toLowerCase().includes(needle) || (s.email || '').toLowerCase().includes(needle);
  });

  const body = (
    <>
      {!embedded && (
        <div className="page-header">
          <div>
            <h1 className="page-title">System accounts</h1>
            <p className="page-desc">Accounts that run FEMS itself. They belong to no fellowship and can never see a fellowship's members, finances or other operational data.</p>
          </div>
        </div>
      )}

      <div className="mb-4 rounded-lg bg-canvas p-4 text-sm text-ink-muted ring-1 ring-inset ring-hairline">
        <p>
          <span className="font-semibold text-ink">Platform administrator</span> accounts are provisioned outside
          the application on purpose: they hold the most powerful role in the system, so no in-app button can mint one.
          Support accounts are read-only on the platform and may only <em>request</em> scoped, time-limited access to a
          fellowship.
        </p>
      </div>

      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search name or e-mail…" className="max-w-xs" />
        <Button variant="primary" onClick={() => setCreating(true)}><PlusIcon className="h-4 w-4" /> Add support account</Button>
      </div>

      <DataTable
        columns={[
          { key: 'name', header: 'Name', priority: 'primary', render: (s) => <span className="font-medium text-ink">{s.firstName} {s.lastName}</span> },
          { key: 'email', header: 'E-mail', priority: 'secondary' },
          { key: 'role', header: 'Role', render: (s) => <span className={`status-badge ${s.roles.includes('admin') ? 'status-active' : 'status-submitted'}`}>{s.roles.includes('admin') ? 'Platform administrator' : 'Platform support'}</span> },
          { key: 'status', header: 'Status', render: (s) => <span className={`status-badge ${s.isActive ? 'status-active' : 'status-inactive'}`}>{s.isActive ? 'Active' : 'Inactive'}</span> },
          { key: 'created', header: 'Created', priority: 'meta', render: (s) => <span className="text-xs text-ink-muted">{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}</span> },
        ]}
        rows={rows === null ? undefined : filtered}
        rowKey={(s) => s.id}
        loading={rows === null}
        caption="System accounts"
        empty={{ title: q ? 'No matches' : 'No system accounts' }}
        mobile="scroll"
        rowActions={(s) => {
          // Deactivating a support account also revokes every support grant it requested.
          if (s.roles.includes('platform_support') && !s.roles.includes('admin')) {
            return <Button variant="secondary" size="sm" disabled={busy === s.id} onClick={() => toggle(s)}>{s.isActive ? 'Deactivate' : 'Activate'}</Button>;
          }
          if (s.roles.includes('admin')) return <span className="text-xs text-ink-subtle">Cannot be changed here</span>;
          return null;
        }}
      />

      {creating && (
        <FormModal
          title="Add a support account"
          submitLabel="Create account"
          description="Creates a read-only platform support account. A temporary password is shown once."
          fields={[
            { name: 'firstName', label: 'First name', required: true },
            { name: 'lastName', label: 'Last name', required: true },
            { name: 'email', label: 'E-mail', required: true },
          ]}
          onSubmit={async (v) => {
            const r = await axios.post('/platform/staff', v, { withCredentials: true });
            setSecret({ email: r.data.email, password: r.data.temporaryPassword });
            setCreating(false);
            await load();
          }}
          onClose={() => setCreating(false)}
        />
      )}
      {secret && (
        <SecretModal
          title="Support account created"
          email={secret.email}
          password={secret.password}
          onClose={() => setSecret(null)}
        />
      )}
    </>
  );

  return <div className={embedded ? '' : 'mx-auto max-w-7xl'}>{body}</div>;
}
