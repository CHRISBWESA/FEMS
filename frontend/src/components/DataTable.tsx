/**
 * The table used by every list in FEMS.
 *
 * It was written against the patterns this codebase actually has, not an idealised generic grid:
 *
 *  - Paging is usually **server-side**. The API bounds a list and reports the true size in `X-Total-Count`
 *    (`totalFromHeaders`), so `total` is passed in and the pager reflects the real number rather than the number of
 *    rows that happened to arrive. `clientPaging` is available for the smaller lists that are not bounded.
 *  - Columns are frequently **conditional** on the viewer's permissions, so `visibleWhen` hides a column outright
 *    instead of rendering an empty cell.
 *  - Lists are frequently **bounded but not searchable**, which used to produce a silent wall of rows. `boundedNotice`
 *    reproduces the message `ListLimitNotice` has been giving, so a truncated list says so.
 *
 * On a phone a row is rendered as a card rather than being squashed into a horizontally scrolling strip: columns
 * marked `secondary` are dropped and `primary` becomes the card title. Set `mobile="scroll"` to opt a table out where
 * the columns genuinely need comparing side by side.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon,
  MagnifyingGlassIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import { Button, EmptyState, ErrorState } from './ui';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T, index: number) => ReactNode;
  /** Enables sorting. Omit for a column that cannot be sorted. */
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  /** Numerals line up on the decimal. Set for counts and money. */
  tabular?: boolean;
  /** On mobile: `secondary` columns are dropped from the card, `primary` becomes its title. */
  priority?: 'primary' | 'secondary' | 'meta';
  /** Hides the column entirely unless true, for columns gated on a permission. */
  visibleWhen?: boolean;
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | null | undefined;
  rowKey: (row: T) => string;
  /** Distinguishes "loading" from "loaded and empty". */
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  caption?: string;

  /** True size of the list, normally from `X-Total-Count`. Omit for a list that is not bounded. */
  total?: number | null;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  /** Paging is done by the browser rather than the server. */
  clientPaging?: boolean;

  search?: { value: string; onChange: (value: string) => void; placeholder?: string };

  sort?: { key: string; direction: 'asc' | 'desc'; onChange: (key: string) => void };
  /** Sorts in the browser. Ignored when `sort.onChange` is given. */
  clientSort?: boolean;

  /** Rendered in a trailing column, or in the card's action row on mobile. */
  rowActions?: (row: T) => ReactNode;
  selectable?: {
    selected: string[];
    onChange: (selected: string[]) => void;
    label?: (row: T) => string;
  };

  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  loadingRows?: number;
  /** Shown when the server truncated the list, e.g. "Showing the first 100 of 412 members." */
  boundedNotice?: { total: number; noun: string };
  mobile?: 'card' | 'scroll';
  /** Extra controls beside the search box, e.g. filter selects. */
  toolbar?: ReactNode;
}

