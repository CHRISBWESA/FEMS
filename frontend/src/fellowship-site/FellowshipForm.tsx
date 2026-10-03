import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircleIcon, EnvelopeIcon, MapPinIcon, PhoneIcon, ClockIcon, HeartIcon } from '@heroicons/react/24/outline';
import { submitEnquiry } from './api';
import { PageHeader, PageBody } from './FellowshipPages';
import type { FellowshipSite, PublicPage } from './api';

interface FormState {
  name: string;
  email: string;
  phone: string;
  message: string;
  amount: string;
  currency: string;
}

/**
 * The three pages a visitor can send something from.
 *
 * They share one form implementation because they share one endpoint shape and one set of rules. The differences
 * are declared, not branched through the markup: which endpoint it posts to, which fields are shown, and what it
 * says afterwards.
 *
 * Two constraints are visible in the markup. Name and message are always required — a message with neither is not
 * a message. E-mail and phone are always optional, because the whole point of a prayer request is that it can be
 * sent by somebody with nothing but a name.
 */
type FormKind = 'prayer' | 'give' | 'contact';

const KINDS: Record<FormKind, {
  endpoint: 'prayer-requests' | 'contact' | 'donations';
  intro: string;
  privacy: string;
  showAmount: boolean;
}> = {
  prayer: {
    endpoint: 'prayer-requests',
    intro:
      'Send a request to this fellowship. You do not need an account, and you only need to give a name — e-mail and phone are optional if you would like a reply.',
    privacy:
      'Your request is stored privately and is read by the fellowship. It is not published on the website and not shared with anybody else.',
    showAmount: false,
  },
  give: {
    endpoint: 'donations',
    intro:
      'Tell this fellowship you would like to give and they will contact you with the details. There is no online payment here, so nothing is charged and no card details are taken.',
    privacy:
      'What you send is stored so the fellowship can follow up. Nothing is charged through this page.',
    showAmount: true,
  },
  contact: {
    endpoint: 'contact',
    intro:
      'Ask this fellowship a question. Use it for service times, directions, or how to get involved.',
    privacy:
      'Your message is read by the fellowship and is not published or shared.',
    showAmount: false,
  },
};

const EMPTY: FormState = { name: '', email: '', phone: '', message: '', amount: '', currency: 'USD' };

export default function FellowshipForm({
  kind,
  page,
  site,
  embedded = false,
}: {
  kind: FormKind;
  page: PublicPage | undefined;
  site: FellowshipSite;
  /** Renders only the form, for a page that supplies its own heading — the giving page. */
  embedded?: boolean;
}) {
  const { subdomain } = useParams();
  const config = KINDS[kind];
  const [form, setForm] = useState<FormState>(EMPTY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const set =
    (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        message: form.message,
      };
      if (form.email) payload.email = form.email;
      if (form.phone) payload.phone = form.phone;
      if (config.showAmount && form.amount) {
        payload.amount = form.amount;
        payload.currency = form.currency;
      }
      const message = await submitEnquiry(subdomain as string, config.endpoint, payload);
      setDone(message);
      setForm(EMPTY);
    } catch (err: any) {
      setError(err?.message || 'Could not send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // The form itself, without any page frame. Split out so the giving page can place it under its own heading
  // instead of repeating one.
  const formPanel = (
    <div className="grid gap-10 lg:grid-cols-5">
      <div className="lg:col-span-3">
        {done ? (
          <div className="card p-8 text-center">
            <CheckCircleIcon className="mx-auto h-12 w-12 text-success" />
            <h2 className="mt-3 text-lg font-semibold text-ink">Thank you</h2>
            <p className="mt-2 text-sm text-ink-muted">{done}</p>
            <button type="button" className="btn btn-secondary mt-6" onClick={() => setDone('')}>
              Send another
            </button>
          </div>
        ) : (
          <>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">{config.intro}</p>

            {error && (
              <div className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}

            <form className="mt-6 space-y-4" onSubmit={submit}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="f-name" className="label">Your name *</label>
                      <input id="f-name" required maxLength={120} className="input w-full" value={form.name} onChange={set('name')} />
                    </div>
                    <div>
                      <label htmlFor="f-phone" className="label">Phone</label>
                      <input id="f-phone" maxLength={40} className="input w-full" value={form.phone} onChange={set('phone')} />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="f-email" className="label">E-mail</label>
                    <input id="f-email" type="email" maxLength={254} className="input w-full" value={form.email} onChange={set('email')} />
                    <p className="mt-1 text-xs text-ink-subtle">Optional, but it is how they reply.</p>
                  </div>

                  {config.showAmount && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="f-amount" className="label">Amount you would like to give</label>
                        <input id="f-amount" inputMode="decimal" className="input w-full" placeholder="e.g. 500" value={form.amount} onChange={set('amount')} />
                      </div>
                      <div>
                        <label htmlFor="f-currency" className="label">Currency</label>
                        <select id="f-currency" className="select w-full" value={form.currency} onChange={set('currency')}>
                          {['USD', 'KES', 'TZS', 'UGX', 'NGN', 'ZAR', 'GBP', 'EUR'].map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div>
                    <label htmlFor="f-message" className="label">
                      {kind === 'prayer' ? 'What would you like us to pray about?' : kind === 'give' ? 'Anything you would like to add?' : 'Your message *'}
                    </label>
                    <textarea id="f-message" required maxLength={4000} rows={5} className="input w-full" value={form.message} onChange={set('message')} />
                  </div>

                  <button type="submit" disabled={sending} className="btn btn-primary w-full py-2.5 sm:w-auto">
                    {sending ? <><span className="spinner border-white" /> Sending…</> : <><HeartIcon className="h-5 w-5" /> Send</>}
                  </button>

                  <p className="text-xs leading-relaxed text-ink-subtle">{config.privacy}</p>
                </form>
              </>
            )}
      </div>

        {!embedded && (
          <aside className="lg:col-span-2">
            <div className="card p-6">
              <h2 className="text-base font-semibold text-ink">{site.fellowship.name}</h2>
              <ul className="mt-4 space-y-3 text-sm text-ink-muted">
                {site.profile?.address && (
                  <li className="flex gap-2.5"><MapPinIcon className="h-4 w-4 shrink-0 text-ink-subtle" />{site.profile.address}</li>
                )}
                {site.profile?.phone && (
                  <li className="flex gap-2.5">
                    <PhoneIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
                    <a href={`tel:${site.profile.phone.replace(/[^\d+]/g, '')}`} className="hover:text-primary">{site.profile.phone}</a>
                  </li>
                )}
                {site.profile?.email && (
                  <li className="flex gap-2.5">
                    <EnvelopeIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
                    <a href={`mailto:${site.profile.email}`} className="break-all hover:text-primary">{site.profile.email}</a>
                  </li>
                )}
                {site.profile?.service_times && (
                  <li className="flex gap-2.5"><ClockIcon className="h-4 w-4 shrink-0 text-ink-subtle" />{site.profile.service_times}</li>
                )}
              </ul>
              {(!site.profile?.address && !site.profile?.phone && !site.profile?.email) && (
                <p className="mt-4 text-sm text-ink-muted">
                  This fellowship has not published contact details yet. The form is the fastest way to reach them.
                </p>
              )}
            </div>
          </aside>
        )}
    </div>
  );

  if (embedded) {
    return <div className="mt-10 border-t border-hairline pt-10">{formPanel}</div>;
  }

  return (
    <>
      <PageHeader page={page} />
      <PageBody>{formPanel}</PageBody>
    </>
  );
}
