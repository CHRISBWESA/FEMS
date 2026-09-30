import { XMarkIcon } from '@heroicons/react/24/outline';

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
    <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">{text}</div>
  );
}

export function Modal({ title, onClose, children, max = 'max-w-md' }: { title: string; onClose: () => void; children: React.ReactNode; max?: string }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${max}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="btn btn-icon"><XMarkIcon className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{text}</p>
    </div>
  );
}

export function Spinner() {
  return <div className="flex items-center justify-center py-16"><span className="spinner" /></div>;
}

export function Bar({ value, max, className = 'bg-primary' }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 flex-1 rounded-full bg-slate-100">
      <div className={`h-2 rounded-full ${className}`} style={{ width: value > 0 ? `${Math.min(100, pct)}%` : 0 }} />
    </div>
  );
}
