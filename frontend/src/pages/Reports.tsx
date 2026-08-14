import { useState, useEffect } from 'react';
import axios from 'axios';
import { DocumentTextIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

export default function Reports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/reports', { withCredentials: true })
      .then(res => setReports(res.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const statusClasses: Record<string, string> = {
    DRAFT: 'status-draft',
    SUBMITTED: 'status-submitted',
    UNDER_REVIEW: 'status-final',
    APPROVED: 'status-approved',
    REJECTED: 'status-rejected',
    RESUBMITTED: 'status-submitted',
    FINAL_APPROVED: 'status-final',
  };

  const handleApprove = async (id: string, decision: string) => {
    try {
      await axios.post(`/reports/${id}/review`, {
        decision,
        comment: 'Reviewed',
      }, { withCredentials: true });
      window.location.reload();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed');
    }
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
      </div>

      {reports.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <DocumentTextIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No reports found</p>
          <p className="empty-desc">Reports will appear here once submitted.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((r: any) => (
            <div key={r._id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-base font-semibold text-slate-900">{r.title}</h3>
                    <span className={`status-badge ${statusClasses[r.status] || 'status-draft'}`}>
                      {r.status?.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    Submitted: {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '—'}
                  </p>
                  <div
                    dangerouslySetInnerHTML={{ __html: r.content.substring(0, 200) + '...' }}
                    className="mt-2 text-sm leading-relaxed text-slate-700"
                  />
                </div>
              </div>
              {(r.status === 'SUBMITTED' || r.status === 'RESUBMITTED') && (
                <div className="mt-4 flex gap-2 border-t border-border pt-4">
                  <button
                    onClick={() => handleApprove(r._id, 'approved')}
                    className="btn btn-success btn-sm"
                  >
                    <CheckIcon className="h-4 w-4" />
                    Approve
                  </button>
                  <button
                    onClick={() => handleApprove(r._id, 'rejected')}
                    className="btn btn-danger btn-sm"
                  >
                    <XMarkIcon className="h-4 w-4" />
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
