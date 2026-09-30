import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { EnvelopeIcon, LockClosedIcon, EyeIcon, EyeSlashIcon, BuildingLibraryIcon } from '@heroicons/react/24/outline';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-slate-900 p-12 lg:flex">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-xl font-bold text-white backdrop-blur">
            F
          </div>
          <div>
            <p className="text-base font-semibold text-white">Fellowship Manager</p>
            <p className="text-xs text-slate-400">Church Administration System</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight text-white">
            Manage your fellowship's members, departments and finances in one place.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            A complete church administration toolkit — member records, department
            leadership, activities, reports, finance workflows and audit trails.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-white backdrop-blur">
              <BuildingLibraryIcon className="h-5 w-5" />
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-white backdrop-blur">
              <EnvelopeIcon className="h-5 w-5" />
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-white backdrop-blur">
              <LockClosedIcon className="h-5 w-5" />
            </div>
          </div>
        </div>

        <p className="relative text-xs text-slate-500">
          Fellowship Management System © {new Date().getFullYear()}
        </p>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center bg-background px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-lg font-bold text-white">
              F
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Fellowship Manager</p>
              <p className="text-xs text-slate-400">Church Administration System</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Welcome back — please enter your details.</p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="email" className="label">Email address</label>
              <div className="relative">
                <EnvelopeIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  className="input pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="label">Password</label>
              <div className="relative">
                <LockClosedIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="input pl-10 pr-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {/* Lets a person check what they typed. The value is only in the form field - nothing about it
                    is ever sent anywhere until they submit. */}
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                >
                  {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-2.5"
            >
              {loading ? (
                <>
                  <span className="spinner border-white" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <div className="mt-6 rounded-lg bg-slate-50 p-4 text-center ring-1 ring-inset ring-border">
            <p className="text-sm text-slate-600">No access for your fellowship yet?</p>
            <Link
              to="/register"
              className="mt-1 inline-block text-sm font-medium text-primary hover:text-primary-dark"
            >
              Request platform access
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
