import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../App';
import { DocumentTextIcon, CheckIcon, XMarkIcon, PlusIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

const emptyForm = {
  departmentId: '',
  title: '',
  content: '',
};

export default function Reports() {
  const { user } = useAuth();
  const isDeptLeader =
    user?.roles.includes('department_secretary') || user?.roles.includes('department_chairperson');
  const isSecretaryStage =
    user?.roles.includes('secretary') || user?.roles.includes('assistant_secretary');
  const isChairStage =
    user?.roles.includes('chairperson') || user?.roles.includes('assistant_chairperson');
  const canReview = (status: string) =>
    (isSecretaryStage && (status === 'SUBMITTED' || status === 'RESUBMITTED')) ||
    (isChairStage && status === 'UNDER_REVIEW');

  const [reports, setReports] = useState([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSubmit, setShowSubmit] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchReports();
    if (isDeptLeader) {
      axios.get('/departments', { withCredentials: true })
        .then(res => setDepartments(res.data))
        .catch(() => {});
    }
  }, []);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/reports', { withCredentials: true });
      setReports(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const submitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await axios.post('/reports', form, { withCredentials: true });
      setShowSubmit(false);
      setForm(emptyForm);
      fetchReports();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit report');
    } finally {
      setSaving(false);
    }
  };

  const handleReview = async (id: string, decision: string) => {
    const comment = decision === 'rejected' ? (prompt('Rejection reason:') || '') : 'Reviewed';
    if (decision === 'rejected' && !comment) return;
    try {
      await axios.post(`/reports/${id}/review`, { decision, comment }, { withCredentials: true });
      fetchReports();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed');
    }
  };

  const handleResubmit = async (id: string) => {
    try {
      await axios.post(`/reports/${id}/resubmit`, {}, { withCredentials: true });
      fetchReports();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to resubmit');
    }
  };

  const statusClasses: Record<string, string> = {
    DRAFT: 'status-draft',
    SUBMITTED: 'status-submitted',
    UNDER_REVIEW: 'status-final',
    APPROVED: 'status-approved',
    REJECTED: 'status-rejected',
    RESUBMITTED: 'status-submitted',
    FINAL_APPROVED: 'status-final',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-desc">Submit, review and approve fellowship reports.</p>
        </div>
        {isDeptLeader && (
          <button onClick={() => { setError(''); setShowSubmit(true); }} className="btn btn-primary">
            <PlusIcon className="h-4 w-4" />
            Submit Report
          </button>
        )}
      </div>

      {reports.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-surface-sunken text-ink-subtle">
            <DocumentTextIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No reports found</p>
          <p className="empty-desc">Reports will appear here once submitted.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((r: any) => (
            <div key={r.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-base font-semibold text-ink">{r.title}</h3>
                    <span className={`status-badge ${statusClasses[r.status] || 'status-draft'}`}>
                      {r.status?.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    Submitted: {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '—'}
                  </p>
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {String(r.content || '').replace(/<[^>]+>/g, '').substring(0, 200)}
                  </p>
                </div>
              </div>
              {(canReview(r.status) || (isDeptLeader && r.status === 'REJECTED')) ? (
                <div className="mt-4 flex gap-2 border-t border-hairline pt-4">
                  {canReview(r.status) && (
                    <>
                      <button onClick={() => handleReview(r.id, 'approved')} className="btn btn-success btn-sm">
                        <CheckIcon className="h-4 w-4" /> Approve
                      </button>
                      <button onClick={() => handleReview(r.id, 'rejected')} className="btn btn-danger btn-sm">
                        <XMarkIcon className="h-4 w-4" /> Reject
                      </button>
                    </>
                  )}
                  {isDeptLeader && r.status === 'REJECTED' && (
                    <button onClick={() => handleResubmit(r.id)} className="btn btn-secondary btn-sm">
                      <ArrowPathIcon className="h-4 w-4" /> Resubmit
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {showSubmit && (
        <div className="modal-backdrop" onClick={() => setShowSubmit(false)}>
          <form onSubmit={submitReport} onClick={(e) => e.stopPropagation()} className="modal max-w-lg">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <DocumentTextIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Submit Report</h3>
                  <p className="text-xs text-ink-muted">Goes through secretary then chairperson review.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowSubmit(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="label">Department *</label>
                <select required className="select" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">Select department…</option>
                  {departments.filter(d => d.is_active !== false).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Title *</label>
                <input required className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <label className="label">Content *</label>
                <textarea required rows={8} className="input" placeholder="Write the report…" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? <span className="spinner border-white" /> : 'Submit Report'}
              </button>
              <button type="button" onClick={() => setShowSubmit(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
