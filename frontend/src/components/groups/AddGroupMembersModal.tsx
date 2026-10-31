import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Alert, Badge, Button, Modal } from '../ui';
import { DataTable, type Column } from '../DataTable';

type Candidate = { id: string; full_name: string; member_code: string; gender: string | null; membership_status: string };

const PAGE_SIZE = 25;

/**
 * Picks existing members to add to a group: search, filter by gender / status / department, tick several, add.
 * Members already in the group are shown but cannot be ticked, so nobody is added twice.
 */
export default function AddGroupMembersModal({
  open,
  groupId,
  groupName,
  existingIds,
  onClose,
  onAdded,
}: {
  open: boolean;
  groupId: string;
  groupName: string;
  existingIds: string[];
  onClose: () => void;
  onAdded: (result: { added: number; alreadyMember: number; rejected: string[] }) => void;
}) {
  const [search, setSearch] = useState('');
  const [gender, setGender] = useState('');
  const [status, setStatus] = useState('active');
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const existing = useMemo(() => new Set(existingIds), [existingIds]);

  useEffect(() => {
    if (!open) return;
    setSearch(''); setGender(''); setStatus('active'); setDepartmentId(''); setPage(1);
    setSelected([]); setSaveError('');
    axios.get('/departments', { withCredentials: true })
      .then((r) => setDepartments(Array.isArray(r.data) ? r.data : r.data?.data || []))
      .catch(() => setDepartments([]));
  }, [open]);

  useEffect(() => { setPage(1); }, [search, gender, status, departmentId]);

  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (search.trim()) params.set('search', search.trim());
    if (gender) params.set('gender', gender);
    if (status) params.set('status', status);
    if (departmentId) params.set('departmentId', departmentId);
    setLoading(true);
    const handle = setTimeout(() => {
      axios.get(`/members?${params}`, { withCredentials: true })
        .then((r) => { setRows(r.data?.data || []); setTotal(r.data?.total ?? 0); setError(''); })
        .catch((e) => setError(e.response?.data?.message || 'Could not load members.'))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [open, page, search, gender, status, departmentId]);

  const pageIds = (rows || []).map((r) => r.id);

  const add = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await axios.post(`/member-groups/${groupId}/members`, { memberIds: selected }, { withCredentials: true });
      onAdded(res.data);
    } catch (e: any) {
      setSaveError(e.response?.data?.message || 'Could not add the selected members.');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<Candidate>[] = [
    {
      key: 'name', header: 'Member', priority: 'primary',
      render: (m) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">{m.full_name}</span>
          {existing.has(m.id) && <Badge tone="info">Already in group</Badge>}
        </span>
      ),
    },
    { key: 'code', header: 'Code', render: (m) => <span className="font-mono text-xs text-ink-subtle">{m.member_code}</span> },
    { key: 'gender', header: 'Gender', priority: 'meta', render: (m) => <span className="capitalize">{m.gender || '—'}</span> },
    { key: 'status', header: 'Status', priority: 'secondary', render: (m) => <span className="capitalize">{m.membership_status}</span> },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title={`Add members to ${groupName}`}
      description="Choose from the members already registered. Members can belong to more than one group."
      footer={
        <>
          <span className="mr-auto self-center text-sm text-ink-muted">{selected.length} selected</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={add} loading={saving} disabled={selected.length === 0}>
            Add {selected.length > 0 ? selected.length : ''} {selected.length === 1 ? 'member' : 'members'}
          </Button>
        </>
      }
    >
      {saveError && <Alert tone="danger" className="mb-4">{saveError}</Alert>}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(m) => m.id}
        loading={loading && rows === null}
        error={error || null}
        caption="Registered members"
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        search={{ value: search, onChange: setSearch, placeholder: 'Search by name, e-mail or code' }}
        toolbar={
          <div className="flex flex-wrap gap-2">
            <select className="select w-auto" aria-label="Gender" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Any gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
            <select className="select w-auto" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="graduated">Graduated</option>
            </select>
            {departments.length > 0 && (
              <select className="select w-auto" aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">Any department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
        }
        selectable={{
          // Members already in the group show as ticked and cannot be unticked or re-added. Ticks made on other
          // pages are kept while paging or filtering.
          selected: [...selected, ...pageIds.filter((id) => existing.has(id))],
          onChange: (next) => {
            const nextSet = new Set(next);
            const offPage = selected.filter((id) => !pageIds.includes(id));
            const onPage = pageIds.filter((id) => nextSet.has(id) && !existing.has(id));
            setSelected([...offPage, ...onPage]);
          },
          label: (m) => (existing.has(m.id) ? `${m.full_name} is already in the group` : `Select ${m.full_name}`),
        }}
        empty={{ title: 'No members match', description: 'Try a different search or clear the filters.' }}
        loadingRows={5}
      />
    </Modal>
  );
}
