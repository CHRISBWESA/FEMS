import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import type { SiteNavItem } from './site-copy';

/**
 * The frame every public page wears: a sticky header, the site's own navigation, and a footer.
 *
 * Deliberately separate from the authenticated `Layout`. The application shell assumes a signed-in user, a sidebar
 * and the app's colour weight; reusing it for a page a stranger has never logged in to would put "Members" and
 * "Sign out" on the front door of somebody's public site.
 *
 * The mobile menu is a plain state toggle rather than the headless dialog the app uses, because there is nothing
 * behind it to trap focus away from on a page with no other content.
 */
export default function PublicShell({
  nav,
  brand,
  brandTo,
  accentLabel,
  children,
}: {
  nav: SiteNavItem[];
  brand: string;
  brandTo: string;
  accentLabel?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Any navigation closes the menu. Without this it stays open over the page you just navigated to.
  useEffect(() => setOpen(false), [brandTo, nav.length]);

  const link = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium transition-colors ${isActive ? 'text-primary' : 'text-slate-600 hover:text-slate-900'}`;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Link to={brandTo} className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-base font-bold text-white">
              {brand.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight text-slate-900">{brand}</span>
              {accentLabel && (
                <span className="block truncate text-xs leading-tight text-slate-500">{accentLabel}</span>
              )}
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-6 lg:flex">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === brandTo || item.to.endsWith('/site')} className={link}>
                {item.label}
              </NavLink>
            ))}
            <span className="h-5 w-px bg-border" />
            <Link to="/login" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Sign In
            </Link>
            <Link to="/register" className="btn btn-primary btn-sm">
              Get Started
            </Link>
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
            <div className="mx-auto max-w-7xl space-y-1 px-4 py-3 sm:px-6">
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === brandTo || item.to.endsWith('/site')}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {item.label}
                </NavLink>
              ))}
              <div className="flex gap-2 pt-2">
                <Link to="/login" className="btn btn-secondary flex-1">Sign In</Link>
                <Link to="/register" className="btn btn-primary flex-1">Get Started</Link>
              </div>
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-20 border-t border-border bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">{brand}</p>
              <p className="mt-2 text-sm text-slate-500">
                Administration for fellowships, with each one kept to its own data.
              </p>
            </div>
            <FooterColumn title="Product" links={nav.slice(1, 4)} />
            <FooterColumn title="More" links={nav.slice(4)} />
            <div>
              <p className="text-sm font-semibold text-slate-900">Access</p>
              <ul className="mt-3 space-y-2 text-sm">
                <li><Link to="/login" className="text-slate-600 hover:text-primary">Sign In</Link></li>
                <li><Link to="/register" className="text-slate-600 hover:text-primary">Get Started</Link></li>
              </ul>
            </div>
          </div>
          <p className="mt-10 border-t border-border pt-6 text-xs text-slate-400">
            © {new Date().getFullYear()} {brand}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: SiteNavItem[] }) {
  if (links.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="text-slate-600 hover:text-primary">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
