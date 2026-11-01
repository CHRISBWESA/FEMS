import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { PlusIcon, PrinterIcon, Cog6ToothIcon, CameraIcon } from '@heroicons/react/24/outline';
import { Alert, Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../App';
import { useI18n } from '../context/I18nContext';
import { errMsg, ExportButtons, fmtDate, FormModal, label, Row, useLoad } from '../fin/common';

const MANAGERS = ['fellowship_admin', 'secretary', 'assistant_secretary'];
const END_REASONS = [
  { value: 'resigned', label: 'Resigned' },
  { value: 'term_completed', label: 'Term completed' },
  { value: 'removed', label: 'Removed' },
  { value: 'other', label: 'Other (explain)' },
];
const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = { active: 'success', suspended: 'warning', former: 'neutral' };

function Photo({ m, size = 'md' }: { m: { fullName: string; photoUrl?: string | null }; size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'lg' ? 'h-16 w-16' : size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';
  return m.photoUrl ? <img src={m.photoUrl} alt="" className={`${px} rounded-full object-cover ring-1 ring-hairline`} /> : <Avatar name={m.fullName} size={size} />;
}

/** Picks a registered member (name or registration number). Members are never created here. */
function MemberSearch({ value, onChange }: { value: any; onChange: (m: any) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    const h = setTimeout(() => axios.get(`/leadership/member-search?q=${encodeURIComponent(q)}`, { withCredentials: true }).then((r) => setList(r.data)).catch(() => setList([])), 250);
    return () => clearTimeout(h);
  }, [q]);
  if (value) return <div className="flex items-center justify-between rounded-control bg-surface-sunken px-3 py-2 text-sm"><span className="flex items-center gap-2"><Photo m={value} size="sm" /><span className="font-medium">{value.fullName}</span><span className="text-ink-subtle">{value.registrationNumber}</span></span><button type="button" className="text-primary hover:underline" onClick={() => onChange(null)}>Change</button></div>;
  return (
    <div>
      <input className="input" placeholder="Search registered members by name or registration number" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length > 0 && <ul className="mt-1 max-h-56 overflow-auto rounded-control border border-hairline bg-surface">{list.map((m) => (
        <li key={m.id}><button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-sunken" onClick={() => onChange(m)}>
          <Photo m={m} size="sm" /><span className="font-medium">{m.fullName}</span><span className="text-ink-subtle">{m.registrationNumber}</span>
          <span className="ml-auto text-xs text-ink-subtle">{label(m.gender)}{m.hasLogin ? ' · has login' : ''}</span>
        </button></li>
      ))}</ul>}
    </div>
  );
}

