import * as ExcelJS from 'exceljs';
// pdfkit is CommonJS (module.exports = PDFDocument); this project compiles without esModuleInterop.
import PDFDocument = require('pdfkit');

export interface ReportColumn { key: string; label: string; align?: 'left' | 'right'; money?: boolean }
export interface Report {
  key: string;
  title: string;
  subtitle?: string;
  generatedAt: Date;
  currency: string;
  summary: { label: string; value: string }[];
  columns: ReportColumn[];
  rows: Record<string, any>[];
  totals?: Record<string, string>;
  notes?: string[];
}

const cell = (v: any): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
};

/** A leading =, +, - or @ would be read as a formula by a spreadsheet; a text cell keeps it inert. */
const safeText = (v: string) => (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v);

export async function reportToXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FEMS';
  wb.created = r.generatedAt;
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  if (r.subtitle) ws.addRow([r.subtitle]);
  ws.addRow([`Generated ${r.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC · amounts in ${r.currency}`]);
  ws.addRow([]);
  for (const s of r.summary) ws.addRow([s.label, s.value]);
  if (r.summary.length) ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }; });
  for (const row of r.rows) {
    ws.addRow(r.columns.map((c) => {
      const v = row[c.key];
      if (c.money && v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v))) return Number(v);
      return safeText(cell(v));
    }));
  }
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c, i) => (r.totals![c.key] !== undefined ? Number(r.totals![c.key]) : i === 0 ? 'Total' : '')));
    t.font = { bold: true };
  }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(45, Math.max(12, c.label.length + 4));
    if (c.money) col.numFmt = '#,##0.00';
  });
  for (const n of r.notes ?? []) { ws.addRow([]); ws.addRow([n]); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function render(build: (doc: PDFKit.PDFDocument) => void, opts: PDFKit.PDFDocumentOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, ...opts });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try { build(doc); } catch (e) { reject(e); return; }
    doc.end();
  });
}

const fmt = (v: any, money?: boolean) => {
  if (money && v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v))) {
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return cell(v);
};

export function reportToPdf(r: Report): Promise<Buffer> {
  const landscape = r.columns.length > 6;
  return render((doc) => {
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.fontSize(16).font('Helvetica-Bold').text(r.title);
    if (r.subtitle) doc.fontSize(10).font('Helvetica').fillColor('#444').text(r.subtitle);
    doc.fontSize(8).fillColor('#666').text(`Generated ${r.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC · amounts in ${r.currency}`);
    doc.moveDown(0.8).fillColor('#000');
    if (r.summary.length) {
      doc.fontSize(9);
      for (const s of r.summary) {
        const y = doc.y;
        doc.font('Helvetica').text(s.label, doc.page.margins.left, y, { width: width * 0.55 });
        doc.font('Helvetica-Bold').text(s.value, doc.page.margins.left + width * 0.55, y, { width: width * 0.45, align: 'right' });
      }
      doc.moveDown(0.8);
    }
    const colW = width / Math.max(1, r.columns.length);
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(doc.page.margins.left, y - 2, width, 14).fill('#E5E7EB').fillColor('#000');
      doc.font('Helvetica-Bold').fontSize(8);
      r.columns.forEach((c, i) => doc.text(c.label, doc.page.margins.left + i * colW + 2, y, { width: colW - 4, align: c.money || c.align === 'right' ? 'right' : 'left', lineBreak: false, ellipsis: true }));
      doc.y = y + 14;
    };
    drawHeader();
    doc.font('Helvetica').fontSize(8);
    const bottom = doc.page.height - doc.page.margins.bottom - 20;
    const drawRow = (values: string[], bold = false) => {
      const h = Math.max(...values.map((v) => doc.heightOfString(v || ' ', { width: colW - 4 })), 10) + 3;
      if (doc.y + h > bottom) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(8); }
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      values.forEach((v, i) => doc.text(v, doc.page.margins.left + i * colW + 2, y, { width: colW - 4, align: r.columns[i].money || r.columns[i].align === 'right' ? 'right' : 'left' }));
      doc.y = y + h;
      doc.moveTo(doc.page.margins.left, doc.y - 1).lineTo(doc.page.margins.left + width, doc.y - 1).strokeColor('#EEEEEE').stroke();
    };
    if (!r.rows.length) doc.text('No records match the selected filters.', { width });
    for (const row of r.rows) drawRow(r.columns.map((c) => fmt(row[c.key], c.money).slice(0, 300)));
    if (r.totals) drawRow(r.columns.map((c, i) => (r.totals![c.key] !== undefined ? fmt(r.totals![c.key], true) : i === 0 ? 'Total' : '')), true);
    for (const n of r.notes ?? []) { doc.moveDown(0.5).fontSize(8).fillColor('#555').text(n, doc.page.margins.left, doc.y, { width }); }
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).fillColor('#888').text(`FEMS · ${r.title} · page ${i + 1} of ${pages.count}`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom + 10, { width, align: 'center', lineBreak: false });
    }
  }, { layout: landscape ? 'landscape' : 'portrait' });
}

export function receiptToPdf(r: any): Promise<Buffer> {
  return render((doc) => {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    doc.font('Helvetica-Bold').fontSize(18).text(r.fellowship || 'Fellowship', { align: 'center' });
    if (r.department) doc.font('Helvetica').fontSize(11).text(r.department, { align: 'center' });
    if (r.fellowshipLocation) doc.fontSize(9).fillColor('#555').text(r.fellowshipLocation, { align: 'center' });
    doc.moveDown(0.6).fillColor('#000').font('Helvetica-Bold').fontSize(14).text(r.status === 'reversed' ? 'RECEIPT (REVERSED)' : 'OFFICIAL RECEIPT', { align: 'center' });
    doc.moveDown(0.8);
    const line = (label: string, value: string | null | undefined) => {
      if (value === null || value === undefined || value === '') return;
      const y = doc.y;
      doc.font('Helvetica').fontSize(10).fillColor('#555').text(label, left, y, { width: width * 0.35 });
      doc.font('Helvetica-Bold').fillColor('#000').text(value, left + width * 0.35, y, { width: width * 0.65 });
      doc.moveDown(0.3);
    };
    line('Receipt number', r.receiptNumber);
    line('Date', r.date ? new Date(r.date).toISOString().slice(0, 10) : null);
    line('Received from', r.contributor);
    line('Member code', r.memberCode);
    line('Amount', `${r.currency} ${fmt(r.amount, true)}`);
    line('For', r.purpose);
    line('Category', r.category);
    line('Membership fee', r.membershipFee);
    line('Payment method', r.paymentMethod ? String(r.paymentMethod).replace(/_/g, ' ') : null);
    line('Payment reference', r.paymentReference);
    line('Received into', r.account);
    if (r.allocations?.length) {
      doc.moveDown(0.4).font('Helvetica-Bold').fontSize(11).text('Allocated to');
      for (const a of r.allocations) line(`${a.number}`, `${a.project}: ${r.currency} ${fmt(a.amount, true)}`);
    }
    if (r.status === 'reversed') line('Reversed', r.reversalReason ?? 'yes');
    doc.moveDown(1.5);
    line('Recorded by', r.recordedBy);
    doc.moveDown(2).font('Helvetica').fontSize(9).fillColor('#777').text('Thank you for your contribution. This receipt was generated by FEMS.', { align: 'center' });
  }, { size: 'A5' });
}
