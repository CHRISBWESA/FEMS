/**
 * The shared UI layer.
 *
 * Everything visual that more than one page needs lives here, so a button, a table header or an empty state looks
 * the same everywhere. Pages compose these; they do not re-invent them.
 *
 * These are presentational only. They render what they are given and raise intent back out through callbacks, so
 * none of them fetch, store or decide anything.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ArrowUpTrayIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

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

/* ------------------------------------------------------------------ header/nav */

/**
 * Where the reader is, and one click back. The application shell already names the current page in its header, so
 * this carries the path *through* it — which is what a deep link like /members/123 needs to make sense.
 */
export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 ? <span className="text-ink-subtle" aria-hidden>/</span> : null}
              {item.to && !last ? (
                <Link to={item.to} className="rounded text-ink-muted transition-colors hover:text-primary">
                  {item.label}
                </Link>
              ) : (
                <span className={last ? 'font-medium text-ink' : 'text-ink-muted'} aria-current={last ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ------------------------------------------------------------------ stats */

/**
 * A single figure with its label and an optional footnote.
 *
 * `tone` is for meaning, not decoration: a warning figure should read as a warning, and everything else should not
 * be shouting at the reader from a dashboard wall.
 */
export function StatCard({
  label, value, hint, icon, tone = 'neutral', to, onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
  to?: string;
  onClick?: () => void;
}) {
  const tones = {
    neutral: 'bg-surface-sunken text-ink-muted',
    primary: 'bg-primary-light text-primary',
    success: 'bg-success-light text-success',
    warning: 'bg-warning-light text-warning',
    danger: 'bg-danger-light text-danger',
  };

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink-muted">{label}</p>
        {icon ? <div className={`stat-icon h-9 w-9 ${tones[tone]}`}>{icon}</div> : null}
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-ink-subtle">{hint}</p> : null}
    </>
  );

  const className = 'card card-pad text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-elevated';

  if (to) return <Link to={to} className={className}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={`${className} w-full`}>{inner}</button>;
  return <div className={className}>{inner}</div>;
}

/** The equal-height row of StatCards every list page and dashboard puts under its header. */
export function StatGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-2 gap-4 lg:grid-cols-4 ${className}`}>{children}</div>;
}

/* ------------------------------------------------------------------ icon button */

/** For a control that is only an icon. `label` is required, because there is no visible text to announce. */
export function IconButton({
  label, icon, variant = 'ghost', size = 'md', ...rest
}: {
  label: string;
  icon: ReactNode;
  variant?: 'ghost' | 'secondary' | 'danger' | 'danger-quiet';
  size?: 'sm' | 'md';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} px-2`}
      {...rest}
    >
      {icon}
    </button>
  );
}

/* ------------------------------------------------------------------ choice inputs */

export function Radio({ label, description, ...rest }: { label: ReactNode; description?: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input type="radio" id={id} className="mt-1 h-4 w-4 shrink-0 cursor-pointer border-hairline text-primary focus:ring-2 focus:ring-primary/30" {...rest} />
      <label htmlFor={id} className="cursor-pointer text-sm leading-relaxed text-ink">
        {label}
        {description ? <span className="mt-0.5 block text-xs text-ink-muted">{description}</span> : null}
      </label>
    </div>
  );
}

