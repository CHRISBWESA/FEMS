import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { ConfirmDialog } from '../components/ui';
import {
  GlobeAltIcon, CheckCircleIcon, PlusIcon, TrashIcon,
  EyeIcon, EyeSlashIcon, InboxIcon, PencilSquareIcon, XMarkIcon, CheckIcon,
} from '@heroicons/react/24/outline';

/**
 * The content manager's screen for a fellowship's public site.
 *
 * This is the whole of the `it_admin` role's surface: write the landing page, publish or unpublish it, and read
 * what visitors have sent. It holds no other permission, so there is nothing to guard here beyond the API's own
 * tenancy checks — a fellowship can only ever load and change its own content.
 *
 * The screen is one page with four tabs rather than sixteen screens, because a landing page is edited by comparing
 * it against the live site, and side-by-side is the only way to do that. The sixteen pages are the tab list.
 */

interface PageRow {
  key: string;
  path: string;
  label: string;
  nav: string;
  blurb: string;
  title: string;
  subtitle: string;
  body: string;
  isVisible: boolean;
  suggestedTitle: string;
  updatedAt: string | null;
}

interface Post {
  id: string;
  kind: 'sermon' | 'testimony' | 'project';
  title: string;
  body: string | null;
  reference: string | null;
  attribution: string | null;
  media_url: string | null;
  happens_at: string | null;
  is_published: boolean;
  sort_order: number;
}

interface Enquiry {
  id: string;
  kind: 'prayer_request' | 'contact_message' | 'donation_pledge';
  name: string;
  email: string | null;
  phone: string | null;
  message: string;
  amount: string | null;
  currency: string | null;
  is_handled: boolean;
  created_at: string;
}

interface Overview {
  fellowship: {
    id: string; name: string; subdomain: string | null; location: string | null;
    public_site_enabled: boolean; status: string; host: string | null; publishable: boolean;
  };
  profile: Record<string, any> | null;
  pages: PageRow[];
  posts: Post[];
  enquiries: { total: number; outstanding: number; byKind: { kind: string; isHandled: boolean; count: number }[] };
}

const EMPTY_PROFILE = {
  tagline: '', story: '', mission: '', vision: '', email: '', phone: '',
  address: '', service_times: '', facebook_url: '', youtube_url: '', whatsapp_url: '',
};

const KIND_LABEL: Record<string, string> = {
  sermon: 'Sermons & Teachings',
  testimony: 'Testimonials',
  project: 'Projects & Activities',
};

const ENQUIRY_LABEL: Record<string, string> = {
  prayer_request: 'Prayer requests',
  contact_message: 'Messages',
  donation_pledge: 'Giving',
};

type Tab = 'profile' | 'pages' | 'posts' | 'messages';

