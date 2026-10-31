import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';
import { ArrowDownTrayIcon, PaperClipIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Alert, Badge, Button, Field, Modal, Select, Textarea, useToast } from '../components/ui';
import { useI18n } from '../context/I18nContext';

/**
 * Shared pieces of the Finance and Projects screens. Every screen works for central fellowship money
 * (departmentId = null) or for one department's own money (departmentId = its id), so the department workspace
 * reuses the same screens; the server decides what each person may see and do.
 */

export interface FinScope {
  departmentId: string | null;
  departmentName?: string;
  /** The office this person holds for the scope: 'treasurer' etc. for central, the leader role for a department. */
  roles: string[];
  leaderRole?: 'department_chairperson' | 'department_secretary' | null;
  currency: string;
  paymentMethods: string[];
}

export const FinContext = createContext<FinScope>({ departmentId: null, roles: [], currency: 'TZS', paymentMethods: ['cash'] });
export const useFin = () => useContext(FinContext);

/** `?departmentId=` for the API: a department's id, or `central` for central money. */
export const scopeQuery = (s: FinScope) => `departmentId=${s.departmentId ?? 'central'}`;

export const errMsg = (e: any, fallback: string): string => {
  if (e?.response?.status === 403 && !e?.response?.data?.message) return "You don't have permission to do that.";
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : m || fallback;
};

export const fmtMoney = (v: string | number | null | undefined, currency?: string) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${n}` : n;
};
export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
export const today = () => new Date().toISOString().slice(0, 10);
export const label = (s?: string | null) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');

/** Loads a URL and keeps it fresh; `reload()` after a change. */
export function useLoad<T = any>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const reload = useCallback(() => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    setError('');
    axios.get(url, { withCredentials: true })
      .then((r) => { if (n === seq.current) setData(r.data); })
      .catch((e) => { if (n === seq.current) setError(errMsg(e, 'Could not load.')); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [url, ...deps]);
  useEffect(reload, [reload]);
  return { data, error, loading, reload, setData };
}

const TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent'> = {
  DRAFT: 'neutral', SUBMITTED: 'info', RESUBMITTED: 'info', UNDER_REVIEW: 'info', PENDING: 'info', PENDING_APPROVAL: 'info', APPROVED: 'success',
  FINAL_APPROVED: 'success', COMPLETED: 'success', ACTIVE: 'success', RETURNED: 'warning', ON_HOLD: 'warning', REJECTED: 'danger', CANCELLED: 'neutral', CLOSED: 'neutral',
  active: 'success', reversed: 'danger', paid: 'success', approved: 'success', requested: 'info', awaiting_verification: 'warning', returned: 'warning',
  rejected: 'danger', cancelled: 'neutral', pending: 'info', partially_fulfilled: 'warning', fulfilled: 'success', overdue: 'danger', draft: 'neutral',
  paused: 'warning', closed: 'neutral', open: 'success', unpaid: 'warning', partially_paid: 'warning', not_due: 'neutral',
};

export function Status({ value }: { value?: string | null }) {
  const { t } = useI18n();
  if (!value) return <span className="text-ink-subtle">—</span>;
  const key = `fin.status.${value}`;
  const text = t(key) !== key ? t(key) : label(value);
  return <Badge tone={TONES[value] ?? 'neutral'}>{text}</Badge>;
}

/** Downloads a PDF/Excel export (the API needs the session, so a plain link would not work). */
export async function download(url: string, filename: string) {
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

/** Opens a PDF in a new tab (receipts). */
export async function openPdf(url: string) {
  const w = window.open('', '_blank');
  const res = await axios.get(url, { responseType: 'blob', withCredentials: true });
  const href = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  if (w) w.location.href = href; else window.location.href = href;
}

export function ExportButtons({ url, name }: { url: string; name: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const go = async (fmt: 'pdf' | 'xlsx') => {
    setBusy(fmt);
    try { await download(`${url}${url.includes('?') ? '&' : '?'}format=${fmt}`, `${name}.${fmt}`); }
    catch (e) { toast.push('error', errMsg(e, 'Export failed')); }
    finally { setBusy(''); }
  };
  return (
    <span className="inline-flex gap-2">
      <Button size="sm" loading={busy === 'pdf'} onClick={() => go('pdf')}><ArrowDownTrayIcon className="h-4 w-4" /> PDF</Button>
      <Button size="sm" loading={busy === 'xlsx'} onClick={() => go('xlsx')}><ArrowDownTrayIcon className="h-4 w-4" /> {t('fin.excel')}</Button>
    </span>
  );
}

export interface Attachment { url: string; name: string; publicId?: string; type?: string; bytes?: number }

export function AttachmentPicker({ value, onChange, label: text }: { value: Attachment[]; onChange: (v: Attachment[]) => void; label: string }) {
  const s = useFin();
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
        const form = new FormData();
        form.append('file', file);
        added.push((await axios.post(`/finance/uploads?${scopeQuery(s)}`, form, { withCredentials: true })).data);
      }
    } catch (e: any) {
      setError(e?.response ? errMsg(e, 'Upload failed') : e.message);
    } finally {
      if (added.length) onChange([...value, ...added]);
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div>
      <p className="label">{text}</p>
      {value.length > 0 && (
        <ul className="mb-2 space-y-1">
          {value.map((a, i) => (
            <li key={a.url} className="flex items-center gap-2 rounded-control bg-surface-sunken px-3 py-1.5 text-sm">
              <PaperClipIcon className="h-4 w-4 text-ink-subtle" />
              <a href={a.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-primary hover:underline">{a.name}</a>
              <button type="button" className="btn btn-ghost btn-sm px-1" aria-label={`Remove ${a.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><XMarkIcon className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <input ref={input} type="file" multiple className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => upload(e.target.files)} />
      <Button type="button" size="sm" loading={busy} onClick={() => input.current?.click()}><PaperClipIcon className="h-4 w-4" /> Add files</Button>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