export function Switch({ label, description, checked, onChange, disabled }: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="cursor-pointer text-sm leading-relaxed text-ink">
        {label}
        {description ? <span className="mt-0.5 block text-xs text-ink-muted">{description}</span> : null}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
          checked ? 'bg-primary' : 'bg-hairline'
        }`}
      >
        <span
          className={`inline-block h-4.5 w-4.5 rounded-full bg-white shadow-card transition-transform duration-200 ease-out ${
            checked ? 'translate-x-[1.375rem]' : 'translate-x-1'
          }`}
          style={{ height: '1.125rem', width: '1.125rem' }}
        />
      </button>
    </div>
  );
}

/**
 * Selecting several options from a short list.
 *
 * Deliberately a list of checkboxes rather than a custom popover: the option counts here are small (departments,
 * roles, statuses) and native checkboxes come with keyboard behaviour and screen-reader support for free.
 */
export function MultiSelect({ options, value, onChange, emptyLabel = 'None selected' }: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
}) {
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  if (options.length === 0) return <p className="text-sm text-ink-subtle">{emptyLabel}</p>;

  return (
    <div className="space-y-2">
      {options.map((o) => (
        <Checkbox key={o.value} label={o.label} checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
      ))}
    </div>
  );
}

export function DatePicker(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const field = useContext(FieldContext);
  const { className = '', ...rest } = props;
  return (
    <input
      type="date"
      className={`input ${className}`}
      id={field?.id}
      aria-describedby={field?.describedBy || undefined}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ file upload */

/**
 * A file input that shows what was chosen.
 *
 * The native control is kept, visually hidden rather than replaced, so drag-and-drop, the keyboard, and the
 * platform file picker all keep working. Size is checked here as well as on the server: the server check is the one
 * that matters, and this one saves the user a pointless upload first.
 */
export function FileUploader({
  onSelect, accept, maxSizeMb = 10, label = 'Choose a file', hint, busy = false,
}: {
  onSelect: (file: File) => void;
  accept?: string;
  maxSizeMb?: number;
  label?: string;
  hint?: ReactNode;
  busy?: boolean;
}) {
  const [chosen, setChosen] = useState<File | null>(null);
  const [problem, setProblem] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = (file: File | undefined) => {
    if (!file) return;
    if (file.size > maxSizeMb * 1024 * 1024) {
      setProblem(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${maxSizeMb} MB.`);
      setChosen(null);
      return;
    }
    setProblem('');
    setChosen(file);
    onSelect(file);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className={`btn btn-secondary ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          {busy ? <span className="spinner h-4 w-4" /> : <ArrowUpTrayIcon className="h-4 w-4" />}
          {label}
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            accept={accept}
            disabled={busy}
            onChange={(e) => handle(e.target.files?.[0])}
          />
        </label>
        {chosen ? (
          <span className="inline-flex items-center gap-2 text-sm text-ink">
            {chosen.name}
            <span className="text-ink-subtle">({(chosen.size / 1024).toFixed(0)} KB)</span>
            <button
              type="button"
              onClick={() => {
                setChosen(null);
                setProblem('');
                if (inputRef.current) inputRef.current.value = '';
              }}
              aria-label={`Remove ${chosen.name}`}
              className="rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </span>
        ) : null}
      </div>
      {hint ? <p className="hint">{hint}</p> : null}
      {problem ? <p className="field-error">{problem}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ timeline */

export function Timeline({ items }: { items: { key: string; title: ReactNode; meta?: ReactNode; body?: ReactNode }[] }) {
  return (
    <ol className="relative space-y-4 border-l border-hairline pl-5">
      {items.map((it) => (
        <li key={it.key} className="relative">
          <span aria-hidden className="absolute -left-[1.4375rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-surface" />
          <p className="text-sm font-medium text-ink">{it.title}</p>
          {it.meta ? <p className="mt-0.5 text-xs text-ink-subtle">{it.meta}</p> : null}
          {it.body ? <div className="mt-1 text-sm leading-relaxed text-ink-muted">{it.body}</div> : null}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ stepper */

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={active ? 'step' : undefined}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                done ? 'bg-primary text-white' : active ? 'bg-primary text-white ring-4 ring-primary/20' : 'bg-surface-sunken text-ink-subtle'
              }`}
            >
              {done ? <CheckIcon className="h-4 w-4" /> : i + 1}
            </span>
            <span className={`text-sm ${active ? 'font-medium text-ink' : 'text-ink-muted'}`}>
              {label}
              {done ? <span className="sr-only"> (completed)</span> : null}
            </span>
            {i < steps.length - 1 ? <span aria-hidden className="mx-1 h-px w-6 bg-hairline sm:w-10" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ toasts */

type Toast = { id: number; tone: 'success' | 'error' | 'info'; message: string };
const ToastContext = createContext<{ push: (tone: Toast['tone'], message: string) => void }>({ push: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

/**
 * Feedback for something that has already happened, so the reader is not left wondering whether their click
 * registered. Deliberately not a substitute for an error that needs reading: a failed action that matters should
 * also be shown inline where it happened.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const push = (tone: Toast['tone'], message: string) => {
    const id = next.current++;
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  };

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`alert alert-${t.tone === 'error' ? 'danger' : t.tone} pointer-events-auto w-full max-w-md shadow-overlay`}
          >
            <span className="min-w-0 flex-1">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
              className="shrink-0 rounded p-1 hover:bg-black/5"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}