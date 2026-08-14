import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { ShieldCheckIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

export default function ImpersonationApproval() {
  const { token } = useParams();
  const [status, setStatus] = useState<'pending' | 'done' | 'error'>('pending');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;

    const confirmed = window.confirm('Admin has requested to impersonate your account. Allow?');
    if (!confirmed) {
      setStatus('error');
      setError('Impersonation request declined.');
      return;
    }

    const approve = async () => {
      try {
        const res = await axios.post(`/auth/approve-impersonation/${token}`, {}, { withCredentials: true });
        if (res.data.accessToken) {
          localStorage.setItem('accessToken', res.data.accessToken);
          setStatus('done');
          setTimeout(() => {
            window.location.href = '/dashboard';
          }, 800);
        }
      } catch (err: any) {
        setStatus('error');
        setError(err.response?.data?.message || 'Approval failed');
      }
    };
    approve();
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card w-full max-w-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
          <ShieldCheckIcon className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Impersonation Approval</h2>

        {status === 'pending' && (
          <p className="mt-2 text-sm text-slate-500">Please check the confirmation dialog...</p>
        )}
        {status === 'done' && (
          <div className="mt-3">
            <p className="text-sm text-slate-600">Approved. Redirecting...</p>
            <CheckCircleIcon className="mx-auto mt-3 h-6 w-6 text-emerald-500" />
          </div>
        )}
        {status === 'error' && (
          <p className="mt-2 text-sm text-rose-600">{error}</p>
        )}
      </div>
    </div>
  );
}
