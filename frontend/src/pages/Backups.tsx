import { useEffect, useState } from 'react';
import axios from 'axios';
import { ShieldCheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

// Renders a capability flag exactly as the API reports it, so the screen never claims more than the backend does.
const flag = (value: boolean, whenTrue: string, whenFalse: string) => (value ? whenTrue : whenFalse);

export default function Backups() {  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/backups/stats', { withCredentials: true })
      .then((res) => setStats(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Could not load backup status.'));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Database Backups</h1>
          <p className="page-desc">Backup execution is an external operator responsibility.</p>
        </div>
      </div>

      {error && <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">{error}</div>}

      <div className="card space-y-4">
        <div className="flex items-start gap-3">
          <div className="stat-icon bg-amber-50 text-amber-600"><ExclamationTriangleIcon className="h-5 w-5" /></div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Not managed by FEMS</h2>
            <p className="mt-1 text-sm text-slate-600">The in-application endpoints do not run pg_dump, copy files, or restore data. They never create a successful backup record without a real dump.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {/* Every value here is read from GET /backups/stats. The API is the single source of truth for these
              flags, so the screen cannot claim a capability the backend does not report. */}
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wider text-slate-400">Application backup</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{stats ? flag(stats.applicationBackup, 'Available', 'Not available') : '—'}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wider text-slate-400">Scheduled backup</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{stats ? flag(stats.scheduledBackup, 'Scheduled in-app', 'External / unverified') : '—'}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wider text-slate-400">Verified restore</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{stats ? flag(stats.verifiedRestore, 'Verified', 'Not recorded here') : '—'}</p>
          </div>
        </div>
        {stats?.externalProcedure && (
          <p className="text-sm text-slate-500">The authoritative procedure is <span className="font-mono">{stats.externalProcedure}</span>.</p>
        )}
      </div>

      <div className="card flex items-start gap-3">
        <div className="stat-icon bg-emerald-50 text-emerald-600"><ShieldCheckIcon className="h-5 w-5" /></div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Required operator procedure</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>Schedule pg_dump or enable the hosting platform backup service.</li>
            <li>Store encrypted dumps off-host and alert on backup age or failure.</li>
            <li>Restore into a new empty database and verify before switching traffic.</li>
          </ol>
          <p className="mt-3 text-sm text-slate-500">The exact commands and verification steps are in BACKUP_RESTORE_GUIDE.md.</p>
        </div>
      </div>

      {stats && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">Recorded metadata rows</h2>
          <p className="text-sm text-slate-600">
            {stats.total} row{stats.total === 1 ? '' : 's'}. These are metadata only and are not evidence of a dump or a restore.
          </p>
          {Array.isArray(stats.recent) && stats.recent.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Recorded</th><th>Type</th><th>Status</th><th className="text-right">Size</th></tr></thead>
                <tbody>
                  {stats.recent.map((b: any) => (
                    <tr key={b.id}>
                      <td className="whitespace-nowrap text-xs">{new Date(b.created_at ?? b.createdAt).toLocaleString()}</td>
                      <td className="text-xs">{b.backup_type ?? b.type ?? '—'}</td>
                      <td><span className={`status-badge ${b.status === 'success' ? 'status-active' : 'status-rejected'} capitalize`}>{b.status}</span></td>
                      <td className="text-right text-xs">{b.file_size ?? b.fileSize ?? 0} bytes</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
