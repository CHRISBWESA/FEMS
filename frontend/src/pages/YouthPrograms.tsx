import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { CalendarIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import { PageLoader } from '../components/ui';

// Youth "programs" intentionally reuse the existing Activities/Attendance module rather than a
// separate entity - this page is just a department-filtered view over /activities that links
// into the existing ActivityDetail page (which already handles attendance recording).
export default function YouthPrograms() {
  const [departments, setDepartments] = useState<any[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/departments', { withCredentials: true })
      .then((res) => setDepartments(res.data))
      .catch(() => {});
    fetchActivities();
  }, []);

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/activities', { withCredentials: true });
      setActivities(res.data);
    } catch {
      setActivities([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = departmentId
    ? activities.filter((a: any) => a.department_id === departmentId)
    : activities.filter((a: any) => a.audience_type === 'department' && a.department_id);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Youth Programs</h1>
          <p className="page-desc">Activities scoped to youth &amp; children departments — reuses the Activities module.</p>
        </div>
      </div>

      <div className="card mb-6">
        <label className="label">Filter by department</label>
        <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">All department-scoped activities</option>
          {departments.map((d: any) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <PageLoader rows={2} />
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-surface-sunken text-ink-subtle">
            <CalendarIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No programs found</p>
          <p className="empty-desc">
            Create an activity under Activities with audience "department" and a youth department to see it here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a: any) => (
            <button
              key={a.id}
              onClick={() => navigate(`/activities/${a.id}`)}
              className="card card-hover flex w-full items-center justify-between text-left"
            >
              <div>
                <p className="text-sm font-semibold text-ink">{a.title}</p>
                <p className="text-xs text-ink-muted">{new Date(a.date).toLocaleDateString()}</p>
              </div>
              <ArrowRightIcon className="h-4 w-4 text-ink-subtle" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
