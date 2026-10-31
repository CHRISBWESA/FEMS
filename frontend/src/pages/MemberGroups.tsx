import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import { RectangleGroupIcon, PlusIcon, MagnifyingGlassIcon, UsersIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import { Badge, Button, EmptyState, ErrorState, PageLoader, useToast } from '../components/ui';
import GroupFormModal from '../components/groups/GroupFormModal';

type Leader = { memberId: string; fullName: string } | null;
type GroupSummary = {
  id: string; name: string; description: string | null; isActive: boolean; memberCount: number;
  maleLeader: Leader; femaleLeader: Leader; createdAt: string;
};

export default function MemberGroups() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const canManage = hasPermission('member.groups_manage');
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    axios.get('/member-groups', { withCredentials: true })
      .then((res) => { setGroups(res.data); setError(''); })
      .catch((err) => setError(err.response?.status === 403
        ? "You don't have permission to view member groups."
        : 'Could not load groups.'));
  }, []);
  useEffect(load, [load]);

  const closeCreate = useCallback(() => setCreating(false), []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (groups ?? []).filter((g) => !q || g.name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q));
  }, [groups, search]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Member Groups</h1>
          <p className="page-desc">Groups of members such as cell groups, cohorts and interest groups, each with a male and a female leader. Departments are managed separately.</p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon className="h-4 w-4" /> New group
          </Button>
        )}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => { setGroups(null); load(); }} />
      ) : groups === null ? (
        <PageLoader rows={2} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<RectangleGroupIcon className="h-8 w-8" />}
          title="No groups yet"
          description={canManage ? 'Create a group, then add members and appoint its leaders.' : 'No groups have been created yet.'}
          action={canManage ? <Button variant="primary" onClick={() => setCreating(true)}><PlusIcon className="h-4 w-4" /> New group</Button> : undefined}
        />
      ) : (
        <>
          <div className="relative mb-4 max-w-sm">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            <input
              className="input pl-9"
              placeholder="Search groups"
              aria-label="Search groups"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {shown.length === 0 ? (
            <EmptyState compact title="No groups match" description="Try a different search." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((g) => (
                <Link key={g.id} to={`/member-groups/${g.id}`} className="card card-interactive card-pad flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="stat-icon bg-primary-light text-primary"><RectangleGroupIcon className="h-6 w-6" /></div>
                    {!g.isActive && <Badge tone="warning">Inactive</Badge>}
                  </div>
                  <h3 className={`mt-4 break-words text-base font-semibold ${g.isActive ? 'text-ink' : 'text-ink-subtle'}`}>{g.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{g.description || 'No description'}</p>
                  <dl className="mt-4 space-y-1.5 border-t border-hairline pt-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-muted">Male leader</dt>
                      <dd className={`truncate text-right ${g.maleLeader ? 'font-medium text-ink' : 'text-ink-subtle'}`}>{g.maleLeader?.fullName ?? 'Not appointed'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-muted">Female leader</dt>
                      <dd className={`truncate text-right ${g.femaleLeader ? 'font-medium text-ink' : 'text-ink-subtle'}`}>{g.femaleLeader?.fullName ?? 'Not appointed'}</dd>
                    </div>
                  </dl>
                  <p className="mt-auto flex items-center gap-1.5 pt-3 text-sm text-ink-muted">
                    <UsersIcon className="h-4 w-4" /> {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      <GroupFormModal
        open={creating}
        onClose={closeCreate}
        onSaved={(saved) => {
          setCreating(false);
          toast.push('success', `Group "${saved.name}" created. Now add its members.`);
          navigate(`/member-groups/${saved.id}`);
        }}
      />
    </div>
  );
}