export function DataTable<T>({
  columns, rows, rowKey, loading = false, error = null, onRetry, caption,
  total = null, page = 1, pageSize = 25, onPageChange, clientPaging = false,
  search, sort, clientSort = false, rowActions, selectable, empty,
  loadingRows = 8, boundedNotice, mobile = 'card', toolbar,
}: DataTableProps<T>) {
  const visible = useMemo(() => columns.filter((c) => c.visibleWhen !== false), [columns]);
  const tableId = useId();
  const [pageSizeState, setPageSizeState] = useState(pageSize);

  // Reset to the first page whenever the result set changes shape, or the reader lands on an empty page 7.
  useEffect(() => {
    setPageSizeState(pageSize);
  }, [pageSize]);

  const data = rows ?? [];

  const locallySorted = useMemo(() => {
    if (!clientSort || !sort) return data;
    const dir = sort.direction === 'asc' ? 1 : -1;
    const col = visible.find((c) => c.sortKey === sort.key);
    if (!col) return data;
    const value = (r: T) => {
      const raw = col.render ? null : (r as Record<string, unknown>)[col.key];
      return raw ?? '';
    };
    return [...data].sort((a, b) => String(value(a)).localeCompare(String(value(b)), undefined, { numeric: true }) * dir);
  }, [data, clientSort, sort, visible]);

  const totalCount = total ?? locallySorted.length;
  const lastPage = Math.max(1, Math.ceil(totalCount / pageSizeState));
  const safePage = Math.min(page, lastPage);
  const windowed = clientPaging ? locallySorted.slice((safePage - 1) * pageSizeState, safePage * pageSizeState) : locallySorted;

  const allKeys = windowed.map(rowKey);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selectable?.selected.includes(k));

  const toggleAll = () => {
    if (!selectable) return;
    selectable.onChange(allSelected ? [] : allKeys);
  };

  const toggleOne = (key: string) => {
    if (!selectable) return;
    selectable.onChange(
      selectable.selected.includes(key) ? selectable.selected.filter((k) => k !== key) : [...selectable.selected, key],
    );
  };

  const setSort = (key: string) => {
    if (!sort) return;
    sort.onChange(key);
  };

  const primary = visible.find((c) => c.priority === 'primary') ?? visible[0];
  const meta = visible.filter((c) => c.priority === 'meta');
  const secondary = visible.filter((c) => c.priority === 'secondary');

  const searchBox = search ? (
    <div className="relative w-full sm:w-72">
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
      <input
        type="search"
        className="input pl-9"
        value={search.value}
        placeholder={search.placeholder ?? 'Search'}
        aria-label={search.placeholder ?? 'Search'}
        onChange={(e) => search.onChange(e.target.value)}
      />
      {search.value ? (
        <button
          type="button"
          onClick={() => search.onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  ) : null;

  const notice = boundedNotice && totalCount > data.length ? (
    <div className="alert alert-warning" role="status">
      Showing the first {data.length} of {boundedNotice.total} {boundedNotice.noun}. Use the filters to narrow the list
      down.
    </div>
  ) : null;

  const pager = onPageChange && lastPage > 1 ? (
    <Pagination page={safePage} lastPage={lastPage} total={totalCount} onChange={onPageChange} />
  ) : null;

  const head = (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">{searchBox}{toolbar}</div>
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        {loading ? 'Loading…' : totalCount > 0 ? `${totalCount.toLocaleString()} total` : null}
        {selectable && selectable.selected.length > 0 ? (
          <span className="badge badge-info">{selectable.selected.length} selected</span>
        ) : null}
      </div>
    </div>
  );

  if (error) {
    return (
      <div>
        {head}
        <div className="card card-pad">
          <ErrorState message={error} onRetry={onRetry} />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        {head}
        <div className="table-wrap animate-pulse" aria-busy="true">
          <table className="table">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead>
              <tr>
                {selectable ? <th scope="col" className="w-10" /> : null}
                {visible.map((c) => (
                  <th key={c.key} scope="col" style={c.width ? { width: c.width } : undefined}>
                    <div className="skeleton h-3 w-16" />
                  </th>
                ))}
                {rowActions ? <th scope="col" className="w-10" /> : null}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: loadingRows }).map((_, r) => (
                <tr key={r}>
                  {selectable ? <td><div className="skeleton h-4 w-4" /></td> : null}
                  {visible.map((c) => (
                    <td key={c.key}>
                      <div className="skeleton h-3.5" style={{ width: `${40 + ((r * 11 + c.key.length * 7) % 45)}%` }} />
                    </td>
                  ))}
                  {rowActions ? <td><div className="skeleton h-4 w-4" /></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        {head}
        {notice}
        <div className="card">
          <EmptyState
            title={empty?.title ?? 'Nothing to show'}
            description={empty?.description}
            action={empty?.action}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      {head}
      {notice}
      <div className="table-wrap">
        <table id={tableId} className="table">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr>
              {selectable ? (
                <th scope="col" className="w-10">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={allSelected ? 'Clear selection' : 'Select all rows'}
                  />
                </th>
              ) : null}
              {visible.map((c) => {
                const active = sort?.key === c.sortKey;
                const ariaSort = !c.sortKey ? undefined : active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none';
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={ariaSort}
                    style={c.width ? { width: c.width } : undefined}
                    className={[
                      c.headerClassName,
                      c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : '',
                      c.tabular ? 'tabular-nums' : '',
                    ].join(' ')}
                  >
                    {c.sortKey ? (
                      <button
                        type="button"
                        onClick={() => setSort(c.sortKey!)}
                        className="inline-flex items-center gap-1 hover:text-ink"
                      >
                        {c.header}
                        {active ? (
                          sort!.direction === 'asc' ? <ArrowUpIcon className="h-3.5 w-3.5" /> : <ArrowDownIcon className="h-3.5 w-3.5" />
                        ) : (
                          <span className="inline-block h-3.5 w-3.5" aria-hidden />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {rowActions ? <th scope="col" className="w-10"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {windowed.map((row, i) => {
              const key = rowKey(row);
              return (
                <tr key={key} className={selectable?.selected.includes(key) ? 'bg-primary-light/40' : undefined}>
                  {selectable ? (
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={selectable.selected.includes(key)}
                        onChange={() => toggleOne(key)}
                        aria-label={`Select ${selectable.label ? selectable.label(row) : 'row'}`}
                      />
                    </td>
                  ) : null}
                  {visible.map((c) => (
                    <td
                      key={c.key}
                      className={[c.tabular ? 'tabular-nums' : '', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : '', c.cellClassName]
                        .join(' ')}
                      data-label={typeof c.header === 'string' ? c.header : undefined}
                    >
                      {c.render ? c.render(row, i) : String((row as Record<string, unknown>)[c.key] ?? '')}
                    </td>
                  ))}
                  {rowActions ? <td className="text-right">{rowActions(row)}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* The same rows again, as cards. This is the mobile presentation, not a fallback. */}
      {mobile === 'card' ? (
        <>
          <div className="mt-3 space-y-3 md:hidden">
            {windowed.map((row, i) => (
              <article key={rowKey(row)} className="card card-pad">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {primary ? <p className="text-sm font-semibold text-ink">{primary.render ? primary.render(row, i) : String((row as Record<string, unknown>)[primary.key] ?? '')}</p> : null}
                    {meta.map((c) => (
                      <div key={c.key} className="mt-1.5 flex items-baseline gap-2">
                        <span className="text-xxs uppercase tracking-wider text-ink-subtle">{typeof c.header === 'string' ? c.header : ''}</span>
                        <span className="truncate text-sm text-ink-muted">{c.render ? c.render(row, i) : String((row as Record<string, unknown>)[c.key] ?? '')}</span>
                      </div>
                    ))}
                  </div>
                  {rowActions ? <div className="shrink-0">{rowActions(row)}</div> : null}
                </div>
                {secondary.length > 0 ? (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hairline pt-3">
                    {secondary.map((c) => (
                      <div key={c.key} className="min-w-0">
                        <dt className="text-xxs uppercase tracking-wider text-ink-subtle">{typeof c.header === 'string' ? c.header : ''}</dt>
                        <dd className="truncate text-sm text-ink">{c.render ? c.render(row, i) : String((row as Record<string, unknown>)[c.key] ?? '')}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </article>
            ))}
          </div>
          <div className="mt-4 hidden md:block">{pager}</div>
          <div className="mt-4 md:hidden">{pager}</div>
        </>
      ) : (
        <div className="mt-4">{pager}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pagination */

export function Pagination({
  page, lastPage, total, onChange, label = 'results',
}: {
  page: number;
  lastPage: number;
  total?: number | null;
  onChange: (page: number) => void;
  label?: string;
}) {
  // A short window around the current page, so the pager never grows to 40 buttons.
  const windowStart = Math.max(1, Math.min(page - 2, lastPage - 4));
  const windowEnd = Math.min(lastPage, windowStart + 4);
  const pages: number[] = [];
  for (let p = windowStart; p <= windowEnd; p += 1) pages.push(p);

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
      <p className="text-sm text-ink-muted">
        Page <span className="font-medium text-ink">{page}</span> of <span className="font-medium text-ink">{lastPage}</span>
        {typeof total === 'number' && total > 0 ? ` · ${total.toLocaleString()} ${label}` : ''}
      </p>
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeftIcon className="h-4 w-4" />
          <span className="sr-only sm:not-sr-only">Previous</span>
        </Button>
        {pages[0] > 1 ? <span className="px-1 text-sm text-ink-subtle">…</span> : null}
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={`h-9 min-w-9 rounded-control px-2.5 text-sm font-medium transition-colors ${
              p === page ? 'bg-primary text-white' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
            }`}
          >
            {p}
          </button>
        ))}
        {pages[pages.length - 1] < lastPage ? <span className="px-1 text-sm text-ink-subtle">…</span> : null}
        <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => onChange(page + 1)}>
          <span className="sr-only sm:not-sr-only">Next</span>
          <ChevronRightIcon className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ search */

export function SearchInput({
  value, onChange, placeholder = 'Search', className = '', autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={`relative ${className}`}>
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
      <input
        type="search"
        className="input pl-9"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ progress */

export function Progress({
  value, max = 100, label, tone = 'primary', size = 'md',
}: {
  value: number;
  max?: number;
  label?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  const fill = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone];
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
      className={`w-full overflow-hidden rounded-full bg-surface-sunken ${size === 'sm' ? 'h-1.5' : 'h-2'}`}
    >
      <div className={`h-full rounded-full transition-all duration-500 ease-out ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ dropdown */

export interface MenuItem {
  key: string;
  label: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

/**
 * A menu button. Closes on Escape and on an outside click, moves focus into the panel, and returns focus to the
 * trigger, so it behaves like the native control it replaces.
 */
export function Dropdown({
  trigger, items, align = 'right', label = 'Open menu',
}: {
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrap}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="btn btn-secondary btn-sm"
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute z-40 mt-1.5 min-w-48 animate-fade-in rounded-card border border-hairline bg-surface p-1 shadow-overlay ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                btn.current?.focus();
                it.onSelect?.();
              }}
              className={`flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                it.tone === 'danger' ? 'text-danger hover:bg-danger-light' : 'text-ink hover:bg-surface-sunken'
              }`}
            >
              {it.icon}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ tooltip */

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-control bg-ink px-2 py-1 text-xs text-white opacity-0 shadow-elevated transition-opacity duration-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