export default function PublicSiteAdmin() {
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await axios.get('/it-content/site');
      setData(r.data);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not load your site.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(''), 4000);
  };

  if (error) {
    return (
      <div className="card p-8">
        <h1 className="text-lg font-semibold text-ink">My Website</h1>
        <p className="mt-2 text-sm text-ink-muted">{error}</p>
      </div>
    );
  }

  if (!data) return <p className="text-sm text-ink-muted">Loading…</p>;

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'profile', label: 'Identity & contact' },
    { key: 'pages', label: 'Landing page' },
    { key: 'posts', label: 'Content', badge: data.posts.length },
    { key: 'messages', label: 'Messages', badge: data.enquiries.outstanding || undefined },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">My Website</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Your fellowship&rsquo;s public site. Nothing here is visible to the public until you publish it.
          </p>
        </div>
        <PublishControl fellowship={data.fellowship} onChange={load} flash={flash} />
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
          <CheckCircleIcon className="h-5 w-5" /> {notice}
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-hairline">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-muted hover:border-hairline hover:text-ink'
            }`}
          >
            {t.label}
            {t.badge ? <span className="ml-1.5 rounded-full bg-primary-light px-1.5 py-0.5 text-xs text-primary">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'profile' && <ProfileTab data={data} onSaved={load} flash={flash} />}
      {tab === 'pages' && <PagesTab data={data} onSaved={load} flash={flash} />}
      {tab === 'posts' && <PostsTab data={data} onSaved={load} flash={flash} />}
      {tab === 'messages' && <MessagesTab data={data} onSaved={load} flash={flash} />}
    </div>
  );
}

// ---------------------------------------------------------------- publish switch

/**
 * The one control that decides whether anything here is reachable on the internet.
 *
 * It states the address the site will be served from, because "published" is meaningless to a content manager who
 * does not know where. When the subdomain is missing it offers to mint one rather than leaving them stuck.
 */
function PublishControl({
  fellowship,
  onChange,
  flash,
}: {
  fellowship: Overview['fellowship'];
  onChange: () => void;
  flash: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showSubdomain, setShowSubdomain] = useState(false);
  const [label, setLabel] = useState('');

  const toggle = async () => {
    setBusy(true);
    try {
      await axios.post('/it-content/site/publish', { enabled: !fellowship.public_site_enabled });
      flash(fellowship.public_site_enabled ? 'Your site is offline.' : 'Your site is published.');
      onChange();
    } catch (e: any) {
      flash(e.response?.data?.message || 'Could not change that.');
    } finally {
      setBusy(false);
    }
  };

  const claim = async () => {
    setBusy(true);
    try {
      const r = await axios.post('/it-content/site/subdomain', label ? { subdomain: label } : {});
      flash(`Your site will be at ${r.data.host}`);
      onChange();
    } catch (e: any) {
      flash(e.response?.data?.message || 'Could not set that address.');
    } finally {
      setBusy(false);
    }
  };

  if (!fellowship.subdomain) {
    return (
      <div className="card w-full max-w-md p-5">
        <p className="text-sm font-semibold text-ink">Your site has no address yet</p>
        <p className="mt-1 text-sm text-ink-muted">
          Choose the web address your fellowship will be published at. We can suggest one from its name.
        </p>
        {showSubdomain ? (
          <div className="mt-4 space-y-2">
            <input
              className="input w-full"
              placeholder="leave blank for a suggestion"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <div className="flex gap-2">
              <button className="btn btn-primary" disabled={busy} onClick={claim}>Set address</button>
              <button className="btn btn-ghost" onClick={() => setShowSubdomain(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-primary mt-4" onClick={() => setShowSubdomain(true)}>Set my address</button>
        )}
      </div>
    );
  }

  return (
    <div className="card w-full max-w-md p-5">
      <div className="flex items-center gap-2">
        <GlobeAltIcon className="h-5 w-5 text-ink-subtle" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{fellowship.host}</p>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={busy || (fellowship.status !== 'active')}
          onClick={toggle}
          className={fellowship.public_site_enabled ? 'btn btn-secondary' : 'btn btn-primary'}
        >
          {fellowship.public_site_enabled ? (
            <><EyeSlashIcon className="h-4 w-4" /> Take offline</>
          ) : (
            <><EyeIcon className="h-4 w-4" /> Publish site</>
          )}
        </button>
        <span className="text-xs text-ink-muted">
          {fellowship.status !== 'active'
            ? 'Suspended fellowship'
            : fellowship.public_site_enabled
              ? 'Live on the internet'
              : 'Not published'}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- profile

function ProfileTab({ data, onSaved, flash }: { data: Overview; onSaved: () => void; flash: (m: string) => void }) {
  const [form, setForm] = useState({ ...EMPTY_PROFILE, ...(data.profile ?? {}) });
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof EMPTY_PROFILE) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    try {
      await axios.put('/it-content/site/profile', form);
      flash('Saved.');
      onSaved();
    } catch (e: any) {
      flash(e.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-6">
      <h2 className="text-base font-semibold text-ink">Identity and contact</h2>
      <p className="mt-1 text-sm text-ink-muted">
        The name and story on your landing page, and the ways a visitor can reach you.
      </p>

      <div className="mt-6 space-y-4">
        <Field label="Tagline" hint="One line, shown under the fellowship name.">
          <input className="input w-full" maxLength={200} value={form.tagline ?? ''} onChange={set('tagline')} />
        </Field>

        <Field label="Our story" hint="The About Us text. Blank lines are kept.">
          <textarea className="input w-full" rows={6} maxLength={8000} value={form.story ?? ''} onChange={set('story')} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mission">
            <textarea className="input w-full" rows={3} maxLength={2000} value={form.mission ?? ''} onChange={set('mission')} />
          </Field>
          <Field label="Vision">
            <textarea className="input w-full" rows={3} maxLength={2000} value={form.vision ?? ''} onChange={set('vision')} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="E-mail" hint="Public. Shown in the footer.">
            <input type="email" className="input w-full" maxLength={254} value={form.email ?? ''} onChange={set('email')} />
          </Field>
          <Field label="Phone">
            <input className="input w-full" maxLength={40} value={form.phone ?? ''} onChange={set('phone')} />
          </Field>
        </div>

        <Field label="Address">
          <input className="input w-full" maxLength={300} value={form.address ?? ''} onChange={set('address')} />
        </Field>

        <Field label="Service times" hint="One per line.">
          <textarea className="input w-full" rows={3} maxLength={500} value={form.service_times ?? ''} onChange={set('service_times')} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Facebook" hint="Full https:// address.">
            <input className="input w-full" maxLength={300} value={form.facebook_url ?? ''} onChange={set('facebook_url')} />
          </Field>
          <Field label="YouTube">
            <input className="input w-full" maxLength={300} value={form.youtube_url ?? ''} onChange={set('youtube_url')} />
          </Field>
          <Field label="WhatsApp">
            <input className="input w-full" maxLength={300} value={form.whatsapp_url ?? ''} onChange={set('whatsapp_url')} />
          </Field>
        </div>

        <button className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-subtle">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- pages

/**
 * The sixteen pages.
 *
 * Each is edited in place rather than behind a route, because the value of a landing page is seeing the whole shape
 * of it at once. The `suggestedTitle` is shown as the placeholder so a page the fellowship has never written still
 * says what it is for, instead of presenting sixteen identical empty boxes.
 */
function PagesTab({ data, onSaved, flash }: { data: Overview; onSaved: () => void; flash: (m: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; subtitle: string; body: string; isVisible: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const startEdit = (p: PageRow) => {
    setEditing(p.key);
    setDraft({
      title: p.title,
      subtitle: p.subtitle,
      body: p.body,
      isVisible: p.isVisible,
    });
  };

  const save = async () => {
    if (!editing || !draft) return;
    setBusy(true);
    try {
      await axios.put(`/it-content/site/pages/${editing}`, draft);
      flash('Page saved.');
      setEditing(null);
      onSaved();
    } catch (e: any) {
      flash(e.response?.data?.message || 'Could not save that page.');
    } finally {
      setBusy(false);
    }
  };

  const toggleVisible = async (p: PageRow) => {
    try {
      await axios.put(`/it-content/site/pages/${p.key}`, {
        title: p.title,
        subtitle: p.subtitle,
        body: p.body,
        isVisible: !p.isVisible,
      });
      onSaved();
    } catch (e: any) {
      flash(e.response?.data?.message || 'Could not change that.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="card p-5">
        <p className="text-sm text-ink-muted">
          Sixteen pages make up your site. Each one shows an introduction above the content the system already
          holds — your events come from the calendar, your news from approved announcements. Hiding a page removes
          it from the menu but keeps the address working, so any link somebody already shared still opens.
        </p>
      </div>

      {data.pages.map((p) => (
        <div key={p.key} className="card p-5">
          {editing === p.key && draft ? (
            <div className="space-y-4">
              <Field label="Heading" hint={`Leave blank to use "${p.suggestedTitle}".`}>
                <input className="input w-full" maxLength={200} value={draft.title} placeholder={p.suggestedTitle}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </Field>
              <Field label="Sub-heading">
                <input className="input w-full" maxLength={300} value={draft.subtitle}
                  onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
              </Field>
              <Field label="Introduction" hint={p.blurb}>
                <textarea className="input w-full" rows={4} maxLength={8000} value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={draft.isVisible}
                  onChange={(e) => setDraft({ ...draft, isVisible: e.target.checked })} />
                Show this page in the menu
              </label>
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={busy} onClick={save}>
                  {busy ? 'Saving…' : 'Save page'}
                </button>
                <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-ink">{p.title || p.suggestedTitle}</p>
                  {!p.isVisible && (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted">hidden</span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-muted">{p.subtitle || p.blurb}</p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => toggleVisible(p)}>
                {p.isVisible ? <><EyeSlashIcon className="h-4 w-4" /> Hide</> : <><EyeIcon className="h-4 w-4" /> Show</>}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => startEdit(p)}>
                <PencilSquareIcon className="h-4 w-4" /> Edit
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- posts

const EMPTY_POST = { kind: 'sermon', title: '', body: '', reference: '', attribution: '', media_url: '', happens_at: '' };

function PostsTab({ data, onSaved, flash }: { data: Overview; onSaved: () => void; flash: (m: string) => void }) {
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_POST });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<null | { id: string; title: string }>(null);

  const set = (k: keyof typeof EMPTY_POST) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const reset = () => {
    setForm({ ...EMPTY_POST });
    setEditingId(null);
    setComposing(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        kind: form.kind,
        title: form.title,
        body: form.body || undefined,
        reference: form.reference || undefined,
        attribution: form.attribution || undefined,
        media_url: form.media_url || undefined,
        happens_at: form.happens_at || undefined,
      };
      if (editingId) {
        await axios.put(`/it-content/site/posts/${editingId}`, payload);
        flash('Saved.');
      } else {
        // New items are never published on create. Publishing is a separate, deliberate press of the button.
        await axios.post('/it-content/site/posts', payload);
        flash('Added as a draft. Publish it when you are ready.');
      }
      reset();
      onSaved();
    } catch (e: any) {
      flash(e.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = async (p: Post) => {
    try {
      await axios.put(`/it-content/site/posts/${p.id}`, { isPublished: !p.is_published });
      onSaved();
    } catch (e: any) {
      flash(e.response?.data?.message || 'Could not change that.');
    }
  };

  const remove = (p: Post) => setConfirmRemove({ id: p.id, title: p.title });

  const confirmRemoveAction = async () => {
    if (!confirmRemove) return;
    try {
      await axios.delete(`/it-content/site/posts/${confirmRemove.id}`);
      flash('Removed from the website.');
      onSaved();
    } catch (e: any) {
      flash(e.response?.data?.message || 'Could not remove that.');
    } finally {
      setConfirmRemove(null);
    }
  };

  const startEdit = (p: Post) => {
    setForm({
      kind: p.kind,
      title: p.title,
      body: p.body ?? '',
      reference: p.reference ?? '',
      attribution: p.attribution ?? '',
      media_url: p.media_url ?? '',
      happens_at: p.happens_at ? p.happens_at.slice(0, 10) : '',
    });
    setEditingId(p.id);
    setComposing(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          Sermons, testimonies and projects. Anything you add stays a draft until you publish it.
        </p>
        {!composing && (
          <button className="btn btn-primary" onClick={() => { reset(); setComposing(true); }}>
            <PlusIcon className="h-4 w-4" /> Add
          </button>
        )}
      </div>

      {composing && (
        <div className="card space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <select className="select w-full" value={form.kind} onChange={set('kind')} disabled={!!editingId}>
                {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Title" >
              <input className="input w-full" maxLength={200} value={form.title} onChange={set('title')} />
            </Field>
          </div>

          <Field label="Body" hint="The main text.">
            <textarea className="input w-full" rows={5} maxLength={8000} value={form.body} onChange={set('body')} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            {form.kind === 'sermon' ? (
              <Field label="Scripture" hint="e.g. John 10:1-18">
                <input className="input w-full" maxLength={200} value={form.reference} onChange={set('reference')} />
              </Field>
            ) : (
              <Field label="Attribution" hint={form.kind === 'testimony' ? 'Who said it' : 'Who runs it'}>
                <input className="input w-full" maxLength={200} value={form.attribution} onChange={set('attribution')} />
              </Field>
            )}
            <Field label="Date" hint="When it happened or will happen.">
              <input type="date" className="input w-full" value={form.happens_at} onChange={set('happens_at')} />
            </Field>
          </div>

          <Field label="Image address" hint="A full https:// address. Used by the gallery. Optional.">
            <input className="input w-full" maxLength={500} value={form.media_url} onChange={set('media_url')} />
          </Field>

          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy || !form.title.trim()} onClick={save}>
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add as draft'}
            </button>
            <button className="btn btn-ghost" onClick={reset}><XMarkIcon className="h-4 w-4" /> Cancel</button>
          </div>
        </div>
      )}

      {data.posts.length === 0 && !composing && (
        <div className="rounded-2xl border border-dashed border-hairline bg-white px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">Nothing here yet</p>
          <p className="mt-1 text-sm text-ink-muted">Add a sermon, a testimony or a project to get started.</p>
        </div>
      )}

      {data.posts.map((p) => (
        <div key={p.id} className="card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-ink">{p.title}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                  p.is_published ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-sunken text-ink-muted'
                }`}>
                  {p.is_published ? 'published' : 'draft'}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-muted">
                {KIND_LABEL[p.kind]}
                {p.reference && ` · ${p.reference}`}
                {p.attribution && ` · ${p.attribution}`}
                {p.happens_at && ` · ${p.happens_at.slice(0, 10)}`}
              </p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => togglePublish(p)}>
              {p.is_published ? <><EyeSlashIcon className="h-4 w-4" /> Unpublish</> : <><EyeIcon className="h-4 w-4" /> Publish</>}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => startEdit(p)}>
              <PencilSquareIcon className="h-4 w-4" /> Edit
            </button>
            <button className="btn btn-ghost btn-sm text-rose-600" onClick={() => remove(p)}>
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    {confirmRemove && (
        <ConfirmDialog
          open
          title="Remove post"
          message={`Remove "${confirmRemove.title}" from your website? It will be unpublished and kept as a draft.`}
          onConfirm={confirmRemoveAction}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- messages

/**
 * What visitors have sent through the public site.
 *
 * Prayer requests and messages are private by default — the server records `is_private` and never exposes them on
 * any public route — so this screen is the only place they are readable, and it is reachable only by the
 * fellowship's own staff.
 */
function MessagesTab({ data, onSaved, flash }: { data: Overview; onSaved: () => void; flash: (m: string) => void }) {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<Enquiry[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get('/it-content/site/enquiries', { params: filter ? { kind: filter } : {} });
      setItems(r.data?.data ?? []);
    } catch (e: any) {
      flash(e.response?.data?.message || 'Could not load messages.');
    } finally {
      setLoading(false);
    }
  }, [filter, flash]);

  useEffect(() => {
    load();
  }, [load]);

  const markHandled = async (item: Enquiry) => {
    try {
      await axios.post(`/it-content/site/enquiries/${item.id}/handled`);
      flash('Marked as handled.');
      load();
      onSaved();
    } catch (e: any) {
      flash(e.response?.data?.message || 'Could not update that.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button className={`btn btn-sm ${filter === '' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('')}>
            All
          </button>
          {Object.entries(ENQUIRY_LABEL).map(([k, v]) => (
            <button key={k} className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(k)}>
              {v}
            </button>
          ))}
        </div>
        <p className="text-sm text-ink-muted">
          {data.enquiries.outstanding} waiting
        </p>
      </div>

      {loading && <p className="text-sm text-ink-muted">Loading…</p>}

      {items && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-hairline bg-white px-6 py-12 text-center">
          <InboxIcon className="mx-auto h-8 w-8 text-ink-subtle" />
          <p className="mt-3 text-sm font-medium text-ink">Nothing here</p>
          <p className="mt-1 text-sm text-ink-muted">
            Prayer requests, messages and intentions to give will appear here.
          </p>
        </div>
      )}

      {items?.map((m) => (
        <div key={m.id} className={`card p-5 ${m.is_handled ? 'opacity-70' : ''}`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink">{m.name}</p>
            <span className="rounded-full bg-primary-light px-2 py-0.5 text-xs text-primary">
              {ENQUIRY_LABEL[m.kind]}
            </span>
            {m.is_handled && (
              <span className="flex items-center gap-1 text-xs text-success"><CheckIcon className="h-3.5 w-3.5" /> handled</span>
            )}
            <span className="ml-auto text-xs text-ink-subtle">{new Date(m.created_at).toLocaleString()}</span>
          </div>

          {m.amount && (
            <p className="mt-2 text-sm font-medium text-ink">
              {m.currency} {Number(m.amount).toLocaleString()}
            </p>
          )}

          <p className="mt-2 whitespace-pre-line text-sm text-ink">{m.message}</p>

          <p className="mt-2 text-xs text-ink-subtle">
            {[m.email, m.phone].filter(Boolean).join(' · ') || 'No contact details given'}
          </p>

          {!m.is_handled && (
            <button className="btn btn-secondary btn-sm mt-3" onClick={() => markHandled(m)}>
              <CheckIcon className="h-4 w-4" /> Mark handled
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
