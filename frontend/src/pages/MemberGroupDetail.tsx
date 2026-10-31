import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  PencilSquareIcon, UserPlusIcon, UsersIcon, TrashIcon, CalendarIcon, StarIcon, RectangleGroupIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import {
  Alert, Badge, Breadcrumb, Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, PageLoader, StatCard, StatGrid,
  useToast,
} from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import GroupFormModal from '../components/groups/GroupFormModal';
import AddGroupMembersModal from '../components/groups/AddGroupMembersModal';

type Leader = { memberId: string; fullName: string; memberCode: string } | null;
type GroupMember = {
  memberId: string; fullName: string; memberCode: string; status: string; gender: string | null;
  leaderRole: 'male_leader' | 'female_leader' | null; joinedAt: string;
};
type Group = {
  id: string; name: string; description: string | null; isActive: boolean; createdAt: string; updatedAt: string;
  memberCount: number; maleLeader: Leader; femaleLeader: Leader; members: GroupMember[];
};

/** Mirrors the server rule: the recorded gender, compared case-insensitively. The server has the final say. */
const genderOf = (g: string | null) => {
  const v = (g || '').trim().toLowerCase();
  return v === 'male' || v === 'female' ? v : null;
};

const ROLE_LABEL = { male_leader: 'Male leader', female_leader: 'Female leader' } as const;

