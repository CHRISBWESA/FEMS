import { Link, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useFellowshipSite, type PublicPage } from './api';
import SeoTags from '../site/SeoTags';
import FellowshipShell from './FellowshipShell';
import FellowshipForm from './FellowshipForm';
import {
  FellowshipHome, FellowshipAbout, LeadershipPage, DepartmentsPage, MinistriesPage,
  EventsPage, NewsPage, PublicationsPage, GalleryPage, SermonsPage, TestimoniesPage,
  ProjectsPage, GetInvolvedPage, GivingPage,
} from './FellowshipPages';

/**
 * A fellowship's landing page: the sixteen pages, mounted at `/f/<subdomain>`.
 *
 * In production the subdomain is the host (`casfeta.example.com`) and this is the whole site. In development
 * every host is `localhost`, so it travels in the path instead. The component tree is identical either way, which
 * is why nothing below reads `window.location`.
 *
 * The routes are generated from the page copy the API returns rather than written out by hand, so the catalogue in
 * `public-site.constants.ts` is the only place a page has to be declared. A page the fellowship has hidden still
 * resolves — hiding removes it from the navigation, it does not 404 a link somebody already has.
 */
export default function FellowshipSite() {
  const { subdomain } = useParams();
  const { site, error } = useFellowshipSite(subdomain);

  if (error === 'not-found') {
    return <NotPublished />;
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="card max-w-md p-8 text-center">
          <h1 className="text-xl font-semibold text-slate-900">This site is not available</h1>
          <p className="mt-2 text-sm text-slate-600">
            The page could not be loaded. Please try again in a moment.
          </p>
        </div>
      </div>
    );
  }

  if (!site) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  const pageFor = (key: string): PublicPage | undefined => site.pages.find((p) => p.key === key);

  // The document title and the description a link preview shows, resolved from the route the visitor is on. A
  // page that has never been written falls back to its catalogue label, so a shareable link is never untitled.
  const { pathname } = useLocation();
  const active = activePage(site.pages, pathname);
  const profile = site.profile;

  return (
    <FellowshipShell site={site}>
      <SeoTags
        title={
          active && active.path !== '/'
            ? `${active.title} | ${site.fellowship.name}`
            : `${site.fellowship.name}${profile?.tagline ? ` — ${profile.tagline}` : ''}`
        }
        description={
          profile?.tagline ||
          active?.subtitle ||
          (profile?.story ? profile.story.replace(/\s+/g, ' ').slice(0, 160) : undefined) ||
          `The public site of ${site.fellowship.name}.`
        }
        url={`https://${site.fellowship.host}${active?.path ?? '/'}`}
        // No share image rather than the platform's own logo: a stranger's branding on a fellowship's link is worse
        // than no picture at all.
        image={null}
      />
      <Routes>
        <Route index element={<FellowshipHome site={site} />} />
        <Route path="about" element={<FellowshipAbout site={site} page={pageFor('about')} />} />
        <Route path="leadership" element={<LeadershipPage page={pageFor('leadership')} />} />
        <Route path="departments" element={<DepartmentsPage page={pageFor('departments')} />} />
        <Route path="ministries" element={<MinistriesPage page={pageFor('ministries')} />} />
        <Route path="events" element={<EventsPage page={pageFor('events')} />} />
        <Route path="publications" element={<PublicationsPage page={pageFor('publications')} />} />
        <Route path="news" element={<NewsPage page={pageFor('news')} />} />
        <Route path="gallery" element={<GalleryPage page={pageFor('gallery')} />} />
        <Route path="sermons" element={<SermonsPage page={pageFor('sermons')} />} />
        <Route path="testimonies" element={<TestimoniesPage page={pageFor('testimonies')} />} />
        <Route path="projects" element={<ProjectsPage page={pageFor('projects')} />} />
        <Route path="get-involved" element={<GetInvolvedPage page={pageFor('get_involved')} />} />
        <Route path="prayer-request" element={<FellowshipForm kind="prayer" page={pageFor('prayer')} site={site} />} />
        <Route
          path="give"
          element={
            <GivingPage
              page={pageFor('give')}
              extra={<FellowshipForm kind="give" page={pageFor('give')} site={site} embedded />}
            />
          }
        />
        <Route path="contact" element={<FellowshipForm kind="contact" page={pageFor('contact')} site={site} />} />
        <Route path="*" element={<FellowshipHome site={site} />} />
      </Routes>
    </FellowshipShell>
  );
}

/**
 * Shown when a subdomain does not resolve.
 *
 * The server answers "not found" identically for a subdomain that does not exist, one that is taken, and one whose
 * fellowship has not switched its site on. This page keeps that ambiguity rather than explaining it, because
 * "this fellowship has not published its site yet" would tell a stranger that a particular congregation exists and
 * is merely not ready.
 */
/**
 * Which catalogue page the current path is.
 *
 * Longest match wins, so `/get-involved` is not mistaken for a shorter page whose path is a prefix of it. A path
 * with no match is the home page, which is also what the router renders.
 */
function activePage(pages: PublicPage[], pathname: string): PublicPage | undefined {
  const tail = pathname.replace(/^\/f\/[^/]+/, '') || '/';
  return pages
    .filter((p) => p.isVisible)
    .sort((a, b) => b.path.length - a.path.length)
    .find((p) => p.path === tail);
}

function NotPublished() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          There is no published site at this address.
        </p>
        <Link to="/site" className="btn btn-primary mt-6">Go to Fellowship Manager</Link>
      </div>
    </div>
  );
}