export default function Leadership() {
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const canManage = (user?.roles ?? []).some((r) => MANAGERS.includes(r));
  const canConfigure = (user?.roles ?? []).some((r) => ['fellowship_admin', 'secretary'].includes(r));
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [f, setF] = useState({ search: '', positionId: '', departmentId: '', groupId: '', status: '', year: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ tab, page: String(page), limit: '25', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) } as any).toString();
  const list = useLoad<any>(`/leadership/appointments?${qs}`, [qs]);
  const positions = useLoad<any[]>('/leadership/positions', []);
  const scopes = useLoad<any>('/leadership/scopes', []);
  const depts = { data: scopes.data?.departments as any[] | undefined };
  const groupList: any[] = scopes.data?.groups ?? [];
  const [appoint, setAppoint] = useState<any>(null);
  const [member, setMember] = useState<any>(null);
  const [ending, setEnding] = useState<any>(null);
  const [endF, setEndF] = useState<any>({});
  const [suspending, setSuspending] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [profileId, setProfileId] = useState<string | null>(null);
  const profile = useLoad<any>(profileId ? `/leadership/members/${profileId}` : null, [profileId]);
  const [showPositions, setShowPositions] = useState(false);
  const [newPos, setNewPos] = useState({ name: '', level: 'fellowship', description: '' });
  const [credential, setCredential] = useState<any>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const posById = new Map((positions.data ?? []).map((p) => [p.id, p]));
  const chosen = appoint ? posById.get(appoint.positionId) : null;
  const reload = () => { list.reload(); if (profileId) profile.reload(); };
  const startAppoint = (prefill: any = {}) => { setMember(null); setAppoint({ positionId: '', departmentId: '', groupId: '', appointmentDate: new Date().toISOString().slice(0, 10), termStart: '', termEnd: '', notes: '', ...prefill }); };
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast.push('success', ok); reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not complete that.')); } };

  const uploadPhoto = async (file?: File | null) => {
    if (!file || !profileId) return;
    try {
      const form = new FormData();
      form.append('file', file);
      const up = (await axios.post('/leadership/uploads', form, { withCredentials: true })).data;
      await axios.put(`/leadership/members/${profileId}/photo`, { photo: up }, { withCredentials: true });
      toast.push('success', 'Photo updated'); reload();
    } catch (e) { toast.push('error', errMsg(e, 'Could not upload the photo.')); }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 print:max-w-none">
      <PageHeader title={t('lead.title')} description="Every current and past leadership appointment, linked to registered members. Appointing here updates the fellowship, department or group everywhere in FEMS."
        actions={<span className="flex flex-wrap gap-2 print:hidden">
          <ExportButtons url={`/leadership/export?${qs}`} name={tab === 'history' ? 'leadership-history' : 'current-leaders'} />
          <Button size="sm" onClick={() => window.print()}><PrinterIcon className="h-4 w-4" /> Print</Button>
          {canConfigure && <Button size="sm" onClick={() => setShowPositions(true)}><Cog6ToothIcon className="h-4 w-4" /> Positions</Button>}
          {canManage && <Button variant="primary" onClick={() => startAppoint()}><PlusIcon className="h-4 w-4" /> Appoint</Button>}
        </span>} />
      <Tabs tabs={[{ key: 'current', label: t('lead.current') }, { key: 'history', label: t('lead.history') }]} active={tab} onChange={(k) => { setTab(k); setPage(1); setF({ ...f, status: '' }); }} />
      <div className="flex flex-wrap gap-2 print:hidden">
        <Select className="w-52" value={f.positionId} onChange={(e) => { setF({ ...f, positionId: e.target.value }); setPage(1); }} options={[{ value: '', label: 'All positions' }, ...(positions.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <Select className="w-44" value={f.departmentId} onChange={(e) => { setF({ ...f, departmentId: e.target.value }); setPage(1); }} options={[{ value: '', label: 'All departments' }, ...(depts.data ?? []).map((d: any) => ({ value: d.id, label: d.name }))]} />
        <Select className="w-44" value={f.groupId} onChange={(e) => { setF({ ...f, groupId: e.target.value }); setPage(1); }} options={[{ value: '', label: 'All groups' }, ...groupList.map((g: any) => ({ value: g.id, label: g.name }))]} />
        {tab === 'current' && <Select className="w-36" value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }} options={[{ value: '', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]} />}
        <Input className="w-28" type="number" placeholder="Year" value={f.year} onChange={(e) => { setF({ ...f, year: e.target.value }); setPage(1); }} />
      </div>
      <DataTable rows={list.data?.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        search={{ value: f.search, onChange: (v) => { setF({ ...f, search: v }); setPage(1); }, placeholder: 'Leader name or registration number' }}
        total={list.data?.total} page={page} pageSize={25} onPageChange={setPage}
        empty={{ title: tab === 'current' ? 'No current leaders match' : 'No past appointments match', description: tab === 'current' && canManage ? 'Appoint a registered member to a position.' : undefined }}
        columns={[
          { key: 'n', header: 'Leader', priority: 'primary', render: (r: any) => <button className="flex items-center gap-3 text-left" onClick={() => r.member.id && setProfileId(r.member.id)}><Photo m={r.member} /><span><span className="block font-medium text-primary hover:underline">{r.member.fullName}</span><span className="text-xs text-ink-subtle">{r.member.registrationNumber}</span></span></button> },
          { key: 'p', header: 'Position', render: (r: any) => <span>{r.position.name}<span className="block text-xs text-ink-subtle">{r.departmentName ?? r.groupName ?? 'Fellowship'}</span></span> },
          { key: 'c', header: 'Contact', priority: 'meta', render: (r: any) => <span className="text-xs">{r.member.phone ?? '—'}<span className="block text-ink-subtle">{r.member.email ?? ''}</span></span> },
          { key: 't', header: 'Term', render: (r: any) => <span>{fmtDate(r.termStart)} – {tab === 'history' ? fmtDate(r.endedAt) : r.termEnd ? fmtDate(r.termEnd) : 'open'}{r.termEnded && <span className="block text-xs text-warning">term has passed</span>}</span> },
          { key: 's', header: 'Status', render: (r: any) => <span><Badge tone={STATUS_TONE[r.status]}>{label(r.status)}</Badge>{r.endReason && <span className="block text-xs text-ink-subtle">{label(r.endReason)}</span>}</span> },
        ]}
        rowActions={(r: any) => (canManage && r.status !== 'former' ? (
          <span className="inline-flex gap-1 print:hidden">
            <Button size="sm" variant="ghost" onClick={() => startAppoint({ positionId: r.position.id, departmentId: r.departmentId ?? '', groupId: r.groupId ?? '' })}>Replace</Button>
            {r.status === 'active' ? <Button size="sm" variant="ghost" onClick={() => { setSuspending(r); setReason(''); }}>Suspend</Button> : <Button size="sm" variant="ghost" onClick={() => act(() => axios.post(`/leadership/appointments/${r.id}/reinstate`, {}, { withCredentials: true }), 'Reinstated')}>Reinstate</Button>}
            <Button size="sm" variant="danger-quiet" onClick={() => { setEnding(r); setEndF({ reason: 'term_completed', endDate: new Date().toISOString().slice(0, 10), notes: '' }); }}>End</Button>
          </span>
        ) : null)} />

      <FormModal open={!!appoint} onClose={() => setAppoint(null)} title="Appoint a leader" width="lg" submitLabel="Appoint"
        description="Only registered members can be appointed; their details come from the member record. If the position is held, the current holder is replaced and moves to Leadership History."
        onSubmit={async () => {
          const r = (await axios.post('/leadership/appointments', { ...appoint, memberId: member?.id, departmentId: appoint.departmentId || undefined, groupId: appoint.groupId || undefined, termStart: appoint.termStart || undefined, termEnd: appoint.termEnd || undefined, notes: appoint.notes || undefined }, { withCredentials: true })).data;
          toast.push('success', 'Appointed'); reload();
          if (r.account?.created) setCredential(r.account);
        }}>
        <Field label="Position" required><Select value={appoint?.positionId ?? ''} onChange={(e) => setAppoint({ ...appoint, positionId: e.target.value })} placeholder="Choose" options={(positions.data ?? []).filter((p) => p.is_active).map((p) => ({ value: p.id, label: `${p.name} (${p.level})` }))} /></Field>
        {chosen?.level === 'department' && <Field label="Department" required><Select value={appoint.departmentId} onChange={(e) => setAppoint({ ...appoint, departmentId: e.target.value })} placeholder="Choose" options={(depts.data ?? []).filter((d: any) => d.is_active).map((d: any) => ({ value: d.id, label: d.name }))} /></Field>}
        {chosen?.level === 'group' && <Field label="Group" required hint="The leader must already be a member of the group, of the matching gender."><Select value={appoint.groupId} onChange={(e) => setAppoint({ ...appoint, groupId: e.target.value })} placeholder="Choose" options={groupList.map((g: any) => ({ value: g.id, label: g.name }))} /></Field>}
        <Field label="Member" required><MemberSearch value={member} onChange={setMember} /></Field>
        {chosen?.level === 'fellowship' && chosen.is_system && member && !member.hasLogin && <Alert tone="warning">{member.fullName} has no FEMS login yet. Invite them from Users first; fellowship offices are held through a login.</Alert>}
        {chosen?.level === 'department' && member && !member.hasEmail && <Alert tone="warning">{member.fullName} needs an e-mail address on their member record for their department login.</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Appointed on"><Input type="date" value={appoint?.appointmentDate ?? ''} onChange={(e) => setAppoint({ ...appoint, appointmentDate: e.target.value })} /></Field>
          <Field label="Term starts" hint="Defaults to the appointment date"><Input type="date" value={appoint?.termStart ?? ''} onChange={(e) => setAppoint({ ...appoint, termStart: e.target.value })} /></Field>
          <Field label="Term ends"><Input type="date" value={appoint?.termEnd ?? ''} onChange={(e) => setAppoint({ ...appoint, termEnd: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={appoint?.notes ?? ''} onChange={(e) => setAppoint({ ...appoint, notes: e.target.value })} /></Field>
      </FormModal>

      <FormModal open={!!ending} onClose={() => setEnding(null)} title={`End appointment: ${ending?.member.fullName ?? ''}`} description="The appointment moves to Leadership History and is kept permanently. To replace a leader, appoint the new one instead."
        onSubmit={async () => { await axios.post(`/leadership/appointments/${ending.id}/end`, { ...endF, notes: endF.notes || undefined }, { withCredentials: true }); toast.push('success', 'Appointment ended'); reload(); }}>
        <Field label="Reason"><Select value={endF.reason} onChange={(e) => setEndF({ ...endF, reason: e.target.value })} options={END_REASONS} /></Field>
        <Field label="Ended on"><Input type="date" value={endF.endDate} onChange={(e) => setEndF({ ...endF, endDate: e.target.value })} /></Field>
        <Field label="Notes" hint={endF.reason === 'other' ? 'Required' : undefined}><Textarea rows={2} value={endF.notes} onChange={(e) => setEndF({ ...endF, notes: e.target.value })} /></Field>
      </FormModal>

      <Modal open={!!suspending} onClose={() => setSuspending(null)} title={`Suspend ${suspending?.member.fullName ?? ''}`} description="Their access for this office is removed until they are reinstated. The appointment is kept."
        footer={<><Button onClick={() => setSuspending(null)}>Cancel</Button><Button variant="danger" disabled={!reason.trim()} onClick={() => { act(() => axios.post(`/leadership/appointments/${suspending.id}/suspend`, { reason }, { withCredentials: true }), 'Suspended'); setSuspending(null); }}>Suspend</Button></>}>
        <Field label="Reason" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>

      <Modal open={!!profileId} onClose={() => setProfileId(null)} title="Leader profile" width="lg">
        {profile.data && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Photo m={profile.data.member} size="lg" />
              <div>
                <p className="text-lg font-semibold">{profile.data.member.fullName}</p>
                <p className="text-sm text-ink-muted">{profile.data.member.registrationNumber} · {label(profile.data.member.gender)}</p>
              </div>
              {canManage && <><input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={(e) => uploadPhoto(e.target.files?.[0])} /><Button size="sm" className="ml-auto" onClick={() => photoInput.current?.click()}><CameraIcon className="h-4 w-4" /> Photo</Button></>}
            </div>
            <Card className="card-pad"><Row k="Phone" v={profile.data.member.phone ?? '—'} /><Row k="E-mail" v={profile.data.member.email ?? '—'} /><Row k="Membership" v={label(profile.data.member.status)} /></Card>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Appointments</h3>
              {profile.data.appointments.length === 0 ? <EmptyState title="No appointments" /> : (
                <ul className="space-y-2 text-sm">{profile.data.appointments.map((a: any) => (
                  <li key={a.id} className="rounded-control bg-surface-sunken px-3 py-2">
                    <span className="font-medium">{a.position.name}</span> · {a.departmentName ?? a.groupName ?? 'Fellowship'} <Badge tone={STATUS_TONE[a.status]}>{label(a.status)}</Badge>
                    <p className="text-xs text-ink-subtle">Appointed {fmtDate(a.appointmentDate)} · term {fmtDate(a.termStart)} – {a.endedAt ? fmtDate(a.endedAt) : a.termEnd ? fmtDate(a.termEnd) : 'open'}{a.endReason ? ` · ${label(a.endReason)}${a.endNotes ? `: ${a.endNotes}` : ''}` : ''}{a.suspensionReason && a.status === 'suspended' ? ` · suspended: ${a.suspensionReason}` : ''}</p>
                  </li>
                ))}</ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={showPositions} onClose={() => setShowPositions(false)} title="Leadership positions" width="lg">
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">Built-in FEMS offices grant their access automatically. Positions you add are kept as records only.</p>
          <ul className="space-y-1 text-sm">{(positions.data ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-control bg-surface-sunken px-3 py-1.5">
              <span className={p.is_active ? '' : 'text-ink-subtle line-through'}>{p.name} <span className="text-xs text-ink-subtle">({p.level}{p.is_system ? ', built-in' : ''})</span></span>
              {!p.is_system && <button className="text-xs text-primary hover:underline" onClick={async () => { try { await axios.put(`/leadership/positions/${p.id}`, { isActive: !p.is_active }, { withCredentials: true }); positions.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not change it.')); } }}>{p.is_active ? 'Deactivate' : 'Activate'}</button>}
            </li>
          ))}</ul>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="New position name" value={newPos.name} onChange={(e) => setNewPos({ ...newPos, name: e.target.value })} />
            <Select value={newPos.level} onChange={(e) => setNewPos({ ...newPos, level: e.target.value })} options={[{ value: 'fellowship', label: 'Fellowship' }, { value: 'department', label: 'Department' }, { value: 'group', label: 'Group' }]} />
            <Button disabled={!newPos.name.trim()} onClick={async () => { try { await axios.post('/leadership/positions', newPos, { withCredentials: true }); setNewPos({ name: '', level: 'fellowship', description: '' }); positions.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not add.')); } }}>Add position</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!credential} onClose={() => setCredential(null)} title="Login created" footer={<Button variant="primary" onClick={() => setCredential(null)}>Done</Button>}>
        {credential && <div className="space-y-2 text-sm"><p>A login was created for the new department leader. Share these details privately; they must change the password at first sign-in.</p><Row k="E-mail" v={credential.email} /><Row k="First password" v={<code>{credential.initialPassword}</code>} /></div>}
      </Modal>
    </div>
  );
}
