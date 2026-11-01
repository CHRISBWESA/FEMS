import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { UserPlusIcon, TrashIcon, UsersIcon } from '@heroicons/react/24/outline';
import { Alert, Badge, Button, ConfirmDialog, IconButton, Modal, StatCard, StatGrid, useToast } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import { Detail, ExportButton, errMsg, fmtDate, useWorkspace } from './shared';

type Member = { id: string; fullName: string; memberCode: string; gender: string | null; email: string | null; phone: string | null; status: string; programme: string | null; joinedAt?: string; inDepartment?: boolean };

const PAGE = 20;

function Filters({ gender, status, onGender, onStatus }: { gender: string; status: string; onGender: (v: string) => void; onStatus: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <select className="select w-auto" aria-label="Gender" value={gender} onChange={(e) => onGender(e.target.value)}>
        <option value="">Any gender</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
      </select>
      <select className="select w-auto" aria-label="Status" value={status} onChange={(e) => onStatus(e.target.value)}>
        <option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="graduated">Graduated</option>
      </select>
    </div>
  );
}

function useList(url: string, deps: unknown[]) {
  const [rows, setRows] = useState<Member[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    axios.get(url, { withCredentials: true })
      .then((r) => { setRows(r.data.data); setTotal(r.data.total); setError(''); })
      .catch((e) => setError(errMsg(e, 'Could not load members.')))
      .finally(() => setLoading(false));
  }, deps);
  useEffect(() => {
    const h = setTimeout(load, 250);
    return () => clearTimeout(h);
  }, [load]);
  return { rows, total, error, loading, reload: load };
}

function query(o: Record<string, string | number>) {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== '' && v !== undefined) p.set(k, String(v)); });
  return p.toString();
}

export default function WsMembers() {
  const { base, department } = useWorkspace();
  const { t } = useI18n();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [gender, setGender] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<any>(null);
  const [adding, setAdding] = useState(params.get('add') === '1');
  const [removing, setRemoving] = useState<Member | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [viewing, setViewing] = useState<any>(null);

  useEffect(() => setPage(1), [search, gender, status]);
  const qs = query({ search, gender, status, page, limit: PAGE });
  const list = useList(`${base}/members?${qs}`, [base, qs]);
  const loadStats = useCallback(() => { axios.get(`${base}/members/stats`, { withCredentials: true }).then((r) => setStats(r.data)).catch(() => {}); }, [base]);
  useEffect(loadStats, [loadStats]);

  const refresh = () => { list.reload(); loadStats(); };
  const closeAdd = useCallback(() => { setAdding(false); if (params.get('add')) { params.delete('add'); setParams(params, { replace: true }); } }, [params, setParams]);

  const open = async (m: Member) => {
    try { setViewing((await axios.get(`${base}/members/${m.id}`, { withCredentials: true })).data); } catch (e) { toast.push('error', errMsg(e, 'Could not open the member.')); }
  };

  const remove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      const r = await axios.post(`${base}/members/${removing.id}/remove`, {}, { withCredentials: true });
      toast.push('success', r.data.message);
      setRemoving(null);
      refresh();
    } catch (e) { toast.push('error', errMsg(e, 'Could not remove the member.')); } finally { setRemoveBusy(false); }
  };

  const columns: Column<Member>[] = [
    { key: 'name', header: 'Name', priority: 'primary', render: (m) => <button className="font-medium text-ink hover:text-primary" onClick={() => open(m)}>{m.fullName}</button> },
    { key: 'code', header: 'Code', render: (m) => <span className="font-mono text-xs text-ink-subtle">{m.memberCode}</span> },
    { key: 'gender', header: 'Gender', priority: 'meta', render: (m) => <span className="capitalize">{m.gender || '—'}</span> },
    { key: 'status', header: 'Status', priority: 'secondary', render: (m) => <span className="capitalize">{m.status}</span> },
    { key: 'phone', header: 'Phone', priority: 'secondary', render: (m) => m.phone || '—' },
    { key: 'joined', header: 'Joined', priority: 'secondary', render: (m) => fmtDate(m.joinedAt) },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('ws.members')}</h1>
          <p className="page-desc">Members of {department.name}, chosen from the fellowship's register.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton url={`${base}/members/export?${query({ search, gender, status })}`} filename={`${department.name}-members.csv`} />
          <Button variant="primary" onClick={() => setAdding(true)}><UserPlusIcon className="h-4 w-4" /> {t('ws.addMembers')}</Button>
        </div>
      </div>

      {stats && (
        <StatGrid>
          <StatCard label={t('ws.totalMembers')} value={stats.total} icon={<UsersIcon className="h-5 w-5" />} tone="primary" />
          <StatCard label={t('ws.male')} value={stats.male} />
          <StatCard label={t('ws.female')} value={stats.female} />
          <StatCard label="Active" value={stats.active} hint={`${stats.inactive} inactive · ${stats.graduated} graduated`} />
        </StatGrid>
      )}

      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(m) => m.id}
        loading={list.loading && list.rows === null}
        error={list.error || null}
        onRetry={list.reload}
        caption={`Members of ${department.name}`}
        total={list.total}
        page={page}
        pageSize={PAGE}
        onPageChange={setPage}
        search={{ value: search, onChange: setSearch, placeholder: 'Search by name, code, e-mail or phone' }}
        toolbar={<Filters gender={gender} status={status} onGender={setGender} onStatus={setStatus} />}
        rowActions={(m) => <IconButton label={`Remove ${m.fullName}`} icon={<TrashIcon className="h-4 w-4 text-rose-500" />} onClick={() => setRemoving(m)} />}
        empty={search || gender || status
          ? { title: 'No members match', description: 'Try a different search or clear the filters.' }
          : { title: 'No members yet', description: 'Add registered members of the fellowship to this department.', action: <Button variant="primary" onClick={() => setAdding(true)}>{t('ws.addMembers')}</Button> }}
      />

      <AddMembersModal open={adding} onClose={closeAdd} onAdded={(r) => {
        closeAdd();
        toast.push(r.rejected.length ? 'info' : 'success', `${r.added} added${r.alreadyMember ? `, ${r.alreadyMember} already in the department` : ''}${r.rejected.length ? `, ${r.rejected.length} could not be added` : ''}`);
        refresh();
      }} />

      <ConfirmDialog
        open={!!removing}
        title="Remove member"
        message={`Remove ${removing?.fullName ?? ''} from ${department.name}? Their member record and their other departments are not affected.`}
        confirmLabel="Remove"
        loading={removeBusy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.fullName ?? ''} description={viewing?.memberCode}>
        {viewing && (
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Gender"><span className="capitalize">{viewing.gender || 'Not recorded'}</span></Detail>
            <Detail label="Status"><span className="capitalize">{viewing.status}</span></Detail>
            <Detail label="E-mail">{viewing.email}</Detail>
            <Detail label="Phone">{viewing.phone}</Detail>
            <Detail label="Programme">{viewing.programme}</Detail>
            <Detail label="Year of study">{viewing.yearOfStudy}</Detail>
            <Detail label="Joined the department">{fmtDate(viewing.joinedAt)}</Detail>
            <Detail label="Departments">{viewing.departments?.map((d: any) => d.name).join(', ')}</Detail>
          </dl>
        )}
      </Modal>
    </div>
  );
}

function AddMembersModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (r: { added: number; alreadyMember: number; rejected: string[] }) => void }) {
  const { base, department } = useWorkspace();
  const [search, setSearch] = useState('');
  const [gender, setGender] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (open) { setSearch(''); setGender(''); setStatus('active'); setPage(1); setSelected([]); setConfirming(false); setError(''); } }, [open]);
  useEffect(() => setPage(1), [search, gender, status]);
  const qs = query({ search, gender, status, page, limit: 25 });
  const list = useList(`${base}/members/candidates?${qs}`, [base, qs, open]);
  const pageIds = (list.rows || []).map((r) => r.id);
  const already = (list.rows || []).filter((r) => r.inDepartment).map((r) => r.id);

  const save = async () => {
    setSaving(true);
    setError('');
    try { onAdded((await axios.post(`${base}/members`, { memberIds: selected }, { withCredentials: true })).data); }
    catch (e) { setError(errMsg(e, 'Could not add the members.')); setConfirming(false); }
    finally { setSaving(false); }
  };

  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title={confirming ? 'Confirm' : `Add members to ${department.name}`}
      description={confirming ? undefined : 'Choose from members already registered in the fellowship. Members can belong to more than one department.'}
      footer={confirming ? (
        <>
          <Button onClick={() => setConfirming(false)}>Back</Button>
          <Button variant="primary" loading={saving} onClick={save}>Add {selected.length}</Button>
        </>
      ) : (
        <>
          <span className="mr-auto self-center text-sm text-ink-muted">{selected.length} selected</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!selected.length} onClick={() => setConfirming(true)}>Continue</Button>
        </>
      )}
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {confirming ? (
        <p className="text-sm text-ink">Add {selected.length} {selected.length === 1 ? 'member' : 'members'} to {department.name}?</p>
      ) : (
        <DataTable
          columns={[
            { key: 'name', header: 'Member', priority: 'primary', render: (m: Member) => <span className="flex flex-wrap items-center gap-2"><span className="font-medium text-ink">{m.fullName}</span>{m.inDepartment && <Badge tone="info">In department</Badge>}</span> },
            { key: 'code', header: 'Code', render: (m: Member) => <span className="font-mono text-xs text-ink-subtle">{m.memberCode}</span> },
            { key: 'gender', header: 'Gender', priority: 'meta', render: (m: Member) => <span className="capitalize">{m.gender || '—'}</span> },
            { key: 'status', header: 'Status', priority: 'secondary', render: (m: Member) => <span className="capitalize">{m.status}</span> },
          ] as Column<Member>[]}
          rows={list.rows}
          rowKey={(m) => m.id}
          loading={list.loading && list.rows === null}
          error={list.error || null}
          caption="Registered members"
          total={list.total}
          page={page}
          pageSize={25}
          onPageChange={setPage}
          search={{ value: search, onChange: setSearch, placeholder: 'Search registered members' }}
          toolbar={<Filters gender={gender} status={status} onGender={setGender} onStatus={setStatus} />}
          selectable={{
            selected: [...selected, ...already],
            onChange: (next) => {
              const set = new Set(next);
              setSelected([...selected.filter((id) => !pageIds.includes(id)), ...pageIds.filter((id) => set.has(id) && !already.includes(id))]);
            },
            label: (m) => (m.inDepartment ? `${m.fullName} is already in the department` : `Select ${m.fullName}`),
          }}
          empty={{ title: 'No members match', description: 'Try a different search.' }}
          loadingRows={5}
        />
      )}
    </Modal>
  );
}

