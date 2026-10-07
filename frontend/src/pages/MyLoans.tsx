import { useEffect, useState } from 'react';
import axios from 'axios';
import { errMsg } from '../components/finance/common';
import { DataTable, type Column } from '../components/DataTable';
import { Alert, PageLoader } from '../components/ui';

export default function MyLoans() {
  const [loans, setLoans] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/resources/my-loans', { withCredentials: true })
      .then((r) => setLoans(r.data))
      .catch((e) => { setError(e.response?.status === 404 ? 'No member profile is linked to your account.' : errMsg(e, 'Could not load your loans')); setLoans([]); });
  }, []);

  if (error) return <div className="mx-auto max-w-3xl"><Alert tone="danger">{error}</Alert></div>;
  if (!loans) return <PageLoader />;

  const columns: Column<any>[] = [
    { key: 'item', header: 'Item', priority: 'primary', render: (l) => <span className="font-medium text-ink">{l.asset.name} <span className="font-mono text-xs text-ink-subtle">{l.asset.asset_tag}</span></span> },
    { key: 'checkedOut', header: 'Checked out', priority: 'secondary', render: (l) => new Date(l.checked_out_at).toLocaleDateString() },
    { key: 'due', header: 'Due', priority: 'meta', render: (l) => l.due_date ? new Date(l.due_date).toLocaleDateString() : '—' },
    { key: 'status', header: 'Status', render: (l) => l.checked_in_at ? <span className="text-ink-muted">Returned {new Date(l.checked_in_at).toLocaleDateString()}</span> : l.overdue ? <span className="font-medium text-rose-700">Overdue</span> : <span className="text-amber-700">With you</span> },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="page-header">
        <div><h1 className="page-title">Borrowed Items</h1><p className="page-desc">Equipment currently or previously checked out to you.</p></div>
      </div>
      <DataTable
        columns={columns}
        rows={loans}
        rowKey={(l) => l.id}
        caption="Borrowed items"
        empty={{ title: 'You have not borrowed anything' }}
      />
    </div>
  );
}
