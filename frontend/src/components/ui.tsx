/**
 * The shared UI layer.
 *
 * Everything visual that more than one page needs lives here, so a button, a table header or an empty state looks
 * the same everywhere. Pages compose these; they do not re-invent them.
 *
 * These are presentational only. They render what they are given and raise intent back out through callbacks, so
 * none of them fetch, store or decide anything.
 */
import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/* ------------------------------------------------------------------ layout */

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-desc">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="section-title">{title}</h2>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function Card({ children, className = '', as: Tag = 'div', ...rest }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article'; [key: string]: unknown }) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ buttons */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger' | 'danger-quiet' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ forms */

const FieldContext = createContext<{ id: string; describedBy: string } | null>(null);

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className = '',
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <FieldContext.Provider value={{ id, describedBy }}>
      <div className={`field-group ${className}`}>
        <label htmlFor={id} className="label">
          {label}
          {required ? <span className="ml-0.5 text-danger">*</span> : null}
        </label>
        {children}
        {hint ? (
          <p id={hintId} className="hint">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="field-error">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/**
 * Wires the input inside a `Field` to that field's label, hint and error, so screen readers announce them and a
 * click on the label focuses the control.
 */
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const field = useContext(FieldContext);
  const { className = '', ...rest } = props;
  return <input className={`input ${className}`} id={field?.id} aria-describedby={field?.describedBy || undefined} {...rest} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const field = useContext(FieldContext);
  const { className = '', ...rest } = props;
  return <textarea className={`textarea ${className}`} id={field?.id} aria-describedby={field?.describedBy || undefined} {...rest} />;
}

export function Select({
  options,
  placeholder,
  className = '',
  ...rest
}: { options: { value: string; label: string }[]; placeholder?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const field = useContext(FieldContext);
  return (
    <select className={`select w-full ${className}`} id={field?.id} aria-describedby={field?.describedBy || undefined} {...rest}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ label, className = '', ...rest }: { label: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      <input type="checkbox" id={id} className="checkbox mt-0.5" {...rest} />
      <label htmlFor={id} className="cursor-pointer text-sm leading-relaxed text-ink">
        {label}
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ feedback */

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className = '',
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`alert alert-${tone} ${className}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-10' : 'py-14'} px-6`}>
      {icon ? <div className="text-ink-subtle">{icon}</div> : null}
      <h3 className="mt-4 text-base font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** A table-shaped placeholder, so a loading table keeps its height and nothing jumps when data arrives. */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="table-wrap animate-pulse" aria-busy="true" aria-live="polite">
      <table className="table">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i}>
                <div className="skeleton h-3 w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: columns }).map((_, c) => (
                <td key={c}>
                  <div className="skeleton h-3.5" style={{ width: `${45 + ((r * 7 + c * 13) % 40)}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">Loading</span>
    </div>
  );
}

/**
 * The generic "this page is loading" state.
 *
 * A centred spinner tells the reader only that time is passing. A skeleton that holds the page's own shape tells
 * them what is arriving and stops the layout jumping when it does, which is the difference between a screen that
 * feels broken and one that feels quick.
 */
export function PageLoader({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="skeleton h-6 w-48" />
          <div className="skeleton h-3.5 w-72" />
        </div>
        <div className="skeleton h-9 w-28 rounded-control" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card card-pad space-y-3">
          <div className="flex items-center gap-3">
            <div className="skeleton h-10 w-10 rounded-control" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5" style={{ width: `${38 + ((i * 17) % 34)}%` }} />
              <div className="skeleton h-3 w-2/5" />
            </div>
          </div>
          <div className="skeleton h-3 w-full" />
          <div className="skeleton h-3 w-4/5" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: { title?: string; message?: ReactNode; onRetry?: () => void }) {
  return (
    <EmptyState
      title={title}
      description={message || 'The request could not be completed. Check your connection and try again.'}
      action={onRetry ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : undefined}
    />
  );
}

/* ------------------------------------------------------------------ overlays */

/**
 * A modal that behaves like a dialog: it closes on Escape, locks background scrolling, moves focus inside on open
 * and returns focus to the trigger on close.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const labelId = useId();

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        className={`modal ${width === 'sm' ? 'max-w-sm' : width === 'lg' ? 'max-w-3xl' : ''}`}
      >
        <h2 id={labelId} className="modal-title">
          {title}
        </h2>
        {description ? <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{description}</p> : null}
        {children ? <div className="mt-5">{children}</div> : null}
        {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Asks before something irreversible happens, and names the consequence rather than saying "Are you sure?". */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  loading = false,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-muted">{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ data display */

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Avatar({ name, size = 'md' }: { name?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span className={`avatar ${size === 'sm' ? 'avatar-sm' : size === 'lg' ? 'avatar-lg' : ''}`} aria-hidden>
      {initials || '?'}
    </span>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: { key: T; label: ReactNode }[];
  active: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          className={`tab ${t.key === active ? 'tab-active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}