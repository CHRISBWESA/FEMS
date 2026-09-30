import { useEffect, useState } from 'react';
import axios from 'axios';
import { Empty, Spinner, errMsg } from '../components/finance/common';

// Items borrowed by the member linked to the signed-in account. The server returns nothing else.
export default function MyLoans() {
  const [loans, setLoans] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/resources/my-loans', { withCredentials: true })
      .then((r) => setLoans(r.data))
      .catch((e) => { setError(e.response?.status === 404 ? 'No member profile is linked to your account.' : errMsg(e, 'Could not load your loans')); setLoans([]); });
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="page-header">
        <div><h1 className="page-title">Borrowed Items</h1><p className="page-desc">Equipment currently or previously checked out to you.</p></div>
      </div>
      {!loans ? <Spinner /> : error ? <Empty text={error} /> : loans.length === 0 ? <Empty text="You have not borrowed anything" /> : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead><tr><th>Item</th><th>Checked out</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium text-slate-900">{l.asset.name} <span className="font-mono text-xs text-slate-400">{l.asset.asset_tag}</span></td>
                  <td>{new Date(l.checked_out_at).toLocaleDateString()}</td>
                  <td>{l.due_date ? new Date(l.due_date).toLocaleDateString() : '—'}</td>
                  <td>{l.checked_in_at ? <span className="text-slate-500">Returned {new Date(l.checked_in_at).toLocaleDateString()}</span> : l.overdue ? <span className="font-medium text-rose-700">Overdue</span> : <span className="text-amber-700">With you</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
