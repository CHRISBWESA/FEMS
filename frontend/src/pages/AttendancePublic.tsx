import { useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { CheckBadgeIcon, BuildingOfficeIcon } from '@heroicons/react/24/outline';
import { useOnline } from '../offline/hooks';

export default function AttendancePublic() {
  const { id } = useParams();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const online = useOnline();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await axios.post('/activities/attendance', {
        activityId: id,
        memberName: name,
      }, { withCredentials: true });
      setDone(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to record attendance');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="card w-full max-w-md p-8 text-center">
        {!done ? (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-light text-primary">
              <BuildingOfficeIcon className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Mark Your Attendance</h1>
            <p className="mt-1 mb-6 text-sm text-slate-500">Enter your full name to check in.</p>

            {!online && (
              <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
                You are offline. Connect to the internet to check in - anonymous check-ins cannot be saved for later.
              </div>
            )}
            {error && (
              <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}

            <form onSubmit={submit}>
              <input
                required
                className="input mb-4 min-h-11 w-full text-center"
                placeholder="Your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button type="submit" disabled={submitting || !online} className="btn btn-primary min-h-11 w-full">
                {submitting ? <span className="spinner border-white" /> : 'Check In'}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <CheckBadgeIcon className="h-7 w-7" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">You're checked in!</h1>
            <p className="mt-1 text-sm text-slate-500">Your attendance has been recorded. Thank you, {name}.</p>
          </>
        )}
      </div>
    </div>
  );
}