export function Attachments({ items }: { items?: Attachment[] }) {
  if (!items?.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((a) => (
        <li key={a.url}><a href={a.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-control bg-surface-sunken px-2 py-1 text-sm text-primary hover:underline"><PaperClipIcon className="h-4 w-4" />{a.name}</a></li>
      ))}
    </ul>
  );
}

/** A dialog form with an error line and a submit button. */
export function FormModal({ open, onClose, title, description, onSubmit, children, submitLabel = 'Save', width = 'md' }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; onSubmit: () => Promise<void>; children: ReactNode; submitLabel?: string; width?: 'sm' | 'md' | 'lg';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) setError(''); }, [open]);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try { await onSubmit(); onClose(); } catch (err) { setError(errMsg(err, 'Could not save.')); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} width={width}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => submit()}>{submitLabel}</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {children}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

export function MethodSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { paymentMethods } = useFin();
  return <Select value={value} onChange={(e) => onChange(e.target.value)} options={paymentMethods.map((m) => ({ value: m, label: label(m) }))} />;
}

/** Accounts of this scope for a form. */
export function useAccounts() {
  const s = useFin();
  return useLoad<any[]>(`/finance/accounts?${scopeQuery(s)}`, [s.departmentId]);
}

export function AccountSelect({ value, onChange, placeholder = 'Default account (cash in hand)' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { data } = useAccounts();
  const s = useFin();
  return <Select value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} options={(data ?? []).map((a) => ({ value: a.id, label: `${a.name} · ${fmtMoney(a.balance, s.currency)}` }))} />;
}

export function ProjectSelect({ value, onChange, placeholder = 'No project' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const s = useFin();
  const { data } = useLoad<any[]>(`/finance/fundable-projects?${scopeQuery(s)}`, [s.departmentId]);
  return <Select value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} options={(data ?? []).map((p) => ({ value: p.id, label: `${p.project_number} · ${p.name}` }))} />;
}

export function CategorySelect({ kind, value, onChange }: { kind: 'contribution' | 'income' | 'expense'; value: string; onChange: (v: string) => void }) {
  const s = useFin();
  const { data } = useLoad<any[]>(s.departmentId ? null : `/finance/categories?kind=${kind}`, [kind]);
  if (s.departmentId) return null;
  return <Select value={value} onChange={(e) => onChange(e.target.value)} placeholder="No category" options={(data ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))} />;
}

