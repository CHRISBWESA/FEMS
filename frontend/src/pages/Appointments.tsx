import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  IdentificationIcon, UserPlusIcon, ArrowPathIcon, XMarkIcon, CheckIcon,
  ExclamationTriangleIcon, ClockIcon, LinkIcon,
} from '@heroicons/react/24/outline';

/**
 * Appointments: inviting the people who hold the fellowship's offices.
 *
 * This is the fellowship administrator's screen, and it is the step that replaced the old onboarding behaviour of
 * creating six accounts named after the offices. No account is created here either - an invitation is a promise, and
 * the account appears only when the person accepts and chooses their own password.
 *
 * The split the screen makes visible is the whole point of the model: appointing an OFFICER (chairperson, secretary,
 * treasurer) is a different power from appointing an ordinary member, and the second group is greyed out for
 * anybody who does not hold it. That is enforced on the server; showing it here is not security, it is honesty about
 * why a button is disabled.
 */

interface Invitation {
  id: string;
  email: string;
  name: string;
  roles: string[];
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

interface Inviter {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  roles: string[];
}

const EMPTY: Inviter = { email: '', firstName: '', lastName: '', phone: '', roles: [] };

/** Mirrors GOVERNANCE_ROLES on the server. Kept here only to grey out a control early; the server decides. */
const GOVERNANCE = ['chairperson', 'assistant_chairperson', 'secretary', 'assistant_secretary', 'treasurer'];

export default function Appointments() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Both flags come from the signed-in user's OWN permissions, as the server computed them from their roles. The
  // screen greys out a control when it knows it will be refused; the server is what actually decides.
  const [canInvite, setCanInvite] = useState(false);
  const [canAppointOfficers, setCanAppointOfficers] = useState(false);

  const load = useCallback(async () => {
    try {
      const [inv, me] = await Promise.all([
        axios.get('/invitations'),
        axios.get('/profile'),
      ]);
      setInvitations(Array.isArray(inv.data) ? inv.data : []);
      const perms: string[] = me.data?.permissions ?? [];
      setCanInvite(perms.includes('user.role_assign'));
      setCanAppointOfficers(perms.includes('user.role_assign_governance'));
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not load appointments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(''), 5000);
  };

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error) {
    return (
      <div className="card p-6">
        <h1 className="text-lg font-semibold text-slate-900">Appointments</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
      </div>
    );
  }

  const pending = invitations.filter((i) => i.status === 'pending');
  const settled = invitations.filter((i) => i.status !== 'pending');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Appointments</h1>
        <p className="mt-1 text-sm text-slate-500">
          Invite the people who hold your fellowship&rsquo;s offices. An invitation creates no account until the
          person accepts it and chooses their own password.
        </p>
      </div>

      {notice && (
        <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
          <CheckIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{notice}</p>
        </div>
      )}

      {!canInvite && (
        <div className="flex items-start gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-border">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <p>
            You can see who has been invited, but not invite anybody. That belongs to the fellowship administrator.
          </p>
        </div>
      )}

      {canInvite && <InviteForm canAppointOfficers={canAppointOfficers} onDone={load} flash={flash} />}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Invitations{pending.length > 0 && ` (${pending.length} awaiting a reply)`}
        </h2>

        {invitations.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-white px-6 py-12 text-center">
            <IdentificationIcon className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-900">Nobody has been invited yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Invite the people who will hold each office above. A Treasurer and a Secretary are marked required
              because a fellowship cannot run without them; the rest are yours to fill or leave.
            </p>
          </div>
        )}

        {pending.map((i) => (
          <InvitationRow key={i.id} invitation={i} onDone={load} flash={flash} />
        ))}

        {settled.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-500">
              {settled.length} settled invitation{settled.length === 1 ? '' : 's'}
            </summary>
            <div className="mt-3 space-y-2">
              {settled.map((i) => (
                <div key={i.id} className="card flex flex-wrap items-center gap-3 p-4 opacity-75">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{i.name}</p>
                    <p className="truncate text-xs text-slate-500">{i.email}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      i.status === 'accepted'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {i.status}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function InvitationRow({
  invitation,
  onDone,
  flash,
}: {
  invitation: Invitation;
  onDone: () => void;
  flash: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    if (!window.confirm(`Withdraw the invitation to ${invitation.email}? The link will stop working.`)) return;
    setBusy(true);
    try {
      await axios.post(`/invitations/${invitation.id}/revoke`);
      flash('Invitation withdrawn.');
      onDone();
    } catch (e: any) {
      flash(e.response?.data?.message || 'Could not withdraw that invitation.');
    } finally {
      setBusy(false);
    }
  };

  const reissue = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`/invitations/${invitation.id}/reissue`, {});
      flash(`New link created. Share it with ${invitation.email}.`);
      onDone();
      return r;
    } catch (e: any) {
      flash(e.response?.data?.message || 'Could not re-issue that invitation.');
    } finally {
      setBusy(false);
    }
  };

  const daysLeft = Math.ceil((new Date(invitation.expiresAt).getTime() - Date.now()) / 86400000);
  const expiring = daysLeft <= 7;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{invitation.name}</p>
          <p className="truncate text-xs text-slate-500">{invitation.email}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
          <ClockIcon className="h-3.5 w-3.5" />
          {daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'expired'}
        </span>
        <button className="btn btn-secondary btn-sm shrink-0" onClick={reissue} disabled={busy}>
          <ArrowPathIcon className="h-4 w-4" /> New link
        </button>
        <button
          className="btn btn-ghost btn-sm shrink-0 text-rose-600"
          onClick={revoke}
          disabled={busy}
        >
          <XMarkIcon className="h-4 w-4" /> Withdraw
        </button>
      </div>
      {expiring && daysLeft > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          This link expires soon. If the link has not arrived, use &ldquo;New link&rdquo;.
        </p>
      )}
    </div>
  );
}