export default function MemberGroupDetail() {
  const { id = '' } = useParams();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const canManage = hasPermission('member.groups_manage');

  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<GroupMember | null>(null);
  const [removing, setRemoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`/member-groups/${id}`, { withCredentials: true });
      setGroup(res.data);
      setError('');
    } catch (err: any) {
      if (err.response?.status === 404) setNotFound(true);
      else setError(err.response?.status === 403 ? "You don't have permission to view this group." : 'Could not load the group.');
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const closeEdit = useCallback(() => setEditing(false), []);
  const closeAdd = useCallback(() => setAdding(false), []);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = group?.members ?? [];
    return q ? list.filter((m) => m.fullName.toLowerCase().includes(q) || m.memberCode.toLowerCase().includes(q)) : list;
  }, [group, search]);

  if (loading) return <PageLoader rows={3} />;
  if (notFound) {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState
          icon={<RectangleGroupIcon className="h-8 w-8" />}
          title="Group not found"
          description="It may have been removed, or the link is wrong."
          action={<Link to="/member-groups" className="btn btn-secondary">Back to groups</Link>}
        />
      </div>
    );
  }
  if (error || !group) return <div className="mx-auto max-w-5xl"><ErrorState message={error} onRetry={() => { setLoading(true); load(); }} /></div>;

  const males = group.members.filter((m) => genderOf(m.gender) === 'male').length;
  const females = group.members.filter((m) => genderOf(m.gender) === 'female').length;

  const removeMember = async () => {
    if (!confirmRemove) return;
    setRemoving(true);
    try {
      const res = await axios.post(`/member-groups/${group.id}/members/${confirmRemove.memberId}/remove`, {}, { withCredentials: true });
      toast.push('success', res.data?.message || 'Member removed from group');
      setConfirmRemove(null);
      await load();
    } catch (err: any) {
      toast.push('error', err.response?.data?.message || 'Could not remove the member.');
    } finally {
      setRemoving(false);
    }
  };

  const deleteGroup = async () => {
    setDeleting(true);
    try {
      const res = await axios.delete(`/member-groups/${group.id}`, { withCredentials: true });
      toast.push('success', res.data?.message || 'Group deleted');
      navigate('/member-groups', { replace: true });
    } catch (err: any) {
      toast.push('error', err.response?.data?.message || 'Could not delete the group.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const columns: Column<GroupMember>[] = [
    {
      key: 'name', header: 'Member', priority: 'primary',
      render: (m) => (
        <span className="flex flex-wrap items-center gap-2">
          <Link to={`/members/${m.memberId}`} className="font-medium text-ink hover:text-primary">{m.fullName}</Link>
          {m.leaderRole && <Badge tone="accent">{ROLE_LABEL[m.leaderRole]}</Badge>}
        </span>
      ),
    },
    { key: 'code', header: 'Code', render: (m) => <span className="font-mono text-xs text-ink-subtle">{m.memberCode}</span> },
    { key: 'gender', header: 'Gender', priority: 'meta', render: (m) => <span className="capitalize">{m.gender || 'Not recorded'}</span> },
    { key: 'status', header: 'Status', priority: 'secondary', render: (m) => <span className="capitalize">{m.status}</span> },
    { key: 'joined', header: 'Added', priority: 'secondary', render: (m) => new Date(m.joinedAt).toLocaleDateString() },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <Breadcrumb items={[{ label: 'Member Groups', to: '/member-groups' }, { label: group.name }]} />

      <div className="page-header">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-title break-words">{group.name}</h1>
            {!group.isActive && <Badge tone="warning">Inactive</Badge>}
          </div>
          <p className="page-desc">{group.description || 'No description'}</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="danger-quiet" onClick={() => setConfirmDelete(true)}><TrashIcon className="h-4 w-4" /> Delete</Button>
            <Button onClick={() => setEditing(true)}><PencilSquareIcon className="h-4 w-4" /> Edit</Button>
            <Button variant="primary" onClick={() => setAdding(true)}><UserPlusIcon className="h-4 w-4" /> Add members</Button>
          </div>
        )}
      </div>

      <StatGrid className="mb-6">
        <StatCard label="Members" value={group.memberCount} icon={<UsersIcon className="h-5 w-5" />} tone="primary" />
        <StatCard label="Male" value={males} />
        <StatCard label="Female" value={females} hint={group.memberCount - males - females > 0 ? `${group.memberCount - males - females} other or not recorded` : undefined} />
        <StatCard label="Created" value={<span className="text-xl">{new Date(group.createdAt).toLocaleDateString()}</span>} icon={<CalendarIcon className="h-5 w-5" />} />
      </StatGrid>

      <section className="mb-6" aria-labelledby="leaders-heading">
        <h2 id="leaders-heading" className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Group leaders</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <LeaderCard role="male" group={group} canManage={canManage} onChanged={load} />
          <LeaderCard role="female" group={group} canManage={canManage} onChanged={load} />
        </div>
      </section>

      <section aria-labelledby="members-heading">
        <h2 id="members-heading" className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Members ({group.memberCount})</h2>
        <DataTable
          columns={columns}
          rows={filteredMembers}
          rowKey={(m) => m.memberId}
          caption={`Members of ${group.name}`}
          clientPaging
          pageSize={25}
          search={{ value: search, onChange: setSearch, placeholder: 'Search group members' }}
          rowActions={canManage ? (m) => (
            <IconButton label={`Remove ${m.fullName} from the group`} icon={<TrashIcon className="h-4 w-4 text-rose-500" />} onClick={() => setConfirmRemove(m)} />
          ) : undefined}
          empty={search
            ? { title: 'No members match', description: 'Try a different name or code.' }
            : {
                title: 'No members yet',
                description: canManage ? 'Add registered members to this group to get started.' : 'Nobody has been added to this group yet.',
                action: canManage ? <Button variant="primary" onClick={() => setAdding(true)}><UserPlusIcon className="h-4 w-4" /> Add members</Button> : undefined,
              }}
        />
      </section>

      <GroupFormModal
        open={editing}
        group={editing ? group : null}
        onClose={closeEdit}
        onSaved={() => { setEditing(false); toast.push('success', 'Group saved'); load(); }}
      />
      <AddGroupMembersModal
        open={adding}
        groupId={group.id}
        groupName={group.name}
        existingIds={group.members.map((m) => m.memberId)}
        onClose={closeAdd}
        onAdded={(r) => {
          setAdding(false);
          const parts = [`${r.added} added`];
          if (r.alreadyMember) parts.push(`${r.alreadyMember} already in the group`);
          if (r.rejected.length) parts.push(`${r.rejected.length} could not be added`);
          toast.push(r.rejected.length ? 'info' : 'success', parts.join(', '));
          load();
        }}
      />
      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove member"
        message={confirmRemove?.leaderRole
          ? `Remove ${confirmRemove.fullName} from ${group.name}? They are the ${ROLE_LABEL[confirmRemove.leaderRole].toLowerCase()}, so that role will become vacant.`
          : `Remove ${confirmRemove?.fullName ?? 'this member'} from ${group.name}? Their member record is not affected.`}
        confirmLabel="Remove"
        loading={removing}
        onConfirm={removeMember}
        onCancel={() => setConfirmRemove(null)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete group"
        message={`Delete ${group.name}? Its ${group.memberCount} ${group.memberCount === 1 ? 'membership' : 'memberships'} and its leaders are removed with it. The members themselves stay registered, and a copy of the group is kept in the Recycle Bin.`}
        confirmLabel="Delete group"
        loading={deleting}
        onConfirm={deleteGroup}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/** Shows one leader role, and lets a manager appoint, replace or clear it from eligible group members. */
function LeaderCard({ role, group, canManage, onChanged }: {
  role: 'male' | 'female';
  group: Group;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const current = role === 'male' ? group.maleLeader : group.femaleLeader;
  const key = role === 'male' ? 'maleLeaderId' : 'femaleLeaderId';
  const title = role === 'male' ? 'Male leader' : 'Female leader';
  const eligible = group.members.filter((m) => genderOf(m.gender) === role);
  const [choice, setChoice] = useState(current?.memberId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setChoice(current?.memberId ?? ''); setError(''); }, [current?.memberId]);

  const save = async (memberId: string | null) => {
    setSaving(true);
    setError('');
    try {
      await axios.put(`/member-groups/${group.id}/leaders`, { [key]: memberId }, { withCredentials: true });
      toast.push('success', memberId ? `${title} appointed` : `${title} cleared`);
      await onChanged();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not change the leader.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="card-pad">
      <div className="flex items-start gap-3">
        <div className={`stat-icon h-10 w-10 shrink-0 ${current ? 'bg-accent-light text-accent' : 'bg-surface-sunken text-ink-subtle'}`}>
          <StarIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{title}</p>
          {current ? (
            <p className="mt-1 truncate text-base font-semibold text-ink">
              <Link to={`/members/${current.memberId}`} className="hover:text-primary">{current.fullName}</Link>
              <span className="ml-2 font-mono text-xs font-normal text-ink-subtle">{current.memberCode}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">Not appointed</p>
          )}
        </div>
      </div>

      {canManage && (
        <div className="mt-4 border-t border-hairline pt-4">
          {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
          {eligible.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No {role} members in this group yet. Only members recorded as {role} can be the {title.toLowerCase()}.
            </p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                className="select flex-1"
                aria-label={`Choose the ${title.toLowerCase()}`}
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                disabled={saving}
              >
                <option value="">Select a {role} member…</option>
                {eligible.map((m) => <option key={m.memberId} value={m.memberId}>{m.fullName} ({m.memberCode})</option>)}
              </select>
              <div className="flex gap-2">
                <Button variant="primary" loading={saving} disabled={!choice || choice === current?.memberId} onClick={() => save(choice)}>
                  {current ? 'Replace' : 'Appoint'}
                </Button>
                {current && <Button variant="quiet" disabled={saving} onClick={() => save(null)}>Clear</Button>}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
