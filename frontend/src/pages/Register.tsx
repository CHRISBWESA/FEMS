import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { BuildingOfficeIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

interface PlanOption { code: string; name: string; description: string | null; trialDays: number }

const EMPTY = {
  fellowshipName: '', location: '', description: '',
  contactFirstName: '', contactLastName: '', email: '', phone: '',
  requestedPlanCode: '', reason: '',
};

// Consumer mailbox providers. Used only to ADVICE: an address here still submits and is still approved, because
// plenty of fellowships genuinely have no domain yet and refusing would just push them to a worse arrangement.
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com',
  'proton.me', 'gmx.com', 'gmx.de', 'mail.com', 'zoho.com', 'yandex.com', 'tutanota.com', 'fastmail.com',
]);

const emailDomain = (email: string) => email.trim().toLowerCase().split('@')[1] ?? '';
const isPersonalEmail = (email: string) => PERSONAL_EMAIL_DOMAINS.has(emailDomain(email));

/**
 * Suggests the shape of a fellowship-owned address from its name, purely as guidance: "Grace Fellowship Church"
 * becomes "info@gracefellowship.org". The applicant may have an entirely different domain already, which is why
 * this is never enforced - the platform administrator can correct it at approval time.
 */
function suggestFellowshipEmail(fellowshipName: string): string {
  const words = fellowshipName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const noise = new Set(['the', 'of', 'and', 'church', 'fellowship', 'congregation', 'assembly', 'ministry', 'centre', 'center']);
  const meaningful = words.filter((w) => !noise.has(w));
  const stem = (meaningful.length ? meaningful : words).join('');
  return stem ? `info@${stem}.org` : '';
}

