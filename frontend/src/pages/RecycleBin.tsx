import { useState, useEffect } from 'react';
import axios from 'axios';
import { TrashIcon, ArrowPathIcon, ArchiveBoxXMarkIcon } from '@heroicons/react/24/outline';

export default function RecycleBin() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/recycle-bin', { withCredentials: true })
      .then(res => setItems(res.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const restore = async (id: string) => {
    if (!window.confirm('Are you sure you want to restore this record?')) return;
    try {
      await axios.post(`/recycle-bin/${id}/restore`, {}, { withCredentials: true });
      setItems(items.filter((i: any) => i._id !== id));
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to restore');
    }
  };

  const deletePermanently = async (id: string) => {
    if (!window.confirm('This will permanently delete the record. Are you sure?')) return;
    try {
      await axios.delete(`/recycle-bin/${id}`, { withCredentials: true });
      setItems(items.filter((i: any) => i._id !== id));
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete');
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
    <div className="mx-auto max-w-5xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Recycle Bin</h1>
          <p className="page-desc">Deleted records are retained for 30 days.</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <ArchiveBoxXMarkIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">Recycle bin is empty</p>
          <p className="empty-desc">Deleted records will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item: any) => (
            <div key={item._id} className="card flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="stat-icon bg-amber-50 text-amber-600">
                  <TrashIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {item.original_collection}
                    <span className="ml-2 font-mono text-xs text-slate-400">{item.original_record_id}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Deleted: {item.deleted_at ? new Date(item.deleted_at).toLocaleString() : '—'}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => restore(item._id)} className="btn btn-secondary btn-sm">
                  <ArrowPathIcon className="h-4 w-4" />
                  Restore
                </button>
                <button onClick={() => deletePermanently(item._id)} className="btn btn-danger btn-sm">
                  Delete Permanently
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
