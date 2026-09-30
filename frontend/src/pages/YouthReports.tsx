import { useState, useEffect } from 'react';
import axios from 'axios';
import { ChartBarIcon, UsersIcon, FaceSmileIcon } from '@heroicons/react/24/outline';

export default function YouthReports() {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/youth/reports/summary', { withCredentials: true })
      .then((res) => setSummary(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load youth reports'))
      .finally(() => setLoading(false));
  }, []);

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
          <h1 className="page-title">Youth &amp; Children Reports</h1>
          <p className="page-desc">Aggregate participation and attendance overview.</p>
        </div>
      </div>

      {error ? (
        <div className="empty-state">
          <p className="empty-title">{error}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="card flex items-center gap-4">
              <div className="stat-icon bg-indigo-50 text-indigo-600">
                <UsersIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Total Participants</p>
                <p className="text-2xl font-semibold text-slate-900">{summary?.totalParticipants ?? 0}</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="stat-icon bg-emerald-50 text-emerald-600">
                <FaceSmileIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Active Participants</p>
                <p className="text-2xl font-semibold text-slate-900">{summary?.activeParticipants ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 card">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
              <ChartBarIcon className="h-4 w-4" /> By Age Group
            </h2>
            {!summary?.byAgeGroup?.length ? (
              <p className="py-4 text-sm text-slate-500">No participants yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {summary.byAgeGroup.map((row: any) => (
                  <li key={row.ageGroupId} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-700">{row.ageGroupName}</span>
                    <span className="font-medium text-slate-900">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 card">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">By Status</h2>
            {!summary?.byStatus?.length ? (
              <p className="py-4 text-sm text-slate-500">No participants yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {summary.byStatus.map((row: any) => (
                  <li key={row.status} className="flex items-center justify-between py-2 text-sm">
                    <span className="capitalize text-slate-700">{row.status}</span>
                    <span className="font-medium text-slate-900">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
