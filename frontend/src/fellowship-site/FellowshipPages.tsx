import { useParams } from 'react-router-dom';
import {
  MapPinIcon, CalendarDaysIcon, DocumentTextIcon, SparklesIcon,
  HandRaisedIcon, BanknotesIcon, InformationCircleIcon, ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { useFellowshipList, type FellowshipSite, type PublicPage } from './api';
import { EmptyState, PageLoader } from '../components/ui';

/** Short, predictable date format. The fellowship's own locale is not known to us. */
const longDate = (value: string | Date | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';

function humanFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------- page frame

/** The heading block every page shows above its content, driven by the API's page copy. */
export function PageHeader({ page }: { page: PublicPage | undefined }) {
  return (
    <div className="border-b border-hairline bg-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {page?.title || 'This fellowship'}
        </h1>
        {page?.subtitle && <p className="mt-2 text-base text-ink-muted">{page.subtitle}</p>}
        {page?.body && (
          <p className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-ink-muted">{page.body}</p>
        )}
      </div>
    </div>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">{children}</div>;
}



// ---------------------------------------------------------------- home

export function FellowshipHome({ site }: { site: FellowshipSite }) {
  const { subdomain } = useParams();
  const { profile, pages } = site;
  const home = pages.find((p) => p.key === 'home');

  // The home page is a summary, so it pulls the two lists a visitor most wants: what is coming up, and the latest
  // news. Everything else on the site is a link away.
  const events = useFellowshipList<any[]>(subdomain, 'events');
  const news = useFellowshipList<any[]>(subdomain, 'news');

  const upcoming = (events.data ?? []).slice(0, 3);
  const latestNews = (news.data ?? []).slice(0, 3);

  return (
    <>
      <div className="relative overflow-hidden bg-ink">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-primary/25 blur-3xl" />
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="relative max-w-3xl">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
              {profile?.tagline || site.fellowship.name}
            </h1>
            {(home?.body || profile?.story) && (
              <p className="mt-5 whitespace-pre-line text-base leading-relaxed text-white/70">
                {home?.body || profile?.story}
              </p>
            )}
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={`/f/${subdomain}/contact`} className="btn btn-primary px-5">Visit us</a>
              <a href={`/f/${subdomain}/prayer-request`} className="btn btn-secondary px-5">Prayer request</a>
            </div>
          </div>
        </div>
      </div>

      <PageBody>
        <div className="grid gap-10 lg:grid-cols-2">
          <section>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
              <CalendarDaysIcon className="h-5 w-5 text-primary" /> What&rsquo;s coming up
            </h2>
            <div className="mt-4">
              {events.loading && <PageLoader rows={2} />}
              {!events.loading && upcoming.length === 0 && (
                <EmptyState title="Nothing scheduled yet" description="When activities are added to the calendar they appear here." />
              )}
              {upcoming.map((e) => (
                <div key={e.title + e.date} className="card mb-3 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">{longDate(e.date)}</p>
                  <h3 className="mt-1 text-base font-semibold text-ink">{e.title}</h3>
                  {e.description && <p className="mt-1.5 text-sm text-ink-muted">{e.description}</p>}
                  {e.group && <p className="mt-1.5 text-xs text-ink-subtle">{e.group}</p>}
                </div>
              ))}
            </div>
            {upcoming.length > 0 && (
              <a href={`/f/${subdomain}/events`} className="text-sm font-medium text-primary hover:text-primary-dark">
                All events
              </a>
            )}
          </section>

          <section>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
              <SparklesIcon className="h-5 w-5 text-primary" /> Latest news
            </h2>
            <div className="mt-4">
              {news.loading && <PageLoader rows={2} />}
              {!news.loading && latestNews.length === 0 && (
                <EmptyState title="No announcements yet" description="Announcements appear here once they have been approved." />
              )}
              {latestNews.map((n) => (
                <div key={n.id} className="card mb-3 p-5">
                  <h3 className="text-base font-semibold text-ink">{n.title}</h3>
                  <p className="mt-1.5 line-clamp-3 text-sm text-ink-muted">{n.content}</p>
                  <p className="mt-2 text-xs text-ink-subtle">{longDate(n.publishedAt)}</p>
                </div>
              ))}
            </div>
            {latestNews.length > 0 && (
              <a href={`/f/${subdomain}/news`} className="text-sm font-medium text-primary hover:text-primary-dark">
                All news
              </a>
            )}
          </section>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {site.pages
            .filter((p) => p.isVisible && p.key !== 'home')
            .slice(0, 8)
            .map((p) => (
              <a key={p.key} href={`/f/${subdomain}${p.path}`} className="card card-hover p-5">
                <p className="text-sm font-semibold text-ink">{p.label}</p>
                <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{p.subtitle || ''}</p>
              </a>
            ))}
        </div>
      </PageBody>
    </>
  );
}

// ---------------------------------------------------------------- about

export function FellowshipAbout({ site, page }: { site: FellowshipSite; page: PublicPage | undefined }) {
  const { profile } = site;
  return (
    <>
      <PageHeader page={page} />
      <PageBody>
        <div className="grid gap-10 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {profile?.story ? (
              <p className="whitespace-pre-line text-base leading-relaxed text-ink">{profile.story}</p>
            ) : (
              <EmptyState
                title="This fellowship has not written its story yet"
                description="The content manager for this site can add it from the landing page editor."
              />
            )}
          </div>
          <aside className="space-y-4">
            {profile?.mission && (
              <div className="card p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Our mission</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink">{profile.mission}</p>
              </div>
            )}
            {profile?.vision && (
              <div className="card p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Our vision</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink">{profile.vision}</p>
              </div>
            )}
            {profile?.service_times && (
              <div className="card p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Service times</h2>
                <p className="mt-2 whitespace-pre-line text-sm text-ink">{profile.service_times}</p>
              </div>
            )}
          </aside>
        </div>
      </PageBody>
    </>
  );
}

// ---------------------------------------------------------------- generic list pages

interface Leadership { name: string; offices: string[] }
interface Department { name: string; description: string | null; memberCount: number; leaderCount: number }
interface Ministry { name: string; description: string | null }
interface EventItem { title: string; description: string | null; date: string; endDate: string | null; group: string | null }
interface NewsItem { id: string; title: string; content: string; publishedAt: string }
interface Publication {
  id: string;
  title: string;
  contentType: string;
  sizeBytes: number;
  fileName: string;
  uploadedAt: string;
  /** Absolute path to the bytes. Real, because uploads are now written to disk. */
  downloadUrl: string;
}
interface GalleryImage { id: string; title: string; contentType: string; uploadedAt: string; imageUrl: string }
interface PublicPost { id: string; title: string; body: string | null; reference: string | null; attribution: string | null; mediaUrl: string | null; happensAt: string | null }
interface GalleryPhoto { id: string; title: string; mediaUrl: string; kind: string; happensAt: string | null }
interface Opportunity { title: string; description: string | null; location: string | null; nextShiftAt: string | null }
interface Campaign { name: string; description: string | null; target: number | null; raised: number; startsAt: string; endsAt: string | null }

export function LeadershipPage({ page }: { page: PublicPage | undefined }) {
  const { subdomain } = useParams();
  const { data, loading } = useFellowshipList<Leadership[]>(subdomain, 'leadership');
  return (
    <>
      <PageHeader page={page} />
      <PageBody>
        {loading && <PageLoader rows={2} />}
        {data && data.length === 0 && (
          <EmptyState title="No office holders published" description="This fellowship has not published its leadership yet." />
        )}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((person) => (
            <div key={person.name} className="card p-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary-light text-lg font-semibold text-primary">
                {person.name.charAt(0).toUpperCase()}
              </div>
              <p className="mt-3 text-base font-semibold text-ink">{person.name}</p>
              <p className="mt-1 text-sm text-primary">{person.offices.join(' · ')}</p>
            </div>
          ))}
        </div>
      </PageBody>
    </>
  );
}

