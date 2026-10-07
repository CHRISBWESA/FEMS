import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../App';
import { CurrencyDollarIcon, CheckIcon, XMarkIcon, PlusIcon, PencilSquareIcon, TrashIcon, BanknotesIcon } from '@heroicons/react/24/outline';
import FinanceIncomeTab from '../components/finance/FinanceIncomeTab';
import FinanceCampaignsTab from '../components/finance/FinanceCampaignsTab';
import FinancePeriodsTab from '../components/finance/FinancePeriodsTab';
import FinancePledgesTab from '../components/finance/FinancePledgesTab';
import FinanceReportsTab from '../components/finance/FinanceReportsTab';
import { errMsg } from '../components/finance/common';
import { EmptyState, PageLoader, Alert, Modal } from '../components/ui';

const CONTRIBUTION_TYPES = ['tithe', 'offering', 'thanksgiving', 'pledge', 'project', 'other'];
const RELEASE_METHODS = ['cash', 'bank_transfer', 'mobile_money', 'cheque', 'other'];
const APPROVABLE = ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED'];
const statusLabel = (s: string) => (s || '').toLowerCase().replace(/_/g, ' ');

const today = () => new Date().toISOString().slice(0, 10);
const emptyForms: Record<string, any> = {
  contributions: { memberId: '', amount: '', contributionType: 'tithe', date: today(), campaignId: '', categoryId: '', receiptDocumentId: '', notes: '' },
  expenses: { title: '', description: '', amount: '', date: today(), purpose: '', departmentId: '', categoryId: '', receiptDocumentId: '' },
  budgets: { title: '', description: '', amount: '', fiscalYear: String(new Date().getFullYear()), departmentId: '' },
  'money-requests': { title: '', description: '', amount: '', purpose: '', departmentId: '' },
};

// Tabs that are plain record lists share the table below; the others render their own component.
const LIST_TABS = ['contributions', 'expenses', 'budgets', 'money-requests'];

export default function Finance() {
  const { user, hasPermission, hasRole } = useAuth();
  const canRecord = user?.roles.includes('treasurer') || user?.roles.includes('secretary');
  const canRequestMoney =
    user?.roles.includes('secretary') || user?.roles.includes('assistant_secretary') ||
    user?.roles.includes('department_secretary') || user?.roles.includes('department_chairperson');
  const isDeptLeader = hasRole('department_secretary') || hasRole('department_chairperson');
  const isFinanceViewer = ['treasurer', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson'].some((r) => hasRole(r));
  // Who can be an approver on each list (the server enforces the exact stage/role; this only hides buttons nobody could use).
  const canApprove = (tab: string) =>
    ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson'].some((r) => hasRole(r)) ||
    (tab === 'money-requests' && hasRole('treasurer'));
  const isTreasurer = hasRole('treasurer');

  const [activeTab, setActiveTab] = useState(isFinanceViewer ? 'contributions' : 'expenses');
  const [data, setData] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<any>(emptyForms.contributions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [releasing, setReleasing] = useState<any>(null);
  const [releaseForm, setReleaseForm] = useState<any>({ method: 'cash', reference: '', notes: '' });

  const tabs = [
    ...(isFinanceViewer ? [{ id: 'contributions', label: 'Contributions' }] : []),
    { id: 'expenses', label: 'Expenses' },
    { id: 'budgets', label: 'Budgets' },
    { id: 'money-requests', label: 'Money Requests' },
    ...(isFinanceViewer ? [
      { id: 'income', label: 'Income' },
      { id: 'campaigns', label: 'Campaigns' },
      { id: 'pledges', label: 'Pledges' },
      { id: 'periods', label: 'Periods' },
    ] : []),
    ...(hasPermission('finance.reports_view') || hasPermission('finance.department_view') ? [{ id: 'reports', label: 'Reports' }] : []),
  ];

  useEffect(() => {
    if (LIST_TABS.includes(activeTab)) fetchTab();
  }, [activeTab]);

  useEffect(() => {
    if (canRecord) {
      axios.get('/members?limit=100&status=active', { withCredentials: true })
        .then(res => setMembers(res.data?.data || []))
        .catch(() => {});
      axios.get('/finance/campaigns?status=active', { withCredentials: true }).then((r) => setCampaigns(r.data)).catch(() => {});
      axios.get('/finance/categories', { withCredentials: true }).then((r) => setCategories(r.data.filter((c: any) => c.is_active))).catch(() => {});
      axios.get('/it-content/documents', { withCredentials: true })
        .then((r) => setDocuments((Array.isArray(r.data) ? r.data : []).filter((d: any) => !d.is_website_content)))
        .catch(() => {});
    }
    if (canRecord || hasRole('assistant_secretary')) {
      axios.get('/departments', { withCredentials: true }).then((r) => setDepartments(r.data)).catch(() => {});
    }
  }, []);

  const fetchTab = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/finance/${activeTab}`, { withCredentials: true });
      setData(res.data);
    } catch (err: any) {
      console.error(err);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setForm(emptyForms[activeTab]);
    setError('');
    setShowCreate(true);
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      let payload: any = {};
      const optional = (v: string) => (v ? v : undefined);
      if (activeTab === 'contributions') {
        payload = {
          memberId: form.memberId,
          amount: Number(form.amount),
          contributionType: form.contributionType,
          date: form.date,
          campaignId: optional(form.campaignId),
          categoryId: optional(form.categoryId),
          receiptDocumentId: optional(form.receiptDocumentId),
          notes: optional(form.notes),
        };
      } else if (activeTab === 'expenses') {
        payload = {
          title: form.title,
          description: optional(form.description),
          amount: Number(form.amount),
          date: form.date,
          purpose: form.purpose,
          departmentId: optional(form.departmentId),
          categoryId: optional(form.categoryId),
          receiptDocumentId: optional(form.receiptDocumentId),
        };
      } else if (activeTab === 'budgets') {
        payload = {
          title: form.title,
          description: optional(form.description),
          amount: Number(form.amount),
          fiscalYear: form.fiscalYear,
          departmentId: optional(form.departmentId),
        };
      } else {
        payload = {
          title: form.title,
          description: optional(form.description),
          amount: Number(form.amount),
          purpose: form.purpose,
          // Department leaders always request for their own department (the server enforces it).
          departmentId: isDeptLeader ? undefined : optional(form.departmentId),
        };
      }
      await axios.post(`/finance/${activeTab}`, payload, { withCredentials: true });
      setShowCreate(false);
      fetchTab();
    } catch (err: any) {
      setError(errMsg(err, 'Failed to save record'));
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (type: string, id: string, decision: string) => {
    try {
      await axios.post(`/finance/${type}/${id}/approve`, { decision, comment: 'Reviewed' }, { withCredentials: true });
      fetchTab();
    } catch (err: any) {
      alert(errMsg(err, 'Failed'));
    }
  };

  // Edit/delete of a recorded item is a REQUEST: nothing changes until the approval chain completes.
  const requestChange = async (entity: 'contributions' | 'expenses', kind: 'edit' | 'delete', id: string) => {
    const body: any = {};
    if (kind === 'edit') {
      const amount = prompt('New amount (the proposed correction):');
      if (amount === null || amount.trim() === '') return;
      body.amount = Number(amount);
    }
    const reason = prompt(kind === 'edit' ? 'Why is this change needed?' : 'Reason for deletion request:');
    if (!reason) return;
    body.reason = reason;
    try {
      await axios.post(`/finance/${entity}/${id}/${kind}-request`, body, { withCredentials: true });
      alert('Request submitted. It changes nothing until the Secretary and Chairperson approve it (see Approvals).');
    } catch (err: any) {
      alert(errMsg(err, 'Failed to submit request'));
    }
  };

  const submitRelease = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await axios.post(`/finance/money-requests/${releasing.id}/release`, {
        method: releaseForm.method,
        reference: releaseForm.reference || undefined,
        notes: releaseForm.notes || undefined,
      }, { withCredentials: true });
      setReleasing(null);
      fetchTab();
    } catch (err: any) {
      setError(errMsg(err, 'Failed to release funds'));
    }
  };

  const resubmitMoneyRequest = async (id: string) => {
    try {
      await axios.post(`/finance/money-requests/${id}/resubmit`, {}, { withCredentials: true });
      fetchTab();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to resubmit');
    }
  };

  const columnsByTab: Record<string, { key: string; label: string; render?: (item: any) => any }[]> = {
    contributions: [
      { key: 'amount', label: 'Amount', render: (i) => `$${Number(i.amount).toLocaleString()}` },
      { key: 'contribution_type', label: 'Type', render: (i) => <span className="capitalize">{(i.contribution_type || '').replace('_', ' ')}</span> },
      { key: 'date', label: 'Date', render: (i) => i.date ? new Date(i.date).toLocaleDateString() : '—' },
      { key: 'member_id', label: 'Member', render: (i) => i.member?.full_name || members.find((m) => m.id === i.member_id)?.full_name || i.member_id },
      { key: 'campaign', label: 'Campaign', render: (i) => i.campaign?.name || '—' },
    ],
    expenses: [
      { key: 'title', label: 'Title' },
      { key: 'amount', label: 'Amount', render: (i) => `$${Number(i.amount).toLocaleString()}` },
      { key: 'purpose', label: 'Purpose' },
      { key: 'date', label: 'Date', render: (i) => i.date ? new Date(i.date).toLocaleDateString() : '—' },
      { key: 'approval_status', label: 'Status', render: (i) => <span className={`status-badge ${i.approval_status === 'FINAL_APPROVED' ? 'status-graduated' : i.approval_status === 'REJECTED' ? 'status-inactive' : 'status-draft'} capitalize`}>{(i.approval_status || '').toLowerCase().replace(/_/g, ' ')}</span> },
    ],
    budgets: [
      { key: 'title', label: 'Title' },
      { key: 'amount', label: 'Amount', render: (i) => `$${Number(i.amount).toLocaleString()}` },
      { key: 'fiscal_year', label: 'Fiscal Year' },
      { key: 'approval_status', label: 'Status', render: (i) => <span className={`status-badge ${i.approval_status === 'FINAL_APPROVED' ? 'status-graduated' : i.approval_status === 'REJECTED' ? 'status-inactive' : 'status-draft'} capitalize`}>{(i.approval_status || '').toLowerCase().replace(/_/g, ' ')}</span> },
    ],
    'money-requests': [
      { key: 'title', label: 'Title' },
      { key: 'amount', label: 'Amount', render: (i) => `$${Number(i.amount).toLocaleString()}` },
      { key: 'purpose', label: 'Purpose' },
      { key: 'approval_status', label: 'Status', render: (i) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`status-badge ${i.approval_status === 'FINAL_APPROVED' ? 'status-graduated' : i.approval_status === 'REJECTED' ? 'status-inactive' : 'status-draft'} capitalize`}>{statusLabel(i.approval_status)}</span>
          {i.release && <span className="status-badge status-active">released {new Date(i.release.released_at).toLocaleDateString()}</span>}
        </div>
      ) },
    ],
  };

  const columns = columnsByTab[activeTab];
  const approveEntityType = activeTab.replace('-', '_');

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Finance</h1>
          <p className="page-desc">Contributions, income, expenses, budgets, money requests and reports.</p>
        </div>
        {LIST_TABS.includes(activeTab) && ((activeTab !== 'money-requests' && canRecord) || (activeTab === 'money-requests' && canRequestMoney)) && (
          <button onClick={openCreate} className="btn btn-primary">
            <PlusIcon className="h-4 w-4" />
            New {tabs.find(t => t.id === activeTab)?.label.replace(/s$/, '')}
          </button>
        )}
      </div>

      <div className="tabs mb-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`tab ${activeTab === tab.id ? 'tab-active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'income' && <FinanceIncomeTab />}
      {activeTab === 'campaigns' && <FinanceCampaignsTab />}
      {activeTab === 'pledges' && <FinancePledgesTab />}
      {activeTab === 'periods' && <FinancePeriodsTab />}
      {activeTab === 'reports' && <FinanceReportsTab />}

      {!LIST_TABS.includes(activeTab) ? null : loading ? (
        <PageLoader rows={2} />
      ) : Array.isArray(data) && data.length === 0 ? (
        <EmptyState title="No records found" description={`No ${activeTab.replace('-', ' ')} records yet.`} />
      ) : Array.isArray(data) ? (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                {columns.map(col => <th key={col.key}>{col.label}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item: any) => (
                <tr key={item.id}>
                  {columns.map(col => (
                    <td key={col.key} className={col.key === 'amount' ? 'font-medium text-ink' : ''}>
                      {col.render ? col.render(item) : item[col.key] ?? '—'}
                    </td>
                  ))}
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {(activeTab === 'expenses' || activeTab === 'budgets' || activeTab === 'money-requests') &&
                        APPROVABLE.includes(item.approval_status) && canApprove(activeTab) && (
                        <>
                          <button onClick={() => handleApprove(approveEntityType, item.id, 'approved')} className="btn btn-success btn-sm">
                            <CheckIcon className="h-3.5 w-3.5" /> Approve
                          </button>
                          <button onClick={() => handleApprove(approveEntityType, item.id, 'rejected')} className="btn btn-danger btn-sm">
                            <XMarkIcon className="h-3.5 w-3.5" /> Reject
                          </button>
                        </>
                      )}
                      {activeTab === 'contributions' && canRecord && (
                        <>
                          <button onClick={() => requestChange('contributions', 'edit', item.id)} className="btn btn-secondary btn-sm" title="Request edit">
                            <PencilSquareIcon className="h-3.5 w-3.5" /> Edit Request
                          </button>
                          <button onClick={() => requestChange('contributions', 'delete', item.id)} className="btn btn-danger btn-sm" title="Request deletion">
                            <TrashIcon className="h-3.5 w-3.5" /> Delete Request
                          </button>
                        </>
                      )}
                      {activeTab === 'expenses' && canRecord && (
                        <button onClick={() => requestChange('expenses', 'edit', item.id)} className="btn btn-secondary btn-sm">
                          <PencilSquareIcon className="h-3.5 w-3.5" /> Edit Request
                        </button>
                      )}
                      {activeTab === 'money-requests' && item.approval_status === 'FINAL_APPROVED' && !item.release && isTreasurer && (
                        <button onClick={() => { setError(''); setReleaseForm({ method: 'cash', reference: '', notes: '' }); setReleasing(item); }} className="btn btn-primary btn-sm">
                          <BanknotesIcon className="h-3.5 w-3.5" /> Release funds
                        </button>
                      )}
                      {activeTab === 'money-requests' && item.approval_status === 'REJECTED' && canRequestMoney && (
                        <button onClick={() => resubmitMoneyRequest(item.id)} className="btn btn-secondary btn-sm">
                          Resubmit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form onSubmit={submitCreate} onClick={(e) => e.stopPropagation()} className="modal max-w-md">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <CurrencyDollarIcon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-ink">
                  New {tabs.find(t => t.id === activeTab)?.label.replace(/s$/, '')}
                </h3>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="alert alert-danger mb-4" role="alert">
                {error}
              </div>
            )}

            <div className="space-y-4">
              {activeTab === 'contributions' && (
                <>
                  <div>
                    <label className="label">Member *</label>
                    <select required className="select" value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
                      <option value="">Select member…</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.member_code})</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Amount *</label>
                      <input type="number" min="0" step="0.01" required className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Type *</label>
                      <select required className="select" value={form.contributionType} onChange={(e) => setForm({ ...form, contributionType: e.target.value })}>
                        {CONTRIBUTION_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label">Date *</label>
                    <input type="date" required max={today()} className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Campaign</label>
                      <select className="select" value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })}>
                        <option value="">None</option>
                        {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Category</label>
                      <select className="select" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                        <option value="">None</option>
                        {categories.filter((c) => c.kind === 'contribution').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label">Receipt (optional)</label>
                    <select className="select" value={form.receiptDocumentId} onChange={(e) => setForm({ ...form, receiptDocumentId: e.target.value })}>
                      <option value="">No receipt attached</option>
                      {documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-ink-subtle">Receipts are documents uploaded under IT Content.</p>
                  </div>
                  <div>
                    <label className="label">Notes</label>
                    <input className="input" maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                </>
              )}

              {activeTab === 'expenses' && (
                <>
                  <div>
                    <label className="label">Title *</label>
                    <input required className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Description</label>
                    <textarea rows={2} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Amount *</label>
                      <input type="number" min="0" step="0.01" required className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Date *</label>
                      <input type="date" required className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="label">Purpose *</label>
                    <input required className="input" placeholder="What was this spent on?" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Department</label>
                      <select className="select" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                        <option value="">Fellowship-wide</option>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Category</label>
                      <select className="select" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                        <option value="">None</option>
                        {categories.filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label">Receipt (optional)</label>
                    <select className="select" value={form.receiptDocumentId} onChange={(e) => setForm({ ...form, receiptDocumentId: e.target.value })}>
                      <option value="">No receipt attached</option>
                      {documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                    </select>
                  </div>
                </>
              )}

              {activeTab === 'budgets' && (
                <>
                  <div>
                    <label className="label">Title *</label>
                    <input required className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Description</label>
                    <textarea rows={2} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Amount *</label>
                      <input type="number" min="0" step="0.01" required className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Fiscal Year *</label>
                      <input type="number" min="2020" max="2100" required className="input" value={form.fiscalYear} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="label">Department</label>
                    <select className="select" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                      <option value="">Fellowship-wide</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                </>
              )}

              {activeTab === 'money-requests' && (
                <>
                  <div>
                    <label className="label">Title *</label>
                    <input required className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Description</label>
                    <textarea rows={2} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Amount *</label>
                      <input type="number" min="0" step="0.01" required className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Purpose *</label>
                      <input required className="input" placeholder="Why is it needed?" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
                    </div>
                  </div>
                  {isDeptLeader ? (
                    <p className="text-xs text-ink-muted">This request is raised for your own department.</p>
                  ) : (
                    <div>
                      <label className="label">Department</label>
                      <select className="select" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                        <option value="">Fellowship-wide</option>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? <span className="spinner border-white" /> : 'Save'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {releasing && (
        <Modal open title="Release funds" onClose={() => setReleasing(null)}>
          <form onSubmit={submitRelease} className="space-y-4">
            <Alert tone="danger">{error}</Alert>
            <p className="text-sm text-ink-muted">
              Record that <span className="font-medium">${Number(releasing.amount).toLocaleString()}</span> for "{releasing.title}" has been paid out.
              This can be done only once and cannot be undone here.
            </p>
            <div>
              <label className="label">Method *</label>
              <select className="select" value={releaseForm.method} onChange={(e) => setReleaseForm({ ...releaseForm, method: e.target.value })}>
                {RELEASE_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Reference (e.g. transaction number)</label>
              <input className="input" maxLength={100} value={releaseForm.reference} onChange={(e) => setReleaseForm({ ...releaseForm, reference: e.target.value })} />
            </div>
            <div>
              <label className="label">Notes</label>
              <input className="input" maxLength={500} value={releaseForm.notes} onChange={(e) => setReleaseForm({ ...releaseForm, notes: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary flex-1">Confirm release</button>
              <button type="button" onClick={() => setReleasing(null)} className="btn btn-secondary flex-1">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
