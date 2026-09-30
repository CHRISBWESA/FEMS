import { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import FormModal, { Field } from '../components/resources/FormModal';
import { Empty, Spinner, errMsg } from '../components/finance/common';

const badge = (s: string) => (s === 'open' ? 'status-active' : s === 'cancelled' ? 'status-rejected' : s === 'closed' ? 'status-inactive' : 'status-draft');
const NEXT: Record<string, [string, string][]> = {
  draft: [['open', 'Open for sign-ups'], ['cancelled', 'Cancel']],
  open: [['closed', 'Close sign-ups'], ['cancelled', 'Cancel']],
  closed: [['open', 'Reopen'], ['cancelled', 'Cancel']],
  cancelled: [],
};
const toLocalInput = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

type Dialog = null | { type: 'shift' } | { type: 'editShift'; shift: any } | { type: 'assign'; shift: any } | { type: 'edit' } | { type: 'apply'; shift: any };

export default function VolunteerOpportunity() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const manager = hasPermission('volunteer.manage');
  const deptLeader = hasPermission('volunteer.department_manage');
  const canSuggest = hasPermission('member.profile_view') && (manager || deptLeader);

  const [opp, setOpp] = useState<any>(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [open, setOpen] = useState<string | null>(null); // shift whose roster is expanded
  const [roster, setRoster] = useState<any[] | null>(null);
  const [suggest, setSuggest] = useState<any | null>(null);
  const [lookups, setLookups] = useState<{ members: any[]; roles: any[]; activities: any[] }>({ members: [], roles: [], activities: [] });
  const [busy, setBusy] = useState('');

  const load = () => axios.get(`/volunteers/opportunities/${id}`, { withCredentials: true })
    .then((r) => { setOpp(r.data); setError(''); })
    .catch((e) => setError(e.response?.status === 404 ? 'This opportunity is not available.' : e.response?.status === 403 ? "You don't have access to this opportunity." : errMsg(e, 'Could not load the opportunity')));
  useEffect(() => { load(); }, [id]);

  const loadRoster = (shiftId: string) => { setRoster(null); axios.get(`/volunteers/shifts/${shiftId}/assignments`, { withCredentials: true }).then((r) => setRoster(r.data)).catch(() => setRoster([])); };
  const toggleRoster = (shiftId: string) => { setSuggest(null); if (open === shiftId) { setOpen(null); } else { setOpen(shiftId); loadRoster(shiftId); } };
  const refresh = () => { load(); if (open) loadRoster(open); };

  useEffect(() => {
    if (!dialog) return;
    if (dialog.type === 'assign' && lookups.members.length === 0) axios.get('/members?limit=100&status=active', { withCredentials: true }).then((r) => setLookups((l) => ({ ...l, members: r.data.data || [] }))).catch(() => {});
    if ((dialog.type === 'shift' || dialog.type === 'editShift') && lookups.roles.length === 0) {
      axios.get('/volunteers/roles', { withCredentials: true }).then((r) => setLookups((l) => ({ ...l, roles: r.data.filter((x: any) => x.is_active) }))).catch(() => {});
    }
    if (dialog.type === 'shift' && lookups.activities.length === 0) axios.get('/activities', { withCredentials: true }).then((r) => setLookups((l) => ({ ...l, activities: Array.isArray(r.data) ? r.data : [] }))).catch(() => {});
    if (dialog.type === 'edit' && lookups.members.length === 0) axios.get('/members?limit=100&status=active', { withCredentials: true }).then((r) => setLookups((l) => ({ ...l, members: r.data.data || [] }))).catch(() => {});
  }, [dialog]);

  const act = async (key: string, fn: () => Promise<any>) => {
    setBusy(key);
    try { await fn(); refresh(); } catch (e) { alert(errMsg(e, 'That did not work')); } finally { setBusy(''); }
  };
  const post = (path: string, body: object = {}) => axios.post(`/volunteers/${path}`, body, { withCredentials: true });

  if (error) return <div className="mx-auto max-w-4xl"><button onClick={() => navigate('/volunteering')} className="mb-4 text-sm text-slate-500">← Back</button><Empty text={error} /></div>;
  if (!opp) return <Spinner />;

  const canManage: boolean = opp.canManage;
  const staff: boolean = opp.canCoordinate;
  const dead = opp.status === 'cancelled';
  const roleOpts = [{ value: '', label: 'No specific role' }, ...lookups.roles.map((r) => ({ value: r.id, label: r.name }))];
  const shiftFields = (creating: boolean): Field[] => [
    { name: 'startsAt', label: 'Starts', type: 'datetime-local', required: true },
    { name: 'endsAt', label: 'Ends', type: 'datetime-local', required: true },
    { name: 'capacity', label: 'Volunteers needed', type: 'number', min: 1, required: true },
    { name: 'roleId', label: 'Role', type: 'select', options: roleOpts },
    { name: 'location', label: 'Location (if different)' },
    ...(creating ? [{ name: 'activityId', label: 'Linked activity', type: 'select' as const, options: [{ value: '', label: 'None' }, ...lookups.activities.map((a) => ({ value: a.id, label: `${a.title} · ${new Date(a.date).toLocaleDateString()}` }))], help: 'Attended volunteers are also recorded as attending this activity.' }] : []),
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <button onClick={() => navigate('/volunteering')} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"><ArrowLeftIcon className="h-4 w-4" /> Back to Volunteering</button>

      <div className="card mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{opp.title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {opp.department ? `${opp.department.name} department` : 'Fellowship-wide'}
              {opp.coordinator && <> · Coordinator: <span className="text-slate-700">{opp.coordinator.full_name}</span></>}
              {opp.location && <> · {opp.location}</>}
            </p>
          </div>
          <span className={`status-badge ${badge(opp.status)} capitalize`}>{opp.status}</span>
        </div>
        {opp.description && <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">{opp.description}</p>}
        {canManage && !dead && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
            <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ type: 'edit' })}>Edit</button>
            {NEXT[opp.status].map(([to, label]) => (
              <button key={to} disabled={busy === to} className={`btn btn-sm ${to === 'cancelled' ? 'btn-danger' : 'btn-secondary'}`}
                onClick={() => { if (to !== 'cancelled' || window.confirm('Cancel this opportunity? All its shifts and sign-ups are cancelled and volunteers are told.')) act(to, () => post(`opportunities/${id}/status`, { status: to })); }}>{label}</button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Shifts</h2>
        {staff && !dead && <button className="btn btn-primary btn-sm" onClick={() => setDialog({ type: 'shift' })}><PlusIcon className="h-4 w-4" /> Add shift</button>}
      </div>

      {opp.shifts.length === 0 ? <Empty text={staff ? 'No shifts yet. Add the first one.' : 'No upcoming shifts right now.'} /> : (
        <div className="space-y-3">
          {opp.shifts.map((s: any) => {
            const started = new Date(s.starts_at) <= new Date();
            const mine = s.myAssignment;
            const canApply = opp.status === 'open' && s.status === 'scheduled' && !started && (!mine || mine.status === 'withdrawn');
            return (
              <div key={s.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{fmt(s.starts_at)} – {new Date(s.ends_at).toLocaleTimeString([], { timeStyle: 'short' })}
                      {s.status === 'cancelled' && <span className="ml-2 status-badge status-rejected">Cancelled</span>}</p>
                    <p className="text-sm text-slate-500">
                      {s.role?.name || 'General'} · {s.location || opp.location || 'Location to be confirmed'} · <span className="text-slate-700">{s.filled}/{s.capacity} filled</span>
                      {staff && s.pendingApplications > 0 && <span className="ml-2 text-amber-700">{s.pendingApplications} waiting</span>}
                    </p>
                    {s.notes && <p className="mt-1 text-sm text-slate-600">{s.notes}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {mine && mine.status !== 'withdrawn' && <span className="text-sm capitalize text-slate-600">You: {mine.status.replace('_', ' ')}</span>}
                    {canApply && <button className="btn btn-primary btn-sm" onClick={() => setDialog({ type: 'apply', shift: s })}>Sign up</button>}
                    {mine && ['applied', 'confirmed'].includes(mine.status) && !started && (
                      <button className="btn btn-secondary btn-sm" disabled={busy === mine.id} onClick={() => window.confirm('Withdraw from this shift?') && act(mine.id, () => post(`assignments/${mine.id}/withdraw`))}>Withdraw</button>
                    )}
                    {staff && <button className="btn btn-secondary btn-sm" onClick={() => toggleRoster(s.id)}>{open === s.id ? 'Hide roster' : 'Roster'}</button>}
                    {staff && s.status === 'scheduled' && !started && <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ type: 'editShift', shift: s })}>Edit</button>}
                    {staff && s.status === 'scheduled' && !started && <button className="btn btn-danger btn-sm" disabled={busy === s.id} onClick={() => window.confirm('Cancel this shift? Volunteers will be told.') && act(s.id, () => post(`shifts/${s.id}/cancel`))}>Cancel</button>}
                  </div>
                </div>

                {staff && open === s.id && (
                  <div className="mt-4 border-t border-border pt-4">
                    <div className="mb-2 flex flex-wrap gap-2">
                      {(manager || deptLeader) && s.status === 'scheduled' && !started && <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ type: 'assign', shift: s })}>Assign a member</button>}
                      {canSuggest && s.role_id && <button className="btn btn-secondary btn-sm" onClick={() => axios.get(`/volunteers/shifts/${s.id}/suggestions`, { withCredentials: true }).then((r) => setSuggest({ shiftId: s.id, ...r.data })).catch((e) => alert(errMsg(e, 'Could not load suggestions')))}>Suggest volunteers</button>}
                    </div>
                    {suggest?.shiftId === s.id && (
                      <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
                        {suggest.candidates.length === 0 ? <p className="text-slate-500">No matching members{suggest.skills.length ? ` for: ${suggest.skills.join(', ')}` : ' (this role has no required skills)'}.</p> : (
                          <ul className="space-y-1">{suggest.candidates.map((c: any) => (
                            <li key={c.memberId} className="flex items-center justify-between gap-2"><span>{c.fullName} <span className="text-xs text-slate-400">({c.matched.join(', ')})</span></span>
                              <button className="btn btn-secondary btn-sm" disabled={busy === c.memberId} onClick={() => act(c.memberId, async () => { await post(`shifts/${s.id}/assign`, { memberId: c.memberId }); setSuggest(null); })}>Assign</button></li>
                          ))}</ul>
                        )}
                      </div>
                    )}
                    {!roster ? <Spinner /> : roster.length === 0 ? <p className="text-sm text-slate-500">Nobody has signed up yet.</p> : (
                      <div className="overflow-x-auto"><table className="table">
                        <thead><tr><th>Volunteer</th><th>Status</th><th /></tr></thead>
                        <tbody>
                          {roster.map((a) => (
                            <tr key={a.id}>
                              <td className="font-medium text-slate-900">{a.member.full_name}{a.note && <p className="text-xs font-normal text-slate-500">“{a.note}”</p>}</td>
                              <td className="capitalize">{a.status.replace('_', ' ')}</td>
                              <td className="space-x-2 text-right">
                                {a.status === 'applied' && <>
                                  <button className="btn btn-primary btn-sm" disabled={busy === a.id} onClick={() => act(a.id, () => post(`assignments/${a.id}/decide`, { decision: 'approve' }))}>Approve</button>
                                  <button className="btn btn-secondary btn-sm" disabled={busy === a.id} onClick={() => act(a.id, () => post(`assignments/${a.id}/decide`, { decision: 'reject' }))}>Decline</button>
                                </>}
                                {['applied', 'confirmed'].includes(a.status) && !started && <button className="btn btn-secondary btn-sm" disabled={busy === a.id} onClick={() => window.confirm('Remove this volunteer from the shift?') && act(a.id, () => post(`assignments/${a.id}/cancel`))}>Remove</button>}
                                {started && ['confirmed', 'no_show'].includes(a.status) && <button className="btn btn-primary btn-sm" disabled={busy === a.id} onClick={() => act(a.id, () => post(`assignments/${a.id}/attendance`, { outcome: 'attended' }))}>Attended</button>}
                                {started && a.status === 'confirmed' && <button className="btn btn-secondary btn-sm" disabled={busy === a.id} onClick={() => act(a.id, () => post(`assignments/${a.id}/attendance`, { outcome: 'no_show' }))}>No-show</button>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {dialog?.type === 'shift' && (
        <FormModal title="Add shift" submitLabel="Add" initial={{ capacity: 1 }} fields={shiftFields(true)}
          onSubmit={async (v) => { await post(`opportunities/${id}/shifts`, { startsAt: new Date(v.startsAt).toISOString(), endsAt: new Date(v.endsAt).toISOString(), capacity: Number(v.capacity), roleId: v.roleId || undefined, location: v.location || undefined, activityId: v.activityId || undefined, notes: v.notes || undefined }); refresh(); }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'editShift' && (
        <FormModal title="Edit shift" description="Times can only be changed while nobody has signed up." initial={{ startsAt: toLocalInput(dialog.shift.starts_at), endsAt: toLocalInput(dialog.shift.ends_at), capacity: dialog.shift.capacity, roleId: dialog.shift.role_id || '', location: dialog.shift.location || '', notes: dialog.shift.notes || '' }} fields={shiftFields(false)}
          onSubmit={async (v) => {
            const s = dialog.shift;
            const body: any = { capacity: Number(v.capacity), roleId: v.roleId || null, location: v.location || null, notes: v.notes || null };
            if (v.startsAt !== toLocalInput(s.starts_at)) body.startsAt = new Date(v.startsAt).toISOString();
            if (v.endsAt !== toLocalInput(s.ends_at)) body.endsAt = new Date(v.endsAt).toISOString();
            await axios.put(`/volunteers/shifts/${s.id}`, body, { withCredentials: true });
            refresh();
          }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'assign' && (
        <FormModal title="Assign a member" submitLabel="Assign" description="The member is placed on the roster right away and is notified."
          fields={[{ name: 'memberId', label: 'Member', type: 'select', required: true, options: [{ value: '', label: 'Select member…' }, ...lookups.members.map((m) => ({ value: m.id, label: m.full_name }))] }, { name: 'note', label: 'Note' }]}
          onSubmit={async (v) => { await post(`shifts/${dialog.shift.id}/assign`, { memberId: v.memberId, note: v.note || undefined }); refresh(); }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'apply' && (
        <FormModal title="Sign up for this shift" submitLabel="Sign up" description={`${fmt(dialog.shift.starts_at)} · a coordinator will confirm your place.${dialog.shift.spotsLeft === 0 ? ' This shift is currently full; your application may still be considered if a place opens.' : ''}`}
          fields={[{ name: 'note', label: 'Anything the coordinator should know? (optional)', type: 'textarea' }]}
          onSubmit={async (v) => { await post(`shifts/${dialog.shift.id}/apply`, { note: v.note || undefined }); refresh(); }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'edit' && (
        <FormModal title="Edit opportunity" initial={{ title: opp.title, description: opp.description || '', location: opp.location || '', coordinatorMemberId: opp.coordinator?.id || '' }}
          fields={[
            { name: 'title', label: 'Title', required: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'location', label: 'Location' },
            { name: 'coordinatorMemberId', label: 'Coordinator', type: 'select', options: [{ value: '', label: 'None' }, ...lookups.members.map((m) => ({ value: m.id, label: m.full_name })), ...(opp.coordinator && !lookups.members.some((m) => m.id === opp.coordinator.id) ? [{ value: opp.coordinator.id, label: opp.coordinator.full_name }] : [])] },
          ]}
          onSubmit={async (v) => { await axios.put(`/volunteers/opportunities/${id}`, { title: v.title, description: v.description || null, location: v.location || null, coordinatorMemberId: v.coordinatorMemberId || null }, { withCredentials: true }); refresh(); }}
          onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