function InviteForm({
  canAppointOfficers,
  onDone,
  flash,
}: {
  canAppointOfficers: boolean;
  onDone: () => void;
  flash: (m: string) => void;
}) {
  const [form, setForm] = useState<Inviter>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The link is shown once, because the server does not send e-mail. Holding it here is the only chance.
  const [issued, setIssued] = useState<{ email: string; url: string } | null>(null);

  const set = (k: keyof Inviter) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const toggleRole = (role: string) => {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role],
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.roles.length === 0) {
      setError('Choose at least one role for this person.');
      return;
    }
    setBusy(true);
    try {
      const r = await axios.post('/invitations', {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone || undefined,
        roles: form.roles,
      });
      setIssued({ email: form.email, url: `${window.location.origin}${r.data.acceptUrl}` });
      setForm(EMPTY);
      onDone();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not create that invitation.');
    } finally {
      setBusy(false);
    }
  };

  const ordinaryRoles = [
    { role: 'ordinary_member', label: 'Ordinary member' },
    { role: 'gender_leader', label: 'Gender leader' },
    { role: 'department_secretary', label: 'Department secretary' },
    { role: 'department_chairperson', label: 'Department chairperson' },
    { role: 'it_admin', label: 'IT / content manager' },
  ];

  return (
    <div className="card p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <UserPlusIcon className="h-5 w-5 text-primary" /> Invite somebody
      </h2>

      {issued && (
        <div className="mt-4 rounded-lg bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
          <p className="text-sm font-medium text-amber-900">
            Invitation ready for {issued.email}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            No e-mail was sent &mdash; this system has no mail transport. Share the link below over a channel you
            trust. It is shown once.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-white p-2 ring-1 ring-inset ring-amber-600/20">
            <LinkIcon className="h-4 w-4 shrink-0 text-amber-600" />
            <code className="min-w-0 flex-1 truncate text-xs text-slate-800">{issued.url}</code>
            <button
              className="btn btn-secondary btn-sm shrink-0"
              onClick={() => {
                navigator.clipboard?.writeText(issued.url);
                flash('Link copied.');
              }}
            >
              Copy
            </button>
          </div>
          <button className="mt-2 text-xs text-amber-800 underline" onClick={() => setIssued(null)}>
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
          {error}
        </div>
      )}

      <form className="mt-4 space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="i-first" className="label">First name *</label>
            <input id="i-first" required maxLength={80} className="input w-full" value={form.firstName} onChange={set('firstName')} />
          </div>
          <div>
            <label htmlFor="i-last" className="label">Last name *</label>
            <input id="i-last" required maxLength={80} className="input w-full" value={form.lastName} onChange={set('lastName')} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="i-email" className="label">E-mail *</label>
            <input id="i-email" type="email" required maxLength={254} className="input w-full" value={form.email} onChange={set('email')} />
            <p className="mt-1 text-xs text-slate-400">The invitation is only sent to this address by hand.</p>
          </div>
          <div>
            <label htmlFor="i-phone" className="label">Phone</label>
            <input id="i-phone" maxLength={40} className="input w-full" value={form.phone} onChange={set('phone')} />
          </div>
        </div>

        <fieldset>
          <legend className="label">Roles *</legend>

          <p className="mb-2 text-xs text-slate-500">
            Offices carry the fellowship&rsquo;s authority, so appointing one is a separate permission. Holding a role
            never grants the power to appoint it.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {GOVERNANCE.map((role) => {
              const on = form.roles.includes(role);
              return (
                <label
                  key={role}
                  className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
                    canAppointOfficers
                      ? on
                        ? 'border-primary bg-primary-light'
                        : 'border-border hover:bg-slate-50'
                      : 'border-dashed border-border opacity-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={on}
                    disabled={!canAppointOfficers}
                    onChange={() => toggleRole(role)}
                  />
                  <span>
                    <span className="font-medium text-slate-900">{roleLabel(role)}</span>
                    <span className="block text-xs text-slate-500">
                      {canAppointOfficers ? 'Approves money or records.' : 'Only the fellowship administrator can appoint this.'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <p className="mb-2 mt-5 text-xs text-slate-500">Ordinary roles &mdash; anyone with the appointment permission may offer these.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ordinaryRoles.map(({ role, label }) => {
              const on = form.roles.includes(role);
              return (
                <label
                  key={role}
                  className={`flex items-center gap-2.5 rounded-lg border p-3 text-sm ${
                    on ? 'border-primary bg-primary-light' : 'border-border hover:bg-slate-50'
                  }`}
                >
                  <input type="checkbox" className="mr-0.5" checked={on} onChange={() => toggleRole(role)} />
                  <span className="font-medium text-slate-900">{label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <button className="btn btn-primary" disabled={busy}>
          {busy ? <><span className="spinner border-white" /> Creating…</> : <><UserPlusIcon className="h-5 w-5" /> Create invitation</>}
        </button>
      </form>
    </div>
  );
}

/** A readable name for a role key. The role list is not fetched here, so this covers the common ones and falls back. */
function roleLabel(role: string): string {
  return (
    {
      chairperson: 'Chairperson',
      assistant_chairperson: 'Assistant Chairperson',
      secretary: 'Secretary',
      assistant_secretary: 'Assistant Secretary',
      treasurer: 'Treasurer',
    } as Record<string, string>
  )[role] ?? role;
}
