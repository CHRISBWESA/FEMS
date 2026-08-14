import { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, BuildingOfficeIcon, UsersIcon } from '@heroicons/react/24/outline';

export default function DepartmentDetail() {
  const { id } = useParams();
  const [dept, setDept] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (id) {
      axios.get(`/departments/${id}`, { withCredentials: true })
        .then(res => { setDept(res.data); setLoading(false); })
        .catch(err => console.error(err));
    }
  }, [id]);

  const viewMembers = async () => {
    try {
      const res = await axios.get(`/departments/${id}/members`, { withCredentials: true });
      alert(JSON.stringify(res.data, null, 2));
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to load members');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="spinner" />
      </div>
    );
  }
  if (!dept) {
    return (
      <div className="empty-state">
        <p className="empty-title">Department not found</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <button
        onClick={() => navigate('/departments')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Departments
      </button>

      <div className="card mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div className="flex items-center gap-4">
            <div className="stat-icon bg-emerald-50 text-emerald-600">
              <BuildingOfficeIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{dept.name}</h1>
              <p className="mt-1 text-sm text-slate-500">{dept.description || 'No description'}</p>
            </div>
          </div>
          <button onClick={viewMembers} className="btn btn-secondary">
            <UsersIcon className="h-4 w-4" />
            View Members
          </button>
        </div>

        <div className="pt-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Leadership</h2>
          {dept.leaders?.length ? (
            <ul className="divide-y divide-border">
              {dept.leaders.map((l: any) => (
                <li key={l.user_id} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium text-slate-900 capitalize">
                    {l.role_in_department?.replace('_', ' ') || 'Leader'}
                  </span>
                  <span className="font-mono text-xs text-slate-500">{l.user_id}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No leaders assigned yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