export function DepartmentsPage({ page }: { page: PublicPage | undefined }) {
  const { subdomain } = useParams();
  const { data, loading } = useFellowshipList<Department[]>(subdomain, 'departments');
  return (
    <>
      <PageHeader page={page} />
      <PageBody>
        {loading && <PageLoader rows={2} />}
        {data && data.length === 0 && (
          <EmptyState title="No departments yet" description="The Secretary adds departments, and they appear here." />
        )}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((d) => (
            <div key={d.name} className="card p-6">
              <h2 className="text-base font-semibold text-ink">{d.name}</h2>
              {d.description && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{d.description}</p>}
              <p className="mt-3 text-xs text-ink-subtle">
                {d.memberCount} member{d.memberCount === 1 ? '' : 's'} · {d.leaderCount} leader{d.leaderCount === 1 ? '' : 's'}
              </p>
            </div>
          ))}
        </div>
      </PageBody>
    </>
  );
}

export function MinistriesPage({ page }: { page: PublicPage | undefined }) {
  const { subdomain } = useParams();
  const { data, loading } = useFellowshipList<Ministry[]>(subdomain, 'ministries');
  return (
    <>
      <PageHeader page={page} />
      <PageBody>
        {loading && <PageLoader rows={2} />}
        {data && data.length === 0 && (
          <EmptyState title="No ministries listed yet" description="Ministries and programmes added to this fellowship appear here." />
        )}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((m) => (
            <div key={m.name} className="card p-6">
              <h2 className="text-base font-semibold text-ink">{m.name}</h2>
              {m.description && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{m.description}</p>}
            </div>
          ))}
        </div>
      </PageBody>
    </>
  );
}

