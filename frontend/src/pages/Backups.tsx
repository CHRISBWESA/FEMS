import { useState, useEffect } from 'react';
import axios from 'axios';
import { ServerIcon, PlusIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

export default function Backups() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/backups', { withCredentials: true })
      .then(res => setBackups(res.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const createBackup = async () => {
    try {
      await axios.post('/backups', {}, { withCredentials: true });
      window.location.reload();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed');
    }
  };

  const restoreBackup = async (id: string) => {
    if (!window.confirm('Restoring will replace current data. A safety backup will be created first. Proceed?')) return;
    try {
      await axios.post(`/backups/${id}/restore`, { confirmSafetyBackup: true, reason: 'Admin restore' }, { withCredentials: true });
      alert('Restore started. A safety backup has been created.');
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
    <div className="mx-auto max-w-5xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Backups</h1>
          <p className="page-desc">Backups run automatically every 12 hours.</p>
        </div>
        <button onClick={createBackup} className="btn btn-primary">
          <PlusIcon className="h-4 w-4" />
          Create Backup
        </button>
      </div>

      {backups.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <ServerIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No backups yet</p>
          <p className="empty-desc">Create your first backup to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {backups.map((b: any) => (
            <div key={b._id} className="card flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="stat-icon bg-emerald-50 text-emerald-600">
                  <ServerIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Backup
                    <span className="ml-2 font-mono text-xs text-slate-400">{b._id}</span>
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                    <span>Created: {b.created_at ? new Date(b.created_at).toLocaleString() : '—'}</span>
                    <span>•</span>
                    <span>Size: {b.file_size ? (b.file_size / 1024).toFixed(1) : '0'} KB</span>
                    <span>•</span>
                    <span className={`status-badge ${b.status === 'completed' ? 'status-approved' : 'status-submitted'}`}>
                      {b.status}
                    </span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => restoreBackup(b._id)}
                className="btn btn-secondary btn-sm"
              >
                <ArrowPathIcon className="h-4 w-4" />
                Restore
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 rounded-xl bg-primary-light p-4 text-sm text-slate-600">
        Restore permissions: Admin, Secretary, Assistant Secretary. Retention: indefinite.
      </div>
    </div>
  );
}
