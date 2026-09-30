import { useEffect, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { Bars3Icon, XMarkIcon, MapPinIcon, EnvelopeIcon, PhoneIcon, ClockIcon } from '@heroicons/react/24/outline';
import type { FellowshipSite } from './api';

/**
 * A fellowship's public site chrome.
 *
 * The navigation is built from the pages the API returned and the fellowship has marked visible, grouped the same
 * way the catalogue groups them (main / more / connect). "More" collapses behind a single item on a phone, because
 * sixteen links in a header is not a navigation.
 *
 * Every link is rooted at `/f/<subdomain>`, not at `/`. The site works on a real subdomain in production, where
 * the apex serves the platform and each label serves its fellowship — but in development every host is
 * `localhost`, so the subdomain travels in the path instead. Both produce the same component tree.
 */
export default function FellowshipShell({ site, children }: { site: FellowshipSite; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { subdomain } = useParams();
  const base = `/f/${subdomain}`;

  const visible = site.pages.filter((p) => p.isVisible);
  const main = visible.filter((p) => ['home', 'about', 'departments', 'ministries', 'events', 'news'].includes(p.key));
  const more = visible.filter((p) => !main.some((m) => m.key === p.key));
  const connect = more.filter((p) => ['prayer', 'give', 'contact', 'get_involved'].includes(p.key));
  const overflow = more.filter((p) => !connect.includes(p));

  useEffect(() => {
    setOpen(false);
    setMoreOpen(false);
  }, [subdomain]);

  const { profile } = site;
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap text-sm font-medium transition-colors ${
      isActive ? 'text-primary' : 'text-slate-600 hover:text-slate-900'
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to={base} className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-base font-bold text-white">
              {site.fellowship.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight text-slate-900">
                {site.fellowship.name}
              </span>
              {profile?.tagline && (
                <span className="hidden truncate text-xs leading-tight text-slate-500 sm:block">{profile.tagline}</span>
              )}
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-5 lg:flex">
            {main.map((p) => (
              <NavLink key={p.key} to={base + p.path} end={p.path === '/'} className={linkClass}>
                {p.label}
              </NavLink>
            ))}

            {overflow.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  className="text-sm font-medium text-slate-600 hover:text-slate-900"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((o) => !o)}
                >
                  More
                </button>
                {moreOpen && (
                  <div className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl bg-white py-1 shadow-elevated ring-1 ring-border">
                    {overflow.map((p) => (
                      <Link
                        key={p.key}
                        to={base + p.path}
                        className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        {p.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {connect.map((p) => (
              <NavLink key={p.key} to={base + p.path} className={linkClass}>
                {p.label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            className="btn btn-ghost ml-auto px-2 lg:hidden"
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
          </button>
        </div>

        {open && (
          <nav className="border-t border-border bg-white lg:hidden">
            <div className="mx-auto max-w-6xl px-4 py-2">
              {visible.map((p) => (
                <Link
                  key={p.key}
                  to={base + p.path}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {p.label}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-20 border-t border-border bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">{site.fellowship.name}</p>
              {profile?.tagline && <p className="mt-2 text-sm text-slate-500">{profile.tagline}</p>}
              {!profile?.tagline && site.fellowship.location && (
                <p className="mt-2 text-sm text-slate-500">{site.fellowship.location}</p>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-900">Explore</p>
              <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                {visible.slice(0, 8).map((p) => (
                  <li key={p.key}>
                    <Link to={base + p.path} className="text-slate-600 hover:text-primary">{p.label}</Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="sm:col-span-2">
              <p className="text-sm font-semibold text-slate-900">Reach us</p>
              <ul className="mt-3 space-y-2.5 text-sm text-slate-600">
                {profile?.address && (
                  <li className="flex gap-2"><MapPinIcon className="h-4 w-4 shrink-0 text-slate-400" />{profile.address}</li>
                )}
                {profile?.phone && (
                  <li className="flex gap-2">
                    <PhoneIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <a href={`tel:${profile.phone.replace(/[^\d+]/g, '')}`} className="hover:text-primary">{profile.phone}</a>
                  </li>
                )}
                {profile?.email && (
                  <li className="flex gap-2">
                    <EnvelopeIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <a href={`mailto:${profile.email}`} className="break-all hover:text-primary">{profile.email}</a>
                  </li>
                )}
                {profile?.service_times && (
                  <li className="flex gap-2">
                    <ClockIcon className="h-4 w-4 shrink-0 text-slate-400" />{profile.service_times}
                  </li>
                )}
                {/* A fellowship that has published no contact details must not look broken, so the fallback points
                    at the pages that are always useful. */}
                {!profile?.address && !profile?.phone && !profile?.email && (
                  <li className="text-slate-500">
                    <Link to={base + '/contact'} className="hover:text-primary">Contact us</Link> to reach this fellowship.
                  </li>
                )}
              </ul>

              {(profile?.facebook_url || profile?.youtube_url || profile?.whatsapp_url) && (
                <div className="mt-5 flex gap-4 text-sm">
                  {profile.facebook_url && <SocialLink href={profile.facebook_url} label="Facebook" />}
                  {profile.youtube_url && <SocialLink href={profile.youtube_url} label="YouTube" />}
                  {profile.whatsapp_url && <SocialLink href={profile.whatsapp_url} label="WhatsApp" />}
                </div>
              )}
            </div>
          </div>

          <p className="mt-10 border-t border-border pt-6 text-xs text-slate-400">
            © {new Date().getFullYear()} {site.fellowship.name}.{' '}
            <Link to="/site" className="hover:text-slate-600">Powered by Fellowship Manager</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

function SocialLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-slate-600 hover:text-primary"
    >
      {label}
    </a>
  );
}
