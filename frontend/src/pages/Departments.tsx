import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { BuildingOfficeIcon, UserGroupIcon, ArrowRightIcon } from '@heroicons/react/24/outline';

export default function Departments() {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/departments', { withCredentials: true })
      .then(res => setDepartments(res.data))
      .catch(err => console.error(err))
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
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Departments</h1>
          <p className="page-desc">Departments and their leadership.</p>
        </div>
      </div>

      {departments.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <BuildingOfficeIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No departments found</p>
          <p className="empty-desc">Departments will appear here once created.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {departments.map((dept: any) => (
            <button
              key={dept._id}
              onClick={() => navigate(`/departments/${dept._id}`)}
              className="card card-hover group text-left"
            >
              <div className="flex items-start justify-between">
                <div className="stat-icon bg-emerald-50 text-emerald-600">
                  <BuildingOfficeIcon className="h-6 w-6" />
                </div>
                <ArrowRightIcon className="h-4 w-4 text-slate-300 transition-colors group-hover:text-primary" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{dept.name}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                {dept.description || 'No description'}
              </p>
              <div className="mt-4 flex items-center gap-1.5 text-sm text-slate-500">
                <UserGroupIcon className="h-4 w-4 text-slate-400" />
                {dept.leaders?.length ?? 0} leader(s)
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
