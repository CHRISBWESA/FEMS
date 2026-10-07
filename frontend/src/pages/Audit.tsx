import { useState, useEffect } from 'react';
import axios from 'axios';
import { DataTable, type Column } from '../components/DataTable';

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

  const columns: Column<any>[] = [
    { key: 'time', header: 'Time', priority: 'primary', render: (log) => <span className="whitespace-nowrap text-xs text-ink-muted">{log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}</span> },
    { key: 'user', header: 'User', priority: 'secondary', render: (log) => log.actor ? (<><span className="block font-medium text-ink">{log.actor.name || log.actor.email}</span>{log.actor.roles?.length > 0 && (<span className="text-ink-subtle">{log.actor.roles.join(', ').replace(/_/g, ' ')}</span>)}</>) : <span className="text-ink-subtle">System</span> },
    { key: 'action', header: 'Action', render: (log) => <span className="rounded-md bg-surface-sunken px-2 py-0.5 font-mono text-xs text-ink">{log.action}</span> },
    { key: 'entity', header: 'Entity', render: (log) => <span className="text-ink-muted">{log.entity_type}</span> },
    { key: 'ip', header: 'IP', render: (log) => <span className="font-mono text-xs text-ink-muted">{log.ip_address || '—'}</span> },
    { key: 'comment', header: 'Comment', render: (log) => <span className="max-w-xs truncate text-ink-muted">{log.comment || '—'}</span> },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Trail</h1>
          <p className="page-desc">Complete history of actions performed in the system.</p>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={logs}
        rowKey={(log: any) => log.id}
        loading={loading}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        caption="Audit trail"
        empty={{ title: 'No audit entries', description: 'System actions will be recorded here.' }}
        mobile="scroll"
      />
    </div>
  );
}
