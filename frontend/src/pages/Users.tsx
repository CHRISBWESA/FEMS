import { useState, useEffect } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../App';
import AdminAccounts from '../components/platform/AdminAccounts';
import SecretModal from '../components/platform/SecretModal';
import { Modal } from '../components/finance/common';
import { PageLoader, ConfirmDialog } from '../components/ui';
import {
  UsersIcon, PlusIcon, XMarkIcon, PauseIcon, PlayIcon, UserPlusIcon,
  KeyIcon, PencilSquareIcon, ArrowPathIcon, TrashIcon,
  MagnifyingGlassIcon, ShieldCheckIcon, XCircleIcon,
} from '@heroicons/react/24/outline';

const FALLBACK_ROLES = [
  { name: 'it_admin', description: 'IT Administrator' },
  { name: 'secretary', description: 'Main Secretary' },
  { name: 'assistant_secretary', description: 'Assistant Secretary' },
  { name: 'chairperson', description: 'Chairperson' },
  { name: 'assistant_chairperson', description: 'Assistant Chairperson' },
  { name: 'treasurer', description: 'Treasurer' },
  { name: 'department_secretary', description: 'Department Secretary' },
  { name: 'department_chairperson', description: 'Department Chairperson' },
  { name: 'gender_leader', description: 'Gender Leader' },
  { name: 'ordinary_member', description: 'Ordinary Member' },
];

const emptyForm = {
  email: '',
  firstName: '',
  lastName: '',
  password: '',
  roles: [] as string[],
  memberId: '',
  fellowshipId: '',
};

