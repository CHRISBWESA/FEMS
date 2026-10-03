import { useState, useEffect } from 'react';
import axios from 'axios';
import { ShieldCheckIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

export default function Audit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const pageSize = 50;

  useEffect(() => {
    setLoading(true);
    axios.get(`/audit?page=${page}&limit=${pageSize}`, { withCredentials: true })
      .then(res => {
        setLogs(res.data.data);
        setTotal(res.data.total);
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Trail</h1>
          <p className="page-desc">Complete history of actions performed in the system.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
        </div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-surface-sunken text-ink-subtle">
            <ShieldCheckIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No audit entries</p>
          <p className="empty-desc">System actions will be recorded here.</p>
        </div>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>IP</th>
                <th>Comment</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap text-xs text-ink-muted">
                    {log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}
                  </td>
                  <td className="text-xs">
                    {log.actor ? (
                      <>
                        <span className="block font-medium text-ink">{log.actor.name || log.actor.email}</span>
                        {log.actor.roles?.length > 0 && (
                          <span className="text-ink-subtle">{log.actor.roles.join(', ').replace(/_/g, ' ')}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-ink-subtle">System</span>
                    )}
                  </td>
                  <td>
                    <span className="rounded-md bg-surface-sunken px-2 py-0.5 font-mono text-xs text-ink">
                      {log.action}
                    </span>
                  </td>
                  <td className="text-ink-muted">{log.entity_type}</td>
                  <td className="font-mono text-xs text-ink-muted">{log.ip_address || '—'}</td>
                  <td className="max-w-xs truncate text-ink-muted">{log.comment || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-ink-muted">
            Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn btn-secondary btn-sm"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Prev
            </button>
            <span className="text-sm text-ink-muted">Page {page} of {totalPages || 1}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages}
              className="btn btn-secondary btn-sm"
            >
              Next
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
