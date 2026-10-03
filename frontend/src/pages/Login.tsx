import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { EnvelopeIcon, LockClosedIcon, EyeIcon, EyeSlashIcon, BuildingLibraryIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Input } from '../components/ui';

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

  const assurances = [
    { icon: BuildingLibraryIcon, text: 'Every fellowship is kept to its own data.' },
    { icon: ShieldCheckIcon, text: 'You only see what your role permits.' },
  ];

  return (
    <div className="flex min-h-dvh">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-ink p-12 lg:flex">
        <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-primary/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-48 -right-32 h-[32rem] w-[32rem] rounded-full bg-accent-bright/15 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-control bg-white/10 text-xl font-bold text-white backdrop-blur">
            F
          </div>
          <div>
            <p className="text-base font-semibold tracking-tight text-white">Fellowship Manager</p>
            <p className="text-xs text-white/50">Church Administration System</p>
          </div>
        </div>

        <div className="relative max-w-md animate-fade-rise">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Your fellowship&rsquo;s records, finances and people — in one system.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Member records, department leadership, activities, finance workflows, audit trails and a public site for
            your fellowship.
          </p>
          <ul className="mt-8 space-y-3.5">
            {assurances.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/70">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-bright" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/40">
          Fellowship Management System © {new Date().getFullYear()}
        </p>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center bg-canvas px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-control bg-primary text-lg font-bold text-white">
              F
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">Fellowship Manager</p>
              <p className="text-xs text-ink-subtle">Church Administration System</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h2>
          <p className="mt-1.5 text-sm text-ink-muted">Welcome back — enter the details for your account.</p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {error && <Alert tone="danger">{error}</Alert>}

            <div className="field-group">
              <label htmlFor="email" className="label">
                Email address
              </label>
              <div className="relative">
                <EnvelopeIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  className="pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="password" className="label">
                Password
              </label>
              <div className="relative">
                <LockClosedIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className="px-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <Button type="submit" variant="primary" size="lg" className="btn-block" loading={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-8 rounded-card border border-hairline bg-surface p-5 text-center">
            <p className="text-sm text-ink-muted">No access for your fellowship yet?</p>
            <Link to="/register" className="mt-1 inline-block text-sm font-medium text-primary hover:text-primary-dark">
              Request platform access
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