export default function Users() {
  const { isAdmin, hasRole } = useAuth();
  const isPlatformAccount = hasRole('admin') || hasRole('platform_support');
  const [params, setParams] = useSearchParams();
  // Two kinds of account live in this system and they are not interchangeable: fellowship accounts belong to a
  // tenant and can see that tenant's data, system accounts belong to no fellowship and can never see any.
  const [category, setCategory] = useState<'fellowship' | 'system'>(
    params.get('view') === 'admin' ? 'system' : 'fellowship',
  );
  const switchCategory = (next: 'fellowship' | 'system') => {
    setCategory(next);
    if (next === 'system') setParams({ view: 'admin' });
    else setParams({});
  };
  const [users, setUsers] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [fellowships, setFellowships] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // create user
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...emptyForm, roles: isAdmin() ? ['secretary'] : [] });
  const [newMemberMode, setNewMemberMode] = useState(false);
  const [newMemberGender, setNewMemberGender] = useState('other');

  // roles tab: fellowship scope (admin only)
  const [roleFellowshipId, setRoleFellowshipId] = useState('');

  // edit email
  const [editTarget, setEditTarget] = useState<any>(null);
  const [newEmail, setNewEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // assign role
  const [assignTarget, setAssignTarget] = useState<any>(null);
  const [assignRole, setAssignRole] = useState('');
  const [savingRoles, setSavingRoles] = useState(false);

  const [resettingId, setResettingId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<null | { id: string; name: string; email: string }>(null);
  const [confirmReset, setConfirmReset] = useState<null | { id: string; name: string }>(null);
  // The one-time password from a reset. Held in memory only, and shown in a copyable dialog: an alert box
  // cannot be selected from, so the operator had to write the password down by hand.
  const [resetSecret, setResetSecret] = useState<null | { email: string; password: string; name: string }>(null);
  // Creating a fellowship account on an owner's behalf (platform administrator only).
  const [showOnboardAdmin, setShowOnboardAdmin] = useState(false);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [onboardSecret, setOnboardSecret] = useState<null | { email: string; password: string }>(null);

  const createAdministrator = async (v: any) => {
    setOnboardBusy(true);
    setError('');
    try {
      const r = await axios.post(
        `/platform/tenants/${v.fellowshipId}/administrators`,
        { firstName: v.firstName, lastName: v.lastName, email: v.email, phone: v.phone || undefined, roles: [v.role] },
        { withCredentials: true },
      );
      setOnboardSecret({ email: r.data.administrator.email, password: r.data.administrator.temporaryPassword });
      setShowOnboardAdmin(false);
      fetchUsers();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not create the account');
    } finally {
      setOnboardBusy(false);
    }
  };
  const [allRoles, setAllRoles] = useState<any[]>(FALLBACK_ROLES);

  // roles view
  const [view, setView] = useState<'accounts' | 'roles'>('accounts');
  const [selectedRole, setSelectedRole] = useState<string>('secretary');
  const [roleAssignPick, setRoleAssignPick] = useState('');
  const [newAccountEmail, setNewAccountEmail] = useState('');
  const [newAccountPassword, setNewAccountPassword] = useState('');
  const [roleWorking, setRoleWorking] = useState(false);

  // Admin manages secretaries only; secretary manages all non-admin roles.
  const roleOptions = isAdmin()
    ? allRoles.filter((r) => r.name === 'secretary')
    : allRoles.filter((r) => !['admin', 'platform_support', 'secretary', 'treasurer', 'chairperson', 'assistant_chairperson'].includes(r.name));
  const roleLabel = (name: string) =>
    allRoles.find((r) => r.name === name)?.description || name.replace(/_/g, ' ');

  // Users holding a given role
  const holdersOf = (roleName: string) => users.filter((u) => u.roles?.includes(roleName));
  // Candidates that can be assigned a role: existing accounts without it, or members without an account
  const candidatesFor = (roleName: string) => ({
    users: users.filter((u) => !u.roles?.includes(roleName) && !(isAdmin() && roleName === 'admin')),
    members: members.filter(
      (m) => !m.user_id && (!isAdmin() || !roleFellowshipId || m.fellowship_id === roleFellowshipId),
    ),
  });

  const generateTempPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let out = '';
    for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };

  const assignMemberToRole = async (roleName: string, pick: string) => {
    if (!pick) return;
    if (isAdmin() && !roleFellowshipId) {
      setError('Select a fellowship first');
      return;
    }
    setRoleWorking(true);
    setError('');
    try {
      if (pick.startsWith('user:')) {
        const userId = pick.slice(5);
        const u = users.find((x) => x.id === userId);
        const newRoles = Array.from(new Set([...(u.roles || []), roleName]));
        await axios.put(`/users/${userId}/roles`, { roles: newRoles }, { withCredentials: true });
      } else if (pick.startsWith('member:')) {
        const m = members.find((x) => x.id === pick.slice(7));
        if (!m) throw new Error('Member not found');
        const password = newAccountPassword.trim() || generateTempPassword();
        const parts = (m.full_name || '').trim().split(/\s+/);
        await axios.post('/users', {
          email: newAccountEmail.trim(),
          firstName: parts[0] || '',
          lastName: parts.slice(1).join(' ') || '',
          password,
          memberId: m.id,
          roles: [roleName],
          fellowshipId: isAdmin() ? roleFellowshipId : undefined,
        }, { withCredentials: true });
        window.alert(`Account created for ${m.full_name} with the ${roleLabel(roleName)} role.\n\nTemporary password: ${password}\n\nShare it with them � they must change it on login.`);
        setNewAccountEmail('');
        setNewAccountPassword('');
      }
      setRoleAssignPick('');
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to assign role');
    } finally {
      setRoleWorking(false);
    }
  };

  const unassignUserRole = async (u: any, role: string) => {
    const reason = prompt(`Request removal of "${roleLabel(role)}" from ${u.first_name} ${u.last_name}? This requires chairperson approval.\n\nReason:`);
    if (!reason) return;
    try {
      await axios.post(`/users/${u.id}/request-role-removal`, { role, reason }, { withCredentials: true });
      alert('Unassignment requested � it takes effect once the chairperson approves it.');
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to request unassignment');
    }
  };

  // A platform account is blocked from /members by design (members are a fellowship's operational data), so the
  // member list is only ever requested by a tenant role. Asking anyway produced a 403 that was swallowed and
  // rendered as an empty page.
  const fetchMembers = () => {
    if (isAdmin()) { setMembers([]); return Promise.resolve(); }
    return axios.get('/members?limit=1000', { withCredentials: true })
      .then(res => setMembers(res.data?.data || []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchUsers();
    fetchMembers();
    axios.get('/users/roles/list', { withCredentials: true })
      .then(res => { if (Array.isArray(res.data) && res.data.length) setAllRoles(res.data); })
      .catch(() => {});
    if (isAdmin()) {
      axios.get('/fellowships?limit=200', { withCredentials: true })
        .then(res => setFellowships(res.data?.data || []))
        .catch(() => {});
    }
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/users?limit=100', { withCredentials: true });
      setUsers(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const filtered = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      `${u.first_name} ${u.last_name}`.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.member?.full_name?.toLowerCase().includes(q) ||
      u.member?.member_code?.toLowerCase().includes(q)
    );
  });

  // When a member is picked, prefill their details from the member record.
  const pickMember = (memberId: string) => {
    setForm((f) => {
      const next = { ...f, memberId };
      if (memberId) {
        const m = members.find((x) => x.id === memberId);
        if (m) {
          const parts = (m.full_name || '').trim().split(/\s+/);
          next.firstName = parts[0] || '';
          next.lastName = parts.slice(1).join(' ') || '';
          if (m.email) next.email = m.email;
        }
      }
      return next;
    });
  };

  const toggleRole = (role: string) => {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role)
        ? f.roles.filter((r) => r !== role)
        : [...f.roles, role],
    }));
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      if (isAdmin() && !form.fellowshipId) {
        throw new Error('Select a fellowship first');
      }

      let memberId = form.memberId;
      if (isAdmin() && newMemberMode) {
        const fullName = `${form.firstName} ${form.lastName}`.trim();
        if (!fullName) {
          throw new Error('First and last name are required to create the member');
        }
        const currentYear = new Date().getFullYear();
        const memberRes = await axios.post('/members', {
          fullName,
          gender: newMemberGender,
          expectedGraduationYear: currentYear + 4,
          expectedGraduationMonth: 6,
          fellowshipId: form.fellowshipId,
        }, { withCredentials: true });
        memberId = memberRes.data.id;
      }

      await axios.post('/users', {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        password: form.password,
        roles: form.roles.length ? form.roles : ['ordinary_member'],
        memberId: memberId || undefined,
        fellowshipId: isAdmin() ? form.fellowshipId : undefined,
      }, { withCredentials: true });

      setShowCreate(false);
      setForm({ ...emptyForm, roles: isAdmin() ? ['secretary'] : [] });
      setNewMemberMode(false);
      setNewMemberGender('other');
      fetchUsers();
      fetchMembers();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const setActive = async (id: string, isActive: boolean) => {
    try {
      await axios.put(`/users/${id}/${isActive ? 'activate' : 'deactivate'}`, {}, { withCredentials: true });
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed');
    }
  };

  const deleteUser = (u: any) => setConfirmDelete({ id: u.id, name: `${u.first_name} ${u.last_name}`, email: u.email });

  const confirmDeleteAction = async () => {
    if (!confirmDelete) return;
    try {
      await axios.delete(`/users/${confirmDelete.id}`, { withCredentials: true });
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete user');
    } finally {
      setConfirmDelete(null);
    }
  };

  const submitAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTarget || !assignRole) return;
    setSavingRoles(true);
    try {
      const newRoles = Array.from(new Set([...(assignTarget.roles || []), assignRole]));
      await axios.put(`/users/${assignTarget.id}/roles`, { roles: newRoles }, { withCredentials: true });
      setAssignTarget(null);
      setAssignRole('');
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to assign role');
    } finally {
      setSavingRoles(false);
    }
  };

  const resetPassword = (u: any) => setConfirmReset({ id: u.id, name: `${u.first_name} ${u.last_name}` });

  const confirmResetAction = async () => {
    if (!confirmReset) return;
    setResettingId(confirmReset.id);
    try {
      const res = await axios.post('/auth/reset-password', { targetUserId: confirmReset.id }, { withCredentials: true });
      const tempPassword = res.data?.temporaryPassword || res.data?.data?.temporaryPassword;
      if (!tempPassword) {
        alert('The password was reset, but no temporary password was returned. Ask the user to use "Forgot password" on the sign-in page.');
        return;
      }
      // We need the email and name for the secret dialog - fetch or store them
      const user = users.find((usr) => usr.id === confirmReset.id);
      if (user) {
        setResetSecret({ email: user.email, password: tempPassword, name: confirmReset.name });
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to reset password');
    } finally {
      setResettingId('');
      setConfirmReset(null);
    }
  };

  const saveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setError('');
    setSavingEmail(true);
    try {
      await axios.put(`/users/${editTarget.id}`, { email: newEmail }, { withCredentials: true });
      setEditTarget(null);
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update email');
    } finally {
      setSavingEmail(false);
    }
  };

  const initials = (u: any) =>
    `${(u.first_name || '')[0] || ''}${(u.last_name || '')[0] || ''}`.toUpperCase() || 'U';

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-desc">
            {category === 'system'
              ? 'Accounts that run FEMS itself. They belong to no fellowship and never see a fellowship�s members, finances or other operational data.'
              : isAdmin()
                ? 'Fellowship accounts across the platform. Create one on an owner�s behalf below; a whole new fellowship is created from Platform � Fellowships.'
                : 'Manage account access. Every account belongs to a member.'}
          </p>
        </div>
        {category === 'fellowship' && (
          isAdmin() ? (
            /* Creating a fellowship account for an owner who cannot self-signup: a phone request, or no e-mail
               access. The temporary password is shown once, in a copyable dialog. */
            <button onClick={() => setShowOnboardAdmin(true)} className="btn btn-primary" disabled={fellowships.length === 0}>
              <PlusIcon className="h-4 w-4" />
              Add administrator
            </button>
          ) : (
            <button
              onClick={() => {
                setError('');
                setForm({ ...emptyForm, roles: [] });
                setNewMemberMode(false);
                setNewMemberGender('other');
                setShowCreate(true);
              }}
              className="btn btn-primary"
            >
              <PlusIcon className="h-4 w-4" />
              Add User
            </button>
          )
        )}
      </div>

      {/* The two account categories. System accounts are only reachable by platform roles. */}
      <div className="tabs mb-4 sm:w-80">
        <button onClick={() => switchCategory('fellowship')} className={`tab ${category === 'fellowship' ? 'tab-active' : ''}`}>
          Fellowship accounts
        </button>
        <button
          onClick={() => switchCategory('system')}
          disabled={!isPlatformAccount}
          title={isPlatformAccount ? '' : 'System accounts are managed by platform roles only'}
          className={`tab ${category === 'system' ? 'tab-active' : ''}`}
        >
          System accounts
        </button>
      </div>

      {category === 'system' ? (
        isPlatformAccount ? (
          <AdminAccounts embedded />
        ) : (
          <div className="empty-state">
            <div className="stat-icon bg-surface-sunken text-ink-subtle"><ShieldCheckIcon className="h-6 w-6" /></div>
            <p className="empty-title">Not available to your role</p>
            <p className="empty-desc">System accounts are managed by platform roles only.</p>
          </div>
        )
      ) : (
      <>
      {/* The role-first view is not shown to a platform administrator: it is read-only for that role, and
          role changes happen per person from the Accounts list below. A Secretary still gets it, because it is
          where they see coverage across their own congregation. */}
      {!isAdmin() && (
        <div className="tabs mb-4 sm:w-64">
          <button onClick={() => setView('accounts')} className={`tab ${view === 'accounts' ? 'tab-active' : ''}`}>
            Accounts
          </button>
          <button onClick={() => setView('roles')} className={`tab ${view === 'roles' ? 'tab-active' : ''}`}>
            Roles
          </button>
        </div>
      )}

      {(view === 'accounts' || isAdmin()) && (
      <>
      <div className="relative mb-4">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
        <input
          type="text"
          placeholder="Search by name, email or member�"
          className="input pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <PageLoader rows={2} />
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-surface-sunken text-ink-subtle">
            <UsersIcon className="h-6 w-6" />
          </div>
        <p className="empty-title">{search ? 'No matches' : isAdmin() ? 'No fellowship administrators yet' : 'No users found'}</p>
        <p className="empty-desc">
          {search
            ? 'Try a different search.'
            : isAdmin()
              // A platform administrator sees fellowship secretaries across every fellowship. Platform and support
              // accounts are managed on the Platform screen, not here.
              ? 'This list shows the fellowship administrators (Secretaries) of every fellowship on the platform. Use "Add administrator" to create one, or open a fellowship on the Platform screen.'
              : 'Create an account to get started.'}
        </p>
        </div>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Roles</th>
                <th>Member</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u: any) => {
                const isSelfAdminRow = u.roles?.includes('admin');
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="avatar h-8 w-8 text-xs">{initials(u)}</div>
                        <span className="font-medium text-ink">
                          {u.first_name} {u.last_name}
                        </span>
                      </div>
                    </td>
                    <td className="text-ink-muted">{u.email}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        {(u.roles || []).map((role: string) => (
                          <span key={role} className={`status-badge inline-flex items-center gap-1 ${isSelfAdminRow ? 'status-final' : 'status-submitted'}`}>
                            {roleLabel(role)}
                            {/* Role changes are the fellowship's own business: a platform administrator neither
                                assigns nor removes them. */}
                            {!isSelfAdminRow && !isAdmin() && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); unassignUserRole(u, role); }}
                                title={`Remove ${roleLabel(role)} (chairperson approval)`}
                                className="text-ink-subtle transition-colors hover:text-rose-600"
                              >
                                <XMarkIcon className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="text-ink-muted">
                      {u.member
                        ? <span>{u.member.full_name} <span className="font-mono text-xxs text-ink-subtle">({u.member.member_code})</span></span>
                        : '�'}
                    </td>
                    <td>
                      <span className={`status-badge ${u.is_active === false ? 'status-inactive' : 'status-active'}`}>
                        {u.is_active === false ? 'Inactive' : 'Active'}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* A platform administrator no longer hands out a fellowship's job titles: the
                            fellowship's own Secretary does that, and the administrator can enter the fellowship
                            as one of its users if something needs fixing. Hiding the control stops it being a
                            button that can only fail. */}
                        {isAdmin() ? (
                          <span
                            title="A fellowship's roles are assigned by that fellowship's own Secretary"
                            className="cursor-not-allowed text-ink-subtle"
                          >
                            <ShieldCheckIcon className="h-4 w-4" />
                          </span>
                        ) : (
                          <button onClick={() => { setAssignTarget(u); setAssignRole(''); }} title="Assign role" className="btn btn-icon">
                            <ShieldCheckIcon className="h-4 w-4" />
                          </button>
                        )}
                        <button onClick={() => resetPassword(u)} disabled={resettingId === u.id} title="Reset password" className="btn btn-icon">
                          <ArrowPathIcon className="h-4 w-4" />
                        </button>
                        <button onClick={() => { setNewEmail(u.email); setEditTarget(u); }} title="Edit email" className="btn btn-icon">
                          <PencilSquareIcon className="h-4 w-4" />
                        </button>
                        {u.is_active === false ? (
                          <button onClick={() => setActive(u.id, true)} title="Activate" className="btn btn-icon text-success">
                            <PlayIcon className="h-4 w-4" />
                          </button>
                        ) : (
                          <button onClick={() => setActive(u.id, false)} title="Deactivate" className="btn btn-icon text-amber-600">
                            <PauseIcon className="h-4 w-4" />
                          </button>
                        )}
                        {!isSelfAdminRow && (
                          <button onClick={() => deleteUser(u)} title="Delete" className="btn btn-icon text-rose-600">
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}

      {view === 'roles' && (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Role list */}
          <div className="space-y-2 lg:col-span-1">
            {roleOptions.map((role) => {
              const holders = holdersOf(role.name).length;
              return (
                <button
                  key={role.name}
                  onClick={() => { setSelectedRole(role.name); setRoleAssignPick(''); }}
                  className={`card card-hover block w-full text-left ${selectedRole === role.name ? 'ring-2 ring-primary' : ''}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold capitalize text-ink">{roleLabel(role.name)}</h3>
                      <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">{role.description || ''}</p>
                    </div>
                    <span className={`status-badge ${holders > 0 ? 'status-active' : 'status-inactive'}`}>
                      {holders} holder{holders === 1 ? '' : 's'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected role detail */}
          <div className="lg:col-span-2">
            {(() => {
              const role = roleOptions.find((r) => r.name === selectedRole) || roleOptions[0];
              if (!role) return null;
              const holders = holdersOf(role.name);
              const cands = candidatesFor(role.name);
              const isMemberPick = roleAssignPick.startsWith('member:');
              return (
                <div className="space-y-4">
                  <div className="card">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-hairline pb-4">
                      <div>
                        <h2 className="text-lg font-semibold text-ink">{roleLabel(role.name)}</h2>
                        <p className="mt-0.5 text-sm text-ink-muted">{role.description}</p>
                      </div>
                      <span className={`status-badge ${holders.length > 0 ? 'status-active' : 'status-inactive'}`}>
                        {holders.length} holder{holders.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    {/* Role assignment. A platform administrator gets the read-only explanation instead, so the
                        fellowship selector - which only ever scoped the assign picker - is hidden for them too. */}
                    <div className="mb-5 rounded-lg bg-canvas p-4 ring-1 ring-inset ring-hairline">
                      {!isAdmin() && (
                        <div className="mb-3">
                          <label className="label">Fellowship</label>
                          <select
                            className="select"
                            value={roleFellowshipId}
                            onChange={(e) => { setRoleFellowshipId(e.target.value); setRoleAssignPick(''); }}
                          >
                            <option value="">Select a fellowship�</option>
                            {fellowships.map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {/* A platform administrator no longer assigns fellowship roles at all, so for that role this
                          whole block is replaced by an explanation instead of a control that can only fail. */}
                      {isAdmin() ? (
                        <div className="rounded-lg bg-canvas p-4 ring-1 ring-inset ring-hairline">
                          <p className="text-sm font-medium text-ink">Read-only for a platform administrator</p>
                          <p className="mt-1 text-sm text-ink-muted">
                            A fellowship&rsquo;s roles are assigned by that fellowship&rsquo;s own Secretary. To help
                            with something inside a fellowship, use <span className="font-medium">Platform &rsaquo; Impersonation</span>{' '}
                            to sign in as one of its users.
                          </p>
                        </div>
                      ) : (
                      <>
                      <label className="label">Assign a member this role</label>
                      <select
                        className="select"
                        value={roleAssignPick}
                        onChange={(e) => {
                          setRoleAssignPick(e.target.value);
                          const pick = e.target.value;
                          if (pick.startsWith('member:')) {
                            const m = members.find((x) => x.id === pick.slice(7));
                            if (m?.email) setNewAccountEmail(m.email);
                          } else {
                            setNewAccountEmail('');
                          }
                          setNewAccountPassword('');
                        }}
                      >
                        <option value="">Select a person�</option>
                        <optgroup label="Existing accounts without this role">
                          {cands.users.map((u) => (
                            <option key={u.id} value={`user:${u.id}`}>{u.first_name} {u.last_name} ({u.email})</option>
                          ))}
                        </optgroup>
                        <optgroup label="Members without an account (creates one)">
                          {cands.members.map((m) => (
                            <option key={m.id} value={`member:${m.id}`}>{m.full_name} ({m.member_code})</option>
                          ))}
                        </optgroup>
                      </select>

                      {isMemberPick && (
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className="label">Account email *</label>
                            <input
                              type="email"
                              required
                              className="input"
                              placeholder="name@example.com"
                              value={newAccountEmail}
                              onChange={(e) => setNewAccountEmail(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="label">Temporary password</label>
                            <input
                              type="text"
                              className="input"
                              placeholder="Auto-generated if left blank"
                              value={newAccountPassword}
                              onChange={(e) => setNewAccountPassword(e.target.value)}
                            />
                          </div>
                        </div>
                      )}

                      <button
                        disabled={!roleAssignPick || roleWorking || (isMemberPick && !newAccountEmail.trim())}
                        onClick={() => assignMemberToRole(role.name, roleAssignPick)}
                        className="btn btn-primary btn-sm mt-3"
                      >
                        {roleWorking ? <span className="spinner border-white" /> : <UserPlusIcon className="h-4 w-4" />}
                        Assign {roleLabel(role.name)}
                      </button>
                      {isMemberPick && !newAccountEmail.trim() && (
                        <p className="mt-1.5 text-xs text-rose-500">An email is required to create the account.</p>
                      )}
                      </>
                      )}
                    </div>

                    {/* Holders */}
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">Holders</h3>
                    {holders.length === 0 ? (
                      <p className="py-4 text-sm text-ink-muted">No one holds this role yet.</p>
                    ) : (
                      <ul className="divide-y divide-hairline">
                        {holders.map((u) => (
                          <li key={u.id} className="flex items-center justify-between py-2.5">
                            <div className="flex items-center gap-3">
                              <div className="avatar h-8 w-8 text-xs">{initials(u)}</div>
                              <div>
                                <p className="text-sm font-medium text-ink">{u.first_name} {u.last_name}</p>
                                <p className="text-xs text-ink-subtle">{u.email}{u.member ? ` � ${u.member.member_code}` : ''}</p>
                              </div>
                            </div>
                            {/* Unassigning is a role change too, so it is hidden from a platform administrator
                                for the same reason the assign control is. */}
                            {!u.roles?.includes('admin') && !isAdmin() && (
                              <button
                                onClick={() => unassignUserRole(u, role.name)}
                                title="Unassign role (chairperson approval required)"
                                className="btn btn-secondary btn-sm text-rose-600"
                              >
                                <XCircleIcon className="h-4 w-4" />
                                Unassign
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Create user */}
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form onSubmit={createUser} onClick={(e) => e.stopPropagation()} className="modal max-w-lg">
            <ModalHeader
              title="Add User"
              desc="Give a member access to the system."
              onClose={() => setShowCreate(false)}
              icon={<UserPlusIcon className="h-5 w-5" />}
            />

            {error && showCreate && (
              <div className="alert alert-danger mb-4 py-2.5" role="alert">
                {error}
              </div>
            )}

            <div className="space-y-4">
              {isAdmin() && (
                <div>
                  <label className="label">Fellowship *</label>
                  <select
                    required
                    className="select"
                    value={form.fellowshipId}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, fellowshipId: e.target.value, memberId: '' }));
                      setNewMemberMode(false);
                    }}
                  >
                    <option value="">Select a fellowship�</option>
                    {fellowships.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="label">Member *</label>
                <select
                  required={!newMemberMode}
                  disabled={isAdmin() && !form.fellowshipId}
                  className="select"
                  value={newMemberMode ? '__new__' : form.memberId}
                  onChange={(e) => {
                    if (e.target.value === '__new__') {
                      setNewMemberMode(true);
                      setForm((f) => ({ ...f, memberId: '' }));
                    } else {
                      setNewMemberMode(false);
                      pickMember(e.target.value);
                    }
                  }}
                >
                  <option value="">Select a member�</option>
                  {members
                    .filter((m) => !m.user_id && (!isAdmin() || !form.fellowshipId || m.fellowship_id === form.fellowshipId))
                    .map((m) => (
                      <option key={m.id} value={m.id}>{m.full_name} ({m.member_code})</option>
                    ))}
                  {isAdmin() && form.fellowshipId && <option value="__new__">+ Create new member�</option>}
                </select>
                {form.memberId && !newMemberMode && (
                  <p className="mt-1 text-xs text-ink-subtle">Details prefilled from the member record.</p>
                )}
                {isAdmin() && !form.fellowshipId && (
                  <p className="mt-1 text-xs text-ink-subtle">Select a fellowship first.</p>
                )}
                {newMemberMode && (
                  <p className="mt-1 text-xs text-ink-subtle">
                    A member record will be created from the first/last name below, then linked to this account.
                  </p>
                )}
              </div>

              {newMemberMode && (
                <div className="rounded-lg bg-canvas p-3 ring-1 ring-inset ring-hairline">
                  <label className="label">New member gender *</label>
                  <select
                    required
                    className="select max-w-xs"
                    value={newMemberGender}
                    onChange={(e) => setNewMemberGender(e.target.value)}
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">First name *</label>
                  <input type="text" required className="input" value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                </div>
                <div>
                  <label className="label">Last name *</label>
                  <input type="text" required className="input" value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                </div>
                <div>
                  <label className="label">Email *</label>
                  <input type="email" required className="input" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div>
                  <label className="label">Temporary password *</label>
                  <input type="password" required minLength={8} className="input" value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="label">Roles</label>
                <div className="flex flex-wrap gap-2">
                  {roleOptions.map((role) => {
                    const checked = form.roles.includes(role.name);
                    return (
                      <button
                        key={role.name}
                        type="button"
                        onClick={() => toggleRole(role.name)}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                          checked
                            ? 'border-primary bg-primary-light font-medium text-primary-dark'
                            : 'border-hairline bg-white text-ink-muted hover:bg-canvas'
                        }`}
                      >
                        {role.description || role.name.replace(/_/g, ' ')}
                      </button>
                    );
                  })}
                </div>
                {form.roles.length === 0 && (
                  <p className="mt-1.5 text-xs text-ink-subtle">Defaults to Ordinary Member.</p>
                )}
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={creating} className="btn btn-primary flex-1">
                {creating ? <span className="spinner border-white" /> : 'Create User'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit email */}
      {editTarget && (
        <div className="modal-backdrop" onClick={() => setEditTarget(null)}>
          <form onSubmit={saveEmail} onClick={(e) => e.stopPropagation()} className="modal max-w-md">
            <ModalHeader
              title="Edit Email"
              desc={`${editTarget.first_name} ${editTarget.last_name}`}
              onClose={() => setEditTarget(null)}
              icon={<KeyIcon className="h-5 w-5" />}
            />
            <label className="label">Email address</label>
            <input
              type="email"
              required
              className="input"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@example.com"
            />
            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={savingEmail} className="btn btn-primary flex-1">
                {savingEmail ? <span className="spinner border-white" /> : 'Save'}
              </button>
              <button type="button" onClick={() => setEditTarget(null)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Assign role */}
      {showOnboardAdmin && isAdmin() && (
        <Modal title="Add a fellowship account" onClose={() => setShowOnboardAdmin(false)} max="max-w-lg">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget as any);
              createAdministrator(Object.fromEntries(f.entries() as any));
            }}
            className="space-y-4"
          >
            <p className="rounded-lg bg-canvas p-3 text-sm text-ink-muted ring-1 ring-inset ring-hairline">
              For an owner who cannot request access themselves. This creates the account inside an existing
              fellowship; a <em>new</em> fellowship is created from Platform � Fellowships. A temporary password is
              shown once, and the account must change it at first sign-in.
            </p>
            <div>
              <label className="label">Fellowship *</label>
              <select name="fellowshipId" required className="select w-full" defaultValue="">
                <option value="" disabled>Select a fellowship�</option>
                {fellowships.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">First name *</label>
                <input name="firstName" required className="input w-full" />
              </div>
              <div>
                <label className="label">Last name *</label>
                <input name="lastName" required className="input w-full" />
              </div>
            </div>
            <div>
              <label className="label">E-mail address *</label>
              <input name="email" type="email" required className="input w-full" placeholder="owner@fellowship.org" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input name="phone" className="input w-full" />
            </div>
            <div>
              <label className="label">Role *</label>
              <select name="role" required className="select w-full" defaultValue="secretary">
                <option value="secretary">Secretary � runs the fellowship</option>
                <option value="assistant_secretary">Assistant Secretary</option>
                <option value="chairperson">Chairperson � approvals and oversight</option>
                <option value="assistant_chairperson">Assistant Chairperson</option>
                <option value="treasurer">Treasurer � money</option>
                <option value="it_admin">IT Administrator � runs the instance and dashboard content</option>
              </select>
              <p className="mt-1 text-xs text-ink-subtle">
                Platform roles cannot be assigned here. The first account for a new fellowship is created with
                Platform � Fellowships � Onboard fellowship.
              </p>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={onboardBusy} className="btn btn-primary flex-1">
                {onboardBusy ? <span className="spinner border-white" /> : 'Create account'}
              </button>
              <button type="button" onClick={() => setShowOnboardAdmin(false)} className="btn btn-secondary flex-1">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {onboardSecret && (
        <SecretModal
          title="Fellowship account created"
          email={onboardSecret.email}
          password={onboardSecret.password}
          note="Copy this temporary password and send it to the owner through a secure channel. It is shown only once, and they must change it at first sign-in."
          onClose={() => setOnboardSecret(null)}
        />
      )}

      {resetSecret && (
        <SecretModal
          title={`Password reset for ${resetSecret.name}`}
          email={resetSecret.email}
          password={resetSecret.password}
          note="Copy this temporary password and send it to the user through a secure channel. It is shown only once, and they must change it at first sign-in."
          onClose={() => setResetSecret(null)}
        />
      )}

      {assignTarget && (
        <div className="modal-backdrop" onClick={() => setAssignTarget(null)}>
          <form onSubmit={submitAssignRole} onClick={(e) => e.stopPropagation()} className="modal max-w-md">
            <ModalHeader
              title="Assign Role"
              desc={`${assignTarget.first_name} ${assignTarget.last_name} currently holds: ${(assignTarget.roles || []).map(roleLabel).join(', ') || 'none'}`}
              onClose={() => setAssignTarget(null)}
              icon={<ShieldCheckIcon className="h-5 w-5" />}
            />
            <label className="label">Role to add *</label>
            <select required className="select" value={assignRole} onChange={(e) => setAssignRole(e.target.value)}>
              <option value="">Select a role�</option>
              {roleOptions
                .filter((r) => !(assignTarget.roles || []).includes(r.name))
                .map((r) => (
                  <option key={r.name} value={r.name}>{r.description || r.name.replace(/_/g, ' ')}</option>
                ))}
            </select>
            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={savingRoles} className="btn btn-primary flex-1">
                {savingRoles ? <span className="spinner border-white" /> : 'Assign Role'}
              </button>
              <button type="button" onClick={() => setAssignTarget(null)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      </>
      )}
      {confirmDelete && (
        <ConfirmDialog
          open
          title="Delete account"
          message={`Delete the account for ${confirmDelete.name} (${confirmDelete.email})? The account will be deactivated.`}
          onConfirm={confirmDeleteAction}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmReset && (
        <ConfirmDialog
          open
          title="Reset password"
          message={`Reset the password for ${confirmReset.name}?`}
          onConfirm={confirmResetAction}
          onCancel={() => setConfirmReset(null)}
        />
      )}
    </div>
  );
}

function ModalHeader({ title, desc, onClose, icon }: { title: string; desc: string; onClose: () => void; icon: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="stat-icon bg-primary-light text-primary">{icon}</div>
        <div className="max-w-xs">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <p className="truncate text-xs text-ink-muted">{desc}</p>
        </div>
      </div>
      <button type="button" onClick={onClose} className="btn btn-icon">
        <XMarkIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