/** Member search: the department's members in a department, the fellowship's members centrally. */
export function MemberPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void }) {
  const s = useFin();
  const [q, setQ] = useState('');
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    const h = setTimeout(() => {
      const url = s.departmentId ? `/department-workspace/${s.departmentId}/members?search=${encodeURIComponent(q)}&limit=20` : `/members?search=${encodeURIComponent(q)}&limit=20`;
      axios.get(url, { withCredentials: true })
        .then((r) => setList((Array.isArray(r.data) ? r.data : r.data.data ?? []).map((m: any) => ({ id: m.memberId ?? m.id, name: m.fullName ?? m.full_name, code: m.memberCode ?? m.member_code }))))
        .catch(() => setList([]));
    }, 250);
    return () => clearTimeout(h);
  }, [q, s.departmentId]);
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-control bg-surface-sunken px-3 py-2 text-sm">
        <span className="font-medium text-ink">{value.name}</span>
        <button type="button" className="text-primary hover:underline" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  return (
    <div>
      <input className="input" placeholder="Search by name or member code" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-auto rounded-control border border-hairline bg-surface">
          {list.map((m) => (
            <li key={m.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-sunken" onClick={() => onChange({ id: m.id, name: m.name })}>{m.name} <span className="text-ink-subtle">{m.code}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Approve / return / reject the current stage of an approval. A comment is required to return or reject. */
export function DecisionButtons({ approvalId, onDone }: { approvalId: string; onDone: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'' | 'returned' | 'rejected'>('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (decision: string) => {
    setBusy(true);
    try {
      await axios.post(`/finance/approvals/${approvalId}/decide`, { decision, comment: comment || undefined }, { withCredentials: true });
      toast.push('success', decision === 'approved' ? 'Approved' : decision === 'returned' ? 'Returned for changes' : 'Rejected');
      setMode('');
      setComment('');
      onDone();
    } catch (e) { toast.push('error', errMsg(e, 'Could not record the decision.')); } finally { setBusy(false); }
  };
  return (
    <>
      <span className="inline-flex flex-wrap gap-2">
        <Button size="sm" variant="primary" loading={busy && !mode} onClick={() => send('approved')}>Approve</Button>
        <Button size="sm" onClick={() => setMode('returned')}>Return</Button>
        <Button size="sm" variant="danger" onClick={() => setMode('rejected')}>Reject</Button>
      </span>
      <Modal open={!!mode} onClose={() => setMode('')} title={mode === 'returned' ? 'Return for changes' : 'Reject'}
        footer={<><Button onClick={() => setMode('')}>Cancel</Button><Button variant={mode === 'rejected' ? 'danger' : 'primary'} loading={busy} disabled={!comment.trim()} onClick={() => send(mode)}>{mode === 'returned' ? 'Return' : 'Reject'}</Button></>}>
        <Field label="Comment" required hint="The requester sees this."><Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

/** Approval trail: every submission and decision, oldest first. */
export function Trail({ approvalId }: { approvalId?: string | null }) {
  const { data } = useLoad<any[]>(approvalId ? `/finance/approvals/${approvalId}/history` : null, [approvalId]);
  if (!approvalId) return null;
  if (!data?.length) return <p className="text-sm text-ink-muted">No decisions yet.</p>;
  return (
    <ol className="space-y-2 text-sm">
      {data.map((e, i) => (
        <li key={i} className="rounded-control bg-surface-sunken px-3 py-2">
          <span className="font-medium capitalize text-ink">{e.action}</span>
          {e.role ? <span className="text-ink-muted"> · {label(e.role)}</span> : null}
          {e.by ? <span className="text-ink-muted"> · {e.by}</span> : null}
          <span className="block text-xs text-ink-subtle">{new Date(e.at).toLocaleString()}</span>
          {e.comment && <p className="mt-1 whitespace-pre-wrap text-ink">{e.comment}</p>}
        </li>
      ))}
    </ol>
  );
}

/** A simple two-series bar chart (income vs expenses) without a charting library. */
export function MonthlyBars({ rows, currency }: { rows: { month: string; income: string; expenses: string }[]; currency: string }) {
  const max = Math.max(1, ...rows.flatMap((r) => [Number(r.income), Number(r.expenses)]));
  return (
    <div>
      <div className="flex h-40 items-end gap-1" role="img" aria-label="Income and expenses by month">
        {rows.map((r) => (
          <div key={r.month} className="flex h-full flex-1 items-end gap-0.5" title={`${r.month}: in ${fmtMoney(r.income, currency)}, out ${fmtMoney(r.expenses, currency)}`}>
            <div className="w-1/2 rounded-t bg-success" style={{ height: `${(Number(r.income) / max) * 100}%` }} />
            <div className="w-1/2 rounded-t bg-danger" style={{ height: `${(Number(r.expenses) / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-ink-subtle">{rows.map((r) => <span key={r.month} className="flex-1 text-center">{r.month.slice(5)}</span>)}</div>
      <div className="mt-2 flex gap-4 text-xs text-ink-muted"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-success" /> Money in</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-danger" /> Money out</span></div>
    </div>
  );
}

export function Row({ k, v }: { k: string; v: ReactNode }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className="flex justify-between gap-4 border-b border-hairline py-1.5 text-sm last:border-0">
      <span className="text-ink-muted">{k}</span>
      <span className="text-right font-medium text-ink">{v}</span>
    </div>
  );
}
