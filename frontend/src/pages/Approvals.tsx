import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { CheckCircleIcon, XCircleIcon, ClipboardDocumentCheckIcon } from '@heroicons/react/24/outline';

const WORKFLOW_LABELS: Record<string, string> = {
  department_transfer: 'Department Transfer',
  department_removal: 'Department Removal',
  contribution_edit: 'Contribution Change',
  expense: 'Expense Approval',
  budget: 'Budget Approval',
  money_request: 'Money Request',
  report: 'Report Review',
  it_content: 'Content Publication',
  it_content_delete: 'Content Deletion',
  role_unassign: 'Role Removal',
};

const STATUS_CLASS: Record<string, string> = {
  SUBMITTED: 'status-draft',
  RESUBMITTED: 'status-draft',
  APPROVED: 'status-active',
  REJECTED: 'status-inactive',
  FINAL_APPROVED: 'status-graduated',
  CANCELLED: 'status-inactive',
};

export default function Approvals() {
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [commentId, setCommentId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/approvals', { withCredentials: true });
      setApprovals(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
  }, []);

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setError('');
    setDeciding(id);
    try {
      await axios.post(`/approvals/${id}/decide`, { decision, comment }, { withCredentials: true });
      setComment('');
      setCommentId(null);
      fetchApprovals();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to record decision');
    } finally {
      setDeciding(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Approvals</h1>
          <p className="page-desc">Workflows waiting for your decision.</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
        </div>
      ) : approvals.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <ClipboardDocumentCheckIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">Nothing pending</p>
          <p className="empty-desc">No workflows are waiting for your approval.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((a) => {
            const currentStep = a.steps?.find((s: any) => s.stage_order === a.current_stage);
            return (
              <div key={a.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">
                        {WORKFLOW_LABELS[a.workflow_type] || a.workflow_type}
                      </h3>
                      <span className={`status-badge ${STATUS_CLASS[a.status] || 'status-draft'}`}>
                        {(a.status || '').toLowerCase().replace('_', ' ')}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      Stage {a.current_stage + 1} of {a.steps?.length}
                      {currentStep && <> · awaiting <span className="capitalize font-medium text-slate-700">{currentStep.approver_role.replace(/_/g, ' ')}</span></>}
                      {' · '}entity <span className="font-mono text-xs">{a.entity_id}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {commentId === a.id ? (
                      <input
                        autoFocus
                        className="input w-56"
                        placeholder="Add a comment…"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                      />
                    ) : (
                      <button onClick={() => { setComment(''); setCommentId(a.id); }} className="btn btn-secondary btn-sm">
                        Comment
                      </button>
                    )}
                    <button
                      disabled={deciding === a.id}
                      onClick={() => decide(a.id, 'approved')}
                      className="btn btn-primary btn-sm"
                    >
                      <CheckCircleIcon className="h-4 w-4" />
                      Approve
                    </button>
                    <button
                      disabled={deciding === a.id}
                      onClick={() => decide(a.id, 'rejected')}
                      className="btn btn-secondary btn-sm text-rose-600"
                    >
                      <XCircleIcon className="h-4 w-4" />
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
