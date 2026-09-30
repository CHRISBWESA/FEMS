// Client-side CSV export (the same Blob-download approach the members template uses). It only ever exports
// figures the signed-in user has already been sent by the API, so it adds no new authorization surface.

type Cell = string | number | boolean | null | undefined;

// Spreadsheet applications execute cells that start with = + - @ (or a tab/CR) as formulas ("CSV injection").
// Text is prefixed with an apostrophe so it stays text; real numbers are left alone.
function cell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'string' ? v : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvTable {
  title?: string;
  headers: string[];
  rows: Cell[][];
}

export function toCsv(tables: CsvTable[]): string {
  return tables
    .map((t) => [...(t.title ? [cell(t.title)] : []), t.headers.map(cell).join(','), ...t.rows.map((r) => r.map(cell).join(','))].join('\n'))
    .join('\n\n');
}

export function downloadCsv(filename: string, tables: CsvTable[]): void {
  const blob = new Blob([`﻿${toCsv(tables)}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
