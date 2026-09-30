import { useState } from 'react';
import { Modal } from '../finance/common';

export interface CreatedAccount {
  id: string;
  email: string;
  roles: string[];
  temporaryPassword: string;
  /** True for a role seat nobody holds yet: its address is a placeholder the administrator is expected to edit. */
  isPlaceholder: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  secretary: 'Secretary',
  assistant_secretary: 'Assistant Secretary',
  chairperson: 'Chairperson',
  assistant_chairperson: 'Assistant Chairperson',
  treasurer: 'Treasurer',
  it_admin: 'IT Administrator',
  department_secretary: 'Department Secretary',
  department_chairperson: 'Department Chairperson',
  gender_leader: 'Gender Leader',
  ordinary_member: 'Ordinary Member',
};

const labelFor = (role: string) => ROLE_LABELS[role] || role.replace(/_/g, ' ');

// The handover for a whole fellowship rather than a single account: approving a request creates every default role
// at once, and the operator has to be able to walk away with all of them, not one at a time. Nothing here is
// persisted - closing the dialog discards every password, and the server will not return them again.
export default function CredentialsModal({
  title, accounts, note, fellowship, subdomain, outstandingRoles, onClose,
}: {
  title: string;
  accounts: CreatedAccount[];
  note?: string;
  fellowship?: string;
  subdomain?: string;
  outstandingRoles?: string[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const write = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); } catch { /* clipboard unavailable: values stay visible to copy by hand */ }
  };
  const copyAll = () => write(
    accounts.map((a) => `${a.email}  (${a.roles.map(labelFor).join(', ')})\n  password: ${a.temporaryPassword}`).join('\n'),
    'all',
  );
  // The single most useful framing for a new fellowship: one line per role, address and password together.
  const copyAsTable = () => write(
    ['role,email,temporary password', ...accounts.map((a) => `${a.roles.map(labelFor).join(' + ')},${a.email},${a.temporaryPassword}`)].join('\n'),
    'table',
  );

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {note || 'Copy these temporary passwords now. Each is shown only once and must be changed at first sign-in.'}
        </p>

        {fellowship && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            <div><span className="font-medium">{fellowship}</span></div>
            {subdomain && (
              <div className="mt-1 text-slate-600">
                Public site: <span className="font-mono">{subdomain}</span> - not published yet. Turn it on from
                the fellowship's settings once its content is ready.
              </div>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Temporary password</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map((a) => (
                <tr key={a.id} className={a.isPlaceholder ? 'bg-amber-50/50' : ''}>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-slate-900">{a.roles.map(labelFor).join(', ')}</div>
                    {a.isPlaceholder && <div className="text-xs text-amber-700">Nobody holds this yet</div>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-mono text-xs break-all text-slate-700">{a.email}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      readOnly
                      className="input font-mono text-xs"
                      value={a.temporaryPassword}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => write(a.temporaryPassword, a.id)}>
                      {copied === a.id ? 'Copied' : 'Copy'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {outstandingRoles && outstandingRoles.length > 0 && (
          <p className="text-sm text-slate-600">
            Still to appoint: <span className="font-medium text-slate-900">{outstandingRoles.join(', ')}</span>.
            Edit each highlighted address to the real office holder.
          </p>
        )}

        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={copyAll}>{copied === 'all' ? 'Copied' : 'Copy all'}</button>
          <button type="button" className="btn btn-secondary flex-1" onClick={copyAsTable}>{copied === 'table' ? 'Copied' : 'Copy as CSV'}</button>
        </div>
        <button type="button" className="btn btn-primary w-full" onClick={onClose}>I have saved them</button>
      </div>
    </Modal>
  );
}
