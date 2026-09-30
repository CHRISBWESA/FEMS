import { useState, useEffect } from 'react';
import axios from 'axios';
import { TrashIcon, ArchiveBoxXMarkIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../App';

export default function RecycleBin() {
  const { hasRole } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/recycle-bin', { withCredentials: true })
      .then((res) => setItems(res.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const deletePermanently = async (id: string) => {
    if (!window.confirm('This permanently deletes the recycle-bin record. Proceed?')) return;
    try {
      await axios.delete(`/recycle-bin/${id}`, { withCredentials: true });
      setItems(items.filter((item) => item.id !== id));
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete');
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><span className="spinner" /></div>;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Recycle Bin</h1>
          <p className="page-desc">Deleted records visible to your fellowship for the last 30 days.</p>
        </div>
      </div>

      <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20">
        Restoring is not available yet. Records are kept in the bin; there is no automatic 30-day purge.
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400"><ArchiveBoxXMarkIcon className="h-6 w-6" /></div>
          <p className="empty-title">Recycle bin is empty</p>
          <p className="empty-desc">Deleted records will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="card flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="stat-icon bg-amber-50 text-amber-600"><TrashIcon className="h-5 w-5" /></div>
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {item.original_collection}
                    <span className="ml-2 font-mono text-xs text-slate-400">{item.original_record_id}</span>
                  </p>
                  <p className="text-xs text-slate-400">Deleted: {item.deleted_at ? new Date(item.deleted_at).toLocaleString() : '—'}</p>
                </div>
              </div>
              {hasRole('secretary') && (
                <button onClick={() => deletePermanently(item.id)} className="btn btn-danger btn-sm">
                  Delete Permanently
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!hasRole('secretary') && (
        <div className="flex items-start gap-2 text-xs text-slate-500">
          <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
          Assistant secretaries can list records; only the Main Secretary can permanently delete one.
        </div>
      )}
    </div>
  );
}
