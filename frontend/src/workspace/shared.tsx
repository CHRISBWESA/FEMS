import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';
import { ArrowDownTrayIcon, PaperClipIcon, XMarkIcon, CheckCircleIcon, ArrowUturnLeftIcon, XCircleIcon, PaperAirplaneIcon, ArrowPathIcon, NoSymbolIcon } from '@heroicons/react/24/outline';
import { Badge, Button } from '../components/ui';
import { useI18n } from '../context/I18nContext';

export interface WorkspaceDepartment {
  departmentId: string;
  name: string;
  description: string | null;
  role: 'department_chairperson' | 'department_secretary';
  since: string;
}

export interface WorkspaceContextValue {
  department: WorkspaceDepartment;
  departments: WorkspaceDepartment[];
  base: string; // e.g. /department-workspace/<id>
  path: (p?: string) => string; // app route inside this department
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside the department workspace');
  return ctx;
}

export const errMsg = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : m || fallback;
};

export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
export const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtMoney = (v?: string | number | null) =>
  v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent'> = {
  DRAFT: 'neutral',
  PENDING_SECRETARY: 'info',
  PENDING_CHAIRPERSON: 'info',
  SUBMITTED: 'info',
  RESUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  APPROVED: 'success',
  FINAL_APPROVED: 'success',
  COMPLETED: 'accent',
  RETURNED: 'warning',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  published: 'success',
  draft: 'neutral',
  archived: 'neutral',
};

/** A status pill. `label` (from the server) is used when there is no translation for the status. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const { t, language } = useI18n();
  const key = `status.${status}`;
  const translated = t(key);
  const text = language === 'en' && label ? label : translated !== key ? translated : label || status;
  return <Badge tone={TONE[status] ?? 'neutral'}>{text}</Badge>;
}

/** Downloads a CSV export (the API needs the bearer token, so a plain link would not work). */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await axios.get(url, { responseType: 'blob', withCredentials: true });
  const href = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function ExportButton({ url, filename, label }: { url: string; filename: string; label?: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try { await downloadFile(url, filename); } catch (e) { setError(errMsg(e, 'Export failed')); } finally { setBusy(false); }
        }}
      >
        <ArrowDownTrayIcon className="h-4 w-4" /> {label ?? t('ws.export')}
      </Button>
      {error && <span className="mt-1 text-xs text-danger">{error}</span>}
    </span>
  );
}

export interface Attachment { url: string; name: string; publicId?: string; type?: string; bytes?: number }

/** Uploads supporting files to the department's storage and keeps the list in `value`. */
export function AttachmentsField({ value, onChange, accept, label }: {
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  accept?: string;
  label: string;
}) {
  const { base } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    const added: Attachment[] = [];
    try {
      for (const file of Array.from(files)) {
        if (value.length + added.length >= 10) throw new Error('At most 10 files.');
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} is larger than 10 MB.`);
        const form = new FormData();
        form.append('file', file);
        const res = await axios.post(`${base}/uploads`, form, { withCredentials: true });
        added.push(res.data);
      }
    } catch (e: any) {
      setError(e?.message && !e?.response ? e.message : errMsg(e, 'Upload failed'));
    } finally {
      if (added.length) onChange([...value, ...added]);
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div>
      <p className="label">{label}</p>
      {value.length > 0 && (
        <ul className="mb-2 space-y-1">
          {value.map((a, i) => (
            <li key={a.url} className="flex items-center gap-2 rounded-control bg-surface-sunken px-3 py-1.5 text-sm">
              <PaperClipIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
              <a href={a.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-primary hover:underline">{a.name}</a>
              <button type="button" className="btn btn-ghost btn-sm px-1" aria-label={`Remove ${a.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <XMarkIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={input} type="file" multiple accept={accept} className="hidden" onChange={(e) => upload(e.target.files)} />
      <Button type="button" size="sm" loading={busy} onClick={() => input.current?.click()} disabled={value.length >= 10}>
        <PaperClipIcon className="h-4 w-4" /> Add files
      </Button>
      <p className="mt-1 text-xs text-ink-subtle">Up to 10 files, 10 MB each.</p>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

export function AttachmentList({ items, title }: { items?: Attachment[]; title?: string }) {
  if (!items?.length) return null;
  return (
    <div>
      {title && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-subtle">{title}</p>}
      <ul className="flex flex-wrap gap-2">
        {items.map((a) => (
          <li key={a.url}>
            {a.type?.startsWith('image/') ? (
              <a href={a.url} target="_blank" rel="noreferrer noopener" title={a.name}>
                <img src={a.url} alt={a.name} className="h-20 w-20 rounded-control object-cover ring-1 ring-hairline" loading="lazy" />
              </a>
            ) : (
              <a href={a.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-control bg-surface-sunken px-3 py-1.5 text-sm text-primary hover:underline">
                <PaperClipIcon className="h-4 w-4" /> {a.name}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const EVENT_ICON: Record<string, ReactNode> = {
  submitted: <PaperAirplaneIcon className="h-4 w-4" />,
  resubmitted: <ArrowPathIcon className="h-4 w-4" />,
  approved: <CheckCircleIcon className="h-4 w-4" />,
  returned: <ArrowUturnLeftIcon className="h-4 w-4" />,
  rejected: <XCircleIcon className="h-4 w-4" />,
  cancelled: <NoSymbolIcon className="h-4 w-4" />,
};
const EVENT_TONE: Record<string, string> = {
  approved: 'bg-success-light text-success',
  returned: 'bg-warning-light text-warning',
  rejected: 'bg-danger-light text-danger',
};
const ROLE_NAME: Record<string, string> = { secretary: 'Fellowship Secretary', chairperson: 'Fellowship Chairperson', treasurer: 'Treasurer' };

export interface HistoryEvent { action: string; stage: number | null; role: string | null; comment: string | null; at: string; by: string | null }

/** Every submission and decision, oldest first, including earlier review rounds. */
export function HistoryTimeline({ events }: { events?: HistoryEvent[] }) {
  const { t } = useI18n();
  if (!events?.length) return <p className="text-sm text-ink-muted">Nothing has been submitted yet.</p>;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">{t('ws.history')}</p>
      <ol className="space-y-3">
        {events.map((e, i) => (
          <li key={i} className="flex gap-3">
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${EVENT_TONE[e.action] ?? 'bg-surface-sunken text-ink-muted'}`}>{EVENT_ICON[e.action]}</span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-ink">
                <span className="font-medium capitalize">{e.action}</span>
                {e.role ? <> by the {ROLE_NAME[e.role] ?? e.role}</> : null}
                {e.by ? <span className="text-ink-muted"> ({e.by})</span> : null}
              </p>
              <p className="text-xs text-ink-subtle">{fmtDateTime(e.at)}</p>
              {e.comment && <p className="mt-1 whitespace-pre-wrap rounded-control bg-surface-sunken px-3 py-2 text-ink">{e.comment}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Pager({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const last = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink-muted">
      <span>Page {page} of {last} · {total} total</span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" disabled={page >= last} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

/** Label/value pair for detail views. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{children}</dd>
    </div>
  );
}
