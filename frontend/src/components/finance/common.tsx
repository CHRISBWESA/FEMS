import { XMarkIcon } from '@heroicons/react/24/outline';
import { Alert, EmptyState, PageLoader, Modal as BaseModal } from '../ui';

/**
 * Finance-specific shared pieces.
 *
 * These existed before `components/ui.tsx` and duplicated it. They now delegate instead, so a change to a button,
 * a modal or a loading state lands in every finance tab at once rather than drifting apart.
 */

export const money = (v: string | number | null | undefined) =>
  `$${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const isoDay = (d = new Date()) => d.toISOString().slice(0, 10);

export function errMsg(err: any, fallback: string): string {
  if (err?.response?.status === 403) return "You don't have permission to do that.";
  const m = err?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
}

export function ErrorBox({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="mb-4">
      <Alert tone="danger">{text}</Alert>
    </div>
  );
}

/** `open` is implied: the parent only mounts this while the dialog is showing. */
export function Modal({ title, onClose, children, max = 'max-w-md' }: { title: string; onClose: () => void; children: React.ReactNode; max?: string }) {
  return (
    <BaseModal open onClose={onClose} title={title} width={max === 'max-w-md' ? 'md' : max === 'max-w-sm' ? 'sm' : 'lg'}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1" />
        <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm -mr-1 -mt-1 shrink-0 px-2">
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>
      {children}
    </BaseModal>
  );
}

/**
 * An empty result. `text` is the existing one-line wording used across the finance tabs; a title and a description
 * are accepted so a caller can say what belongs here rather than only that nothing does.
 */
export function Empty({ text, title, description }: { text?: string; title?: string; description?: string }) {
  return <EmptyState compact title={title ?? text ?? 'Nothing here yet'} description={description} />;
}

/** Now a skeleton that holds the page's shape, rather than a spinner that only says "wait". */
export function Spinner() {
  return <PageLoader rows={3} label="Loading" />;
}

export function Bar({ value, max, className = 'bg-primary' }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
      <div
        className={`h-2 rounded-full transition-all duration-500 ease-out ${className}`}
        style={{ width: value > 0 ? `${Math.min(100, pct)}%` : 0 }}
      />
    </div>
  );
}