export function EventsPage({ page }: { page: PublicPage | undefined }) {
  const { subdomain } = useParams();
  const { data, loading } = useFellowshipList<EventItem[]>(subdomain, 'events');
  return (
    <>
      <PageHeader page={page} />
      <PageBody>
        {loading && <PageLoader rows={2} />}
        {data && data.length === 0 && (
          <EmptyState title="Nothing coming up" description="Activities added to this fellowship's calendar will appear here." />
        )}
        <div className="space-y-4">
          {(data ?? []).map((e) => (
            <div key={e.title + e.date} className="card flex flex-col gap-3 p-6 sm:flex-row sm:items-center">
              <div className="w-full shrink-0 sm:w-36">
                <p className="text-sm font-semibold text-primary">{longDate(e.date)}</p>
                <p className="text-xs text-ink-subtle">{new Date(e.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-ink">{e.title}</h2>
                {e.description && <p className="mt-1 text-sm text-ink-muted">{e.description}</p>}
                {e.group && <p className="mt-1 text-xs text-ink-subtle">{e.group}</p>}
              </div>
            </div>
          ))}
        </div>
      </PageBody>
    </>
  );
}

export function NewsPage({ page }: { page: PublicPage | undefined }) {
  const { subdomain } = useParams();
  const { data, loading } = useFellowshipList<NewsItem[]>(subdomain, 'news');
  return (
    <>
      <PageHeader page={page} />
      <PageBody>
        {loading && <PageLoader rows={2} />}
        {data && data.length === 0 && (
          <EmptyState title="No announcements yet" description="Announcements appear here once they have been approved for publication." />
        )}
        <div className="mx-auto max-w-3xl space-y-5">
          {(data ?? []).map((n) => (
            <article key={n.id} className="card p-6">
              <h2 className="text-lg font-semibold text-ink">{n.title}</h2>
              <p className="mt-1 text-xs text-ink-subtle">{longDate(n.publishedAt)}</p>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink">{n.content}</p>
            </article>
          ))}
        </div>
      </PageBody>
    </>
  );
}

/**
 * Publications, with real downloads.
 *
 * The bytes are written on upload and served by a route that only answers for an approved, website-flagged
 * document belonging to this fellowship, so a link here is a working link rather than a promise.
 */
export function PublicationsPage({ page }: { page: PublicPage | undefined }) {
  const { subdomain } = useParams();
  const { data, loading } = useFellowshipList<Publication[]>(subdomain, 'publications');
  return (
    <>
      <PageHeader page={page} />
      <PageBody>
        {loading && <PageLoader rows={2} />}
        {data && data.length === 0 && (
          <EmptyState title="No publications yet" description="Documents marked for the website appear here once approved." />
        )}
        <div className="space-y-3">
          {(data ?? []).map((d) => (
            <div key={d.id} className="card flex items-center gap-4 p-5">
              <DocumentTextIcon className="h-6 w-6 shrink-0 text-ink-subtle" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{d.title}</p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {d.contentType}
                  {humanFileSize(d.sizeBytes) && ` · ${humanFileSize(d.sizeBytes)}`}
                  {` · ${longDate(d.uploadedAt)}`}
                </p>
              </div>
              <a href={d.downloadUrl} download={d.fileName} className="btn btn-secondary btn-sm shrink-0">
                <ArrowDownTrayIcon className="h-4 w-4" /> Download
              </a>
            </div>
          ))}
        </div>
      </PageBody>
    </>
  );
}

/**
 * The gallery: uploaded photographs, rendered as images.
 *
 * Two sources. `gallery` is the fellowship's own approved image uploads, now served as real bytes by the public
 * document route. `gallery/photos` is published items carrying a `mediaUrl`, which is how a picture hosted
 * elsewhere gets shown. Both are shown as pictures, because both are real now.
 */
export function GalleryPage({ page }: { page: PublicPage | undefined }) {
  const { subdomain } = useParams();
  const library = useFellowshipList<GalleryImage[]>(subdomain, 'gallery');
  const photos = useFellowshipList<GalleryPhoto[]>(subdomain, 'gallery/photos');

  const uploaded = library.data ?? [];
  const linked = photos.data ?? [];
  // One grid: uploaded photographs first, then linked ones. Two sections would suggest they are different kinds of
  // thing when a visitor cannot tell and does not care.
  const all = [
    ...uploaded.map((g) => ({ id: `up-${g.id}`, src: g.imageUrl, title: g.title })),
    ...linked.map((p) => ({ id: `ln-${p.id}`, src: p.mediaUrl, title: p.title })),
  ];

  return (
    <>
      <PageHeader page={page} />
      <PageBody>
        {(library.loading || photos.loading) && <PageLoader rows={2} />}
        {!library.loading && !photos.loading && all.length === 0 && (
          <EmptyState title="No photographs yet" description="Photographs added by the fellowship's content manager appear here." />
        )}

        {all.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {all.map((img) => (
              <figure key={img.id} className="card overflow-hidden">
                <img
                  src={img.src}
                  alt={img.title}
                  loading="lazy"
                  className="h-40 w-full bg-surface-sunken object-cover"
                  // A dead image URL must not leave a broken-image icon on a public page.
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                />
                <figcaption className="truncate px-3 py-2 text-xs text-ink-muted">{img.title}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}

/** Sermons and testimonies share a shape, so they share a component. */
function PostsPage({ page, path, empty }: { page: PublicPage | undefined; path: string; empty: { title: string; body: string } }) {
  const { subdomain } = useParams();
  const { data, loading } = useFellowshipList<PublicPost[]>(subdomain, path);
  return (
    <>
      <PageHeader page={page} />
      <PageBody>
        {loading && <PageLoader rows={2} />}
        {data && data.length === 0 && <EmptyState title={empty.title} description={empty.body} />}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((p) => (
            <article key={p.id} className="card flex flex-col p-6">
              {p.happensAt && (
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">{longDate(p.happensAt)}</p>
              )}
              <h2 className="mt-1 text-base font-semibold text-ink">{p.title}</h2>
              {p.reference && <p className="mt-1 text-sm text-primary">{p.reference}</p>}
              {p.attribution && <p className="mt-1 text-sm text-ink-muted">— {p.attribution}</p>}
              {p.body && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-muted">{p.body}</p>}
            </article>
          ))}
        </div>
      </PageBody>
    </>
  );
}

export function SermonsPage({ page }: { page: PublicPage | undefined }) {
  return <PostsPage page={page} path="sermons" empty={{ title: 'No sermons published yet', body: 'Sermons and teachings appear here once the fellowship publishes them.' }} />;
}

export function TestimoniesPage({ page }: { page: PublicPage | undefined }) {
  return <PostsPage page={page} path="testimonies" empty={{ title: 'No testimonies yet', body: 'Testimonies shared with permission appear here.' }} />;
}

export function ProjectsPage({ page }: { page: PublicPage | undefined }) {
  const { subdomain } = useParams();
  const projects = useFellowshipList<PublicPost[]>(subdomain, 'projects');
  const opportunities = useFellowshipList<Opportunity[]>(subdomain, 'get-involved');

  const list = projects.data ?? [];
  return (
    <>
      <PageHeader page={page} />
      <PageBody>
        {projects.loading && <PageLoader rows={2} />}
        {projects.data && list.length === 0 && opportunities.data && opportunities.data.length === 0 && (
          <EmptyState title="No projects yet" description="Projects and activities the fellowship runs appear here." />
        )}

        {list.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => (
              <article key={p.id} className="card p-6">
                {p.happensAt && <p className="text-xs font-semibold uppercase tracking-wide text-primary">{longDate(p.happensAt)}</p>}
                <h2 className="mt-1 text-base font-semibold text-ink">{p.title}</h2>
                {p.body && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-muted">{p.body}</p>}
              </article>
            ))}
          </div>
        )}

        {(opportunities.data ?? []).length > 0 && (
          <div className="mt-10">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
              <HandRaisedIcon className="h-5 w-5 text-primary" /> Ways to serve
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {(opportunities.data ?? []).map((o) => (
                <div key={o.title} className="card p-5">
                  <h3 className="text-sm font-semibold text-ink">{o.title}</h3>
                  {o.description && <p className="mt-1.5 text-sm text-ink-muted">{o.description}</p>}
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-subtle">
                    {o.location && <><MapPinIcon className="h-3.5 w-3.5" />{o.location}</>}
                    {o.nextShiftAt && <>· next {longDate(o.nextShiftAt)}</>}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}

export function GetInvolvedPage({ page }: { page: PublicPage | undefined }) {
  const { subdomain } = useParams();
  const { data, loading } = useFellowshipList<Opportunity[]>(subdomain, 'get-involved');
  return (
    <>
      <PageHeader page={page} />
      <PageBody>
        {loading && <PageLoader rows={2} />}
        {data && data.length === 0 && (
          <EmptyState
            title="No open opportunities right now"
            description="When the fellowship opens a service opportunity it will be listed here."
          />
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          {(data ?? []).map((o) => (
            <div key={o.title} className="card p-6">
              <h2 className="text-base font-semibold text-ink">{o.title}</h2>
              {o.description && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{o.description}</p>}
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-subtle">
                {o.location && <span className="flex items-center gap-1"><MapPinIcon className="h-3.5 w-3.5" />{o.location}</span>}
                {o.nextShiftAt && <span className="flex items-center gap-1"><CalendarDaysIcon className="h-3.5 w-3.5" />Next: {longDate(o.nextShiftAt)}</span>}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-xl bg-canvas p-5 text-sm text-ink-muted">
          To join one of these, <a href={`/f/${subdomain}/contact`} className="font-medium text-primary hover:text-primary-dark">contact the fellowship</a> and say which one you are interested in.
        </div>
      </PageBody>
    </>
  );
}

/**
 * The giving page: the campaigns with real recorded progress, then the form.
 *
 * `extra` is where the donation form is mounted. It lives here rather than in the route so the "there is no online
 * payment" note sits directly above the button that claims otherwise — separating them is how a page ends up
 * implying a checkout that does not exist.
 */
export function GivingPage({ page, extra }: { page: PublicPage | undefined; extra?: React.ReactNode }) {
  const { subdomain } = useParams();
  const { data, loading } = useFellowshipList<Campaign[]>(subdomain, 'giving');
  return (
    <>
      <PageHeader page={page} />
      <PageBody>
        {loading && <PageLoader rows={2} />}
        {data && data.length === 0 && (
          <EmptyState title="No open campaigns" description="Active giving campaigns appear here with the progress recorded against them." />
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          {(data ?? []).map((c) => {
            // Progress is only a bar when there is a target. A campaign with no target still reports its total.
            // `target` is narrowed to a number here so the bar and the label cannot disagree about it.
            const target = c.target !== null && c.target > 0 ? c.target : null;
            const pct = target === null ? null : Math.min(100, Math.round((c.raised / target) * 100));
            return (
              <div key={c.name} className="card p-6">
                <h2 className="text-base font-semibold text-ink">{c.name}</h2>
                {c.description && <p className="mt-2 text-sm text-ink-muted">{c.description}</p>}
                {pct !== null && target !== null && (
                  <div className="mt-4">
                    <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-2 text-xs text-ink-muted">
                      {c.raised.toLocaleString()} raised of {target.toLocaleString()} ({pct}%)
                    </p>
                  </div>
                )}
                {pct === null && (
                  <p className="mt-4 text-xs text-ink-muted">{c.raised.toLocaleString()} recorded so far</p>
                )}
                {c.endsAt && <p className="mt-1 text-xs text-ink-subtle">Closes {longDate(c.endsAt)}</p>}
              </div>
            );
          })}
        </div>
        <div className="mt-8 flex items-start gap-3 rounded-xl bg-canvas p-5 text-sm text-ink-muted">
          <BanknotesIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-subtle" />
          <p>
            There is no online payment on this site. To give, use the form below and the fellowship will contact
            you with the details — nothing is charged here.
          </p>
        </div>

        {extra}
      </PageBody>
    </>
  );
}
