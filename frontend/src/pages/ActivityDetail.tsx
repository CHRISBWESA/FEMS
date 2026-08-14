import { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, CalendarIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

export default function ActivityDetail() {
  const { id } = useParams();
  const [activity, setActivity] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [attendanceData, setAttendanceData] = useState({ name: '' });
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (id) {
      axios.get(`/activities/${id}`, { withCredentials: true })
        .then(res => setActivity(res.data))
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    }
  }, [id]);

  const confirmAttendance = async () => {
    setConfirming(true);
    try {
      await axios.post('/activities/attendance', {
        activityId: id,
        memberName: attendanceData.name,
      }, { withCredentials: true });
      alert('Attendance confirmed!');
      setAttendanceData({ name: '' });
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to record attendance');
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="spinner" />
      </div>
    );
  }
  if (!activity) {
    return (
      <div className="empty-state">
        <p className="empty-title">Activity not found</p>
      </div>
    );
  }

  const isAllMembers = activity.audience_type === 'all_members';

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back
      </button>

      <div className="card">
        <div className="flex items-start gap-4 border-b border-border pb-5">
          <div className="stat-icon bg-indigo-50 text-indigo-600">
            <CalendarIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{activity.title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {new Date(activity.date).toLocaleString()}
              {activity.end_date && ` — ${new Date(activity.end_date).toLocaleString()}`}
            </p>
            {activity.location && (
              <p className="mt-0.5 text-sm text-slate-500">📍 {activity.location}</p>
            )}
          </div>
        </div>

        {activity.description && (
          <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {activity.description}
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <span className="text-sm text-slate-500">Audience:</span>
          <span className="status-badge status-submitted">
            {activity.audience_type?.replace('_', ' ') || 'All'}
          </span>
        </div>

        {isAllMembers && (
          <div className="mt-6 rounded-xl bg-slate-50 p-5 ring-1 ring-inset ring-border">
            <h2 className="text-sm font-semibold text-slate-900">Confirm Attendance</h2>
            <p className="mt-1 text-sm text-slate-500">Confirm your presence at this activity.</p>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                placeholder="Enter your name"
                className="input"
                value={attendanceData.name}
                onChange={(e) => setAttendanceData({ name: e.target.value })}
              />
              <button
                onClick={confirmAttendance}
                disabled={!attendanceData.name.trim() || confirming}
                className="btn btn-primary"
              >
                {confirming ? <span className="spinner border-white" /> : <CheckCircleIcon className="h-5 w-5" />}
                Confirm
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
