import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { CalendarIcon, MapPinIcon, ClockIcon } from '@heroicons/react/24/outline';

export default function Activities() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/activities', { withCredentials: true })
      .then(res => setActivities(res.data))
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
          <h1 className="page-title">Activities</h1>
          <p className="page-desc">Upcoming and past fellowship activities.</p>
        </div>
      </div>

      {activities.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <CalendarIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No activities found</p>
          <p className="empty-desc">Activities will appear here once scheduled.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activities.map((a: any) => (
            <button
              key={a._id}
              onClick={() => navigate(`/activities/${a._id}`)}
              className="card card-hover block w-full text-left"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="stat-icon bg-indigo-50 text-indigo-600">
                    <CalendarIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{a.title}</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <ClockIcon className="h-4 w-4" />
                        {new Date(a.date).toLocaleString()}
                      </span>
                      {a.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPinIcon className="h-4 w-4" />
                          {a.location}
                        </span>
                      )}
                    </div>
                    {a.description && (
                      <p className="mt-2 text-sm text-slate-600">{a.description}</p>
                    )}
                  </div>
                </div>
                <span className="status-badge status-submitted">
                  {a.audience_type?.replace('_', ' ') || 'All'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
