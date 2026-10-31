import { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { PageLoader } from '../components/ui';

export default function ActivityDetail() {
  const { id } = useParams();
  const [activity, setActivity] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (id) {
      axios.get(`/activities/${id}`, { withCredentials: true })
        .then(res => setActivity(res.data))
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    }
  }, [id]);

  if (loading) {
    return (
      <PageLoader rows={2} />
    );
  }
  if (!activity) {
    return (
      <div className="empty-state">
        <p className="empty-title">Activity not found</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back
      </button>

      <div className="card">
        <div className="flex items-start gap-4 border-b border-hairline pb-5">
          <div className="stat-icon bg-primary-light text-primary">
            <CalendarIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{activity.title}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {new Date(activity.date).toLocaleString()}
              {activity.end_date && ` — ${new Date(activity.end_date).toLocaleString()}`}
            </p>
            {activity.location && (
              <p className="mt-0.5 text-sm text-ink-muted">📍 {activity.location}</p>
            )}
          </div>
        </div>

        {activity.description && (
          <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {activity.description}
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <span className="text-sm text-ink-muted">Audience:</span>
          <span className="status-badge status-submitted">
            {activity.audience_type?.replace('_', ' ') || 'All'}
          </span>
        </div>
      </div>
    </div>
  );
}
