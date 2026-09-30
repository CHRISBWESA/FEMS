import { useState } from 'react';
import { CheckCircleIcon, EnvelopeIcon, MapPinIcon, PhoneIcon } from '@heroicons/react/24/outline';
import { Section, SectionHeading } from './PlatformPages';

/**
 * Where a stranger is told to write.
 *
 * Configurable per deployment, because a published address is an operational fact and not something to hardcode in
 * a component. If it is unset the page says so rather than showing a blank box.
 */
const CONTACT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined)?.trim() ?? '';

/**
 * The platform's contact page.
 *
 * There is no backend route for platform contact messages, so this form does not post anywhere. It says so plainly
 * rather than collecting a message and quietly losing it: the two real routes to a person are the access request
 * form and the e-mail address on this page.
 */
export default function PlatformContact() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied in some browsers; the address is still on screen to copy by hand.
    }
  };

  return (
    <>
      <Section className="pb-0">
        <SectionHeading
          eyebrow="Contact"
          title="Get in touch"
          body="Two ways reach a person: ask for access, or write to us."
        />
      </Section>

      <Section>
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="card p-8">
            <h3 className="text-lg font-semibold text-slate-900">Ask for access</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              If you want a fellowship set up on the system, the request form is the way. It goes to a platform
              administrator, who reviews it and creates the accounts on approval.
            </p>
            <a href="/register" className="btn btn-primary mt-6">Open the request form</a>

            <h3 className="mt-10 text-lg font-semibold text-slate-900">Already have access?</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Sign in to reach your fellowship’s records, or reset your password if you have been locked out.
            </p>
            <a href="/login" className="btn btn-secondary mt-6">Sign in</a>
          </div>

          <div className="card p-8">
            <h3 className="text-lg font-semibold text-slate-900">Write to us</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              For a question that is not an access request, e-mail the address below.
            </p>

            {CONTACT_EMAIL ? (
              <div className="mt-6 rounded-lg bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <EnvelopeIcon className="h-5 w-5 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 break-all font-mono text-sm text-slate-800">{CONTACT_EMAIL}</span>
                </div>
                <button type="button" onClick={copy} className="btn btn-secondary btn-sm mt-3 w-full">
                  {copied ? 'Copied' : 'Copy address'}
                </button>
              </div>
            ) : (
              <div className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                No contact address has been configured for this deployment. Use the access request form instead.
              </div>
            )}

            <h3 className="mt-8 text-lg font-semibold text-slate-900">What to expect</h3>
            <ul className="mt-3 space-y-2.5 text-sm text-slate-600">
              {[
                'Access requests are read by a person, usually within a few working days.',
                'If your fellowship already exists, we will point you at the Secretary rather than creating a second one.',
                'We will ask which fellowship you belong to before discussing anybody’s records.',
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="card flex items-start gap-4 p-6">
            <MapPinIcon className="h-5 w-5 shrink-0 text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-900">Where this is run</p>
              <p className="mt-1 text-sm text-slate-600">
                Each fellowship’s own address is published on its own site, not here.
              </p>
            </div>
          </div>
          <div className="card flex items-start gap-4 p-6">
            <PhoneIcon className="h-5 w-5 shrink-0 text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-900">Telephone</p>
              <p className="mt-1 text-sm text-slate-600">
                Support is by e-mail. A published number would be a number nobody answers.
              </p>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