// Public, unauthenticated. Submitting a request creates nothing and grants nothing: it puts the details in
// front of a platform administrator, who approves or rejects it. The applicant is told only that it was
// received - never whether the address was already on file.
export default function Register() {
  const [form, setForm] = useState(EMPTY);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState('');

  useEffect(() => {
    axios.get('/registrations/plans').then((r) => setPlans(Array.isArray(r.data) ? r.data : [])).catch(() => setPlans([]));
  }, []);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const personalEmail = isPersonalEmail(form.email);
  const suggestedEmail = form.fellowshipName.trim() ? suggestFellowshipEmail(form.fellowshipName) : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload: Record<string, string> = { ...form };
      if (!payload.requestedPlanCode) delete payload.requestedPlanCode;
      if (!payload.location) delete payload.location;
      if (!payload.description) delete payload.description;
      if (!payload.phone) delete payload.phone;
      if (!payload.reason) delete payload.reason;
      const r = await axios.post('/registrations', payload);
      setDone(r.data?.message || 'Thank you. Your request has been received.');
      setForm(EMPTY);
    } catch (err: any) {
      const m = err.response?.data?.message;
      setError(Array.isArray(m) ? m.join(' ') : m || 'Could not send your request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const field = 'input w-full';

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-ink p-12 lg:flex">
        <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-primary/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-48 -right-32 h-[32rem] w-[32rem] rounded-full bg-accent-bright/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-control bg-white/10 text-xl font-bold text-white backdrop-blur">F</div>
          <div>
            <p className="text-base font-semibold tracking-tight text-white">Fellowship Manager</p>
            <p className="text-xs text-white/50">Church Administration System</p>
          </div>
        </div>
        <div className="relative max-w-md animate-fade-rise">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">Request access for your fellowship.</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Tell us about your fellowship and a platform administrator will review your request. Once approved you
            become its Secretary, with credentials for your own fellowship only.
          </p>
          <ul className="mt-8 space-y-2.5 text-sm leading-relaxed text-white/60">
            <li className="flex gap-2.5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent-bright" />
              Your fellowship's data stays separate from every other fellowship.
            </li>
            <li className="flex gap-2.5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent-bright" />
              Approval makes you the Secretary and creates an account for every role your fellowship needs.
            </li>
            <li className="flex gap-2.5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent-bright" />
              The Secretary then manages all of those accounts — roles, e-mail, passwords.
            </li>
            <li className="flex gap-2.5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent-bright" />
              Nothing is activated until an administrator approves it.
            </li>
          </ul>
        </div>
        <p className="relative text-xs text-white/40">Fellowship Management System © {new Date().getFullYear()}</p>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-lg font-bold text-white">F</div>
            <div>
              <p className="text-sm font-semibold text-ink">Fellowship Manager</p>
              <p className="text-xs text-ink-subtle">Church Administration System</p>
            </div>
          </div>

          {done ? (
            <div className="card">
              <CheckCircleIcon className="h-10 w-10 text-emerald-600" />
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">Request received</h2>
              <p className="mt-2 text-sm text-ink-muted">{done}</p>
              <p className="mt-4 text-sm text-ink-muted">
                Keep the e-mail address you used. If the request is approved, your administrator credentials are
                sent to it.
              </p>
              <div className="mt-6 flex gap-2">
                <Link to="/login" className="btn btn-primary">Go to sign in</Link>
                <button className="btn btn-secondary" onClick={() => setDone('')}>Submit another request</button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-semibold tracking-tight text-ink">Request access</h2>
              <p className="mt-1 text-sm text-ink-muted">
                No account yet? Fill this in and an administrator will review it. Fields marked * are required.
              </p>

              <form className="mt-8 space-y-4" onSubmit={submit}>
                {error && (
                  <div className="alert alert-danger" role="alert">{error}</div>
                )}

                <div>
                  <label htmlFor="fellowshipName" className="label">Fellowship name *</label>
                  <input id="fellowshipName" required className={field} placeholder="Grace Fellowship Church"
                    value={form.fellowshipName} onChange={set('fellowshipName')} />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="contactFirstName" className="label">Your first name *</label>
                    <input id="contactFirstName" required className={field} value={form.contactFirstName} onChange={set('contactFirstName')} />
                  </div>
                  <div>
                    <label htmlFor="contactLastName" className="label">Your last name *</label>
                    <input id="contactLastName" required className={field} value={form.contactLastName} onChange={set('contactLastName')} />
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className="label">Your e-mail address *</label>
                  <input id="email" type="email" required autoComplete="email" className={field}
                    placeholder="you@yourfellowship.org" value={form.email} onChange={set('email')} />
                  <p className="mt-1 text-xs text-ink-subtle">Administrator credentials are sent to this address.</p>

                  {/* Advice, not a block: a personal mailbox still works, it is just a poor long-term home for a
                      fellowship's official account. */}
                  {personalEmail && (
                    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-600/20">
                      <p className="font-medium">We recommend an address belonging to the fellowship.</p>
                      <p className="mt-1">
                        {emailDomain(form.email)} is a personal mailbox. If the fellowship has its own domain, use
                        that here so the account survives you changing provider or losing the mailbox.
                        {suggestedEmail && <> Something like <span className="font-mono">{suggestedEmail}</span> would fit.</>}
                      </p>
                      <p className="mt-1">You can still submit with this address — the administrator can correct it.</p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="phone" className="label">Phone</label>
                    <input id="phone" className={field} value={form.phone} onChange={set('phone')} />
                  </div>
                  <div>
                    <label htmlFor="location" className="label">Location</label>
                    <input id="location" className={field} placeholder="Nairobi" value={form.location} onChange={set('location')} />
                  </div>
                </div>

                {plans.length > 0 && (
                  <div>
                    <label htmlFor="requestedPlanCode" className="label">Plan you are interested in</label>
                    <select id="requestedPlanCode" className="select w-full" value={form.requestedPlanCode} onChange={set('requestedPlanCode')}>
                      <option value="">Not sure yet</option>
                      {plans.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}{p.trialDays > 0 ? ` — ${p.trialDays}-day free trial` : ''}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-ink-subtle">Optional. The final plan is set by the administrator.</p>
                  </div>
                )}

                <div>
                  <label htmlFor="description" className="label">About your fellowship</label>
                  <textarea id="description" rows={2} className="input w-full" placeholder="Size, departments, what you need it for"
                    value={form.description} onChange={set('description')} />
                </div>

                <div>
                  <label htmlFor="reason" className="label">Anything else we should know?</label>
                  <textarea id="reason" rows={2} className="input w-full" value={form.reason} onChange={set('reason')} />
                </div>

                <button type="submit" disabled={loading} className="btn btn-primary w-full py-2.5">
                  {loading ? <><span className="spinner border-white" /> Sending...</> : <><BuildingOfficeIcon className="h-5 w-5" /> Send request</>}
                </button>

                <p className="text-center text-sm text-ink-muted">
                  Already have access? <Link to="/login" className="font-medium text-primary hover:text-primary-dark">Sign in</Link>
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
