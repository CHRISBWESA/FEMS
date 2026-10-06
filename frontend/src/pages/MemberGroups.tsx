import { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../App';
import { RectangleGroupIcon, PlusIcon, XMarkIcon, UserPlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { PageLoader, ConfirmDialog } from '../components/ui';

export default function MemberGroups() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('member.groups_manage');
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [confirmRemove, setConfirmRemove] = useState<null | string>(null);

  const load = () => {
    setLoading(true);
    axios.get('/member-groups', { withCredentials: true })
      .then((res) => { setGroups(res.data); setError(''); })
      .catch((err) => setError(err.response?.status === 403
        ? "You don't have permission to view member groups."
        : 'Could not load groups.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openGroup = async (id: string) => {
    try {
      const res = await axios.get(`/member-groups/${id}`, { withCredentials: true });
      setOpen(res.data);
      setSearch('');
      setCandidates([]);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to open group');
    }
  };

  useEffect(() => {
    if (!open || !canManage || !search.trim()) { setCandidates([]); return; }
    const handle = setTimeout(() => {
      axios.get(`/members?limit=8&search=${encodeURIComponent(search.trim())}`, { withCredentials: true })
        .then((res) => setCandidates(res.data.data || []))
        .catch(() => setCandidates([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [search, open, canManage]);

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await axios.post('/member-groups', { name: form.name, description: form.description || undefined }, { withCredentials: true });
      setShowCreate(false);
      setForm({ name: '', description: '' });
      load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create group');
    } finally {
      setSaving(false);
    }
  };

  const addMember = async (memberId: string) => {
    try {
      await axios.post(`/member-groups/${open.id}/members`, { memberIds: [memberId] }, { withCredentials: true });
      await openGroup(open.id);
      load();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to add member');
    }
  };

  const removeMember = (memberId: string) => setConfirmRemove(memberId);

  const confirmRemoveAction = async () => {
    if (!confirmRemove || !open) return;
    try {
      await axios.post(`/member-groups/${open.id}/members/${confirmRemove}/remove`, {}, { withCredentials: true });
      await openGroup(open.id);
      load();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to remove member');
    } finally {
      setConfirmRemove(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Member Groups</h1>
          <p className="page-desc">Informal groupings of members (cell groups, cohorts, interest groups). Departments are managed separately.</p>
        </div>
        {canManage && (
          <button onClick={() => { setError(''); setShowCreate(true); }} className="btn btn-primary">
            <PlusIcon className="h-4 w-4" /> New Group
          </button>
        )}
      </div>

      {error && !showCreate && (
        <div className="alert alert-danger mb-4" role="alert">{error}</div>
      )}

      {loading ? (
        <PageLoader rows={2} />
      ) : groups.length === 0 && !error ? (
        <div className="empty-state">
          <div className="stat-icon bg-surface-sunken text-ink-subtle"><RectangleGroupIcon className="h-6 w-6" /></div>
          <p className="empty-title">No groups yet</p>
          <p className="empty-desc">Create a group to organise members outside of departments.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <button key={g.id} onClick={() => openGroup(g.id)} className="card card-hover block w-full text-left">
              <div className="stat-icon bg-primary-light text-primary"><RectangleGroupIcon className="h-6 w-6" /></div>
              <h3 className={`mt-4 text-base font-semibold ${g.isActive ? 'text-ink' : 'text-ink-subtle'}`}>{g.name}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{g.description || 'No description'}</p>
              <p className="mt-3 text-sm text-ink-muted">{g.memberCount} member(s)</p>
            </button>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form onSubmit={createGroup} onClick={(e) => e.stopPropagation()} className="modal max-w-md">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-base font-semibold text-ink">New group</h3>
              <button type="button" onClick={() => setShowCreate(false)} className="btn btn-icon"><XMarkIcon className="h-5 w-5" /></button>
            </div>
            {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}
            <div className="space-y-4">
              <div>
                <label className="label">Name *</label>
                <input className="input" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input" rows={2} maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">{saving ? <span className="spinner border-white" /> : 'Create group'}</button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn btn-secondary flex-1">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(null)}>
          <div onClick={(e) => e.stopPropagation()} className="modal max-w-lg">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-ink">{open.name}</h3>
                <p className="text-xs text-ink-muted">{open.description || 'No description'}</p>
              </div>
              <button type="button" onClick={() => setOpen(null)} className="btn btn-icon"><XMarkIcon className="h-5 w-5" /></button>
            </div>

            {canManage && (
              <div className="mb-4">
                <input className="input" placeholder="Search members to add…" value={search} onChange={(e) => setSearch(e.target.value)} />
                {candidates.length > 0 && (
                  <ul className="mt-2 divide-y divide-hairline rounded-lg ring-1 ring-inset ring-hairline">
                    {candidates.map((c) => (
                      <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>{c.full_name} <span className="font-mono text-xs text-ink-subtle">{c.member_code}</span></span>
                        <button onClick={() => addMember(c.id)} className="btn btn-secondary btn-sm">
                          <UserPlusIcon className="h-4 w-4" /> Add
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {open.members.length === 0 ? (
              <p className="py-4 text-sm text-ink-muted">No members in this group yet.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-hairline overflow-y-auto">
                {open.members.map((m: any) => (
                  <li key={m.memberId} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink">{m.fullName} <span className="font-mono text-xs text-ink-subtle">{m.memberCode}</span></span>
                    {canManage && (
                      <button onClick={() => removeMember(m.memberId)} className="btn btn-icon" title="Remove from group">
                        <TrashIcon className="h-4 w-4 text-rose-500" />
                      </button>
                    )}
                  </li>
                ))}
</ul>
             )}
           </div>
         </div>
       )}
       {confirmRemove && open && (
         <ConfirmDialog
           open
           title="Remove member"
           message="Remove this member from the group?"
           onConfirm={confirmRemoveAction}
           onCancel={() => setConfirmRemove(null)}
         />
       )}
     </div>
   );
}
