import { BadRequestException } from '@nestjs/common';

// Upload safety helpers. The client-declared MIME type and file name are attacker-controlled, so the CONTENT is
// checked against the declared type and the name is reduced to something harmless before it is used anywhere.

export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'application/msword', 'text/plain'] as const;

const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'dll', 'bat', 'cmd', 'com', 'scr', 'msi', 'ps1', 'psm1', 'vbs', 'vbe', 'wsf', 'jar', 'sh', 'bash', 'php', 'phtml', 'asp', 'aspx',
  'jsp', 'js', 'mjs', 'cjs', 'html', 'htm', 'xhtml', 'svg', 'swf', 'lnk', 'reg', 'hta', 'apk', 'dmg', 'app', 'py', 'pl', 'rb',
]);

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);

/** Best-effort content type from magic bytes; null when it is none of the allowed kinds. */
export function sniffContentType(buf: Buffer): (typeof ALLOWED_UPLOAD_TYPES)[number] | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 8 && startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (buf.length >= 3 && startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 8 && startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'application/msword';
  // Plain text: no NUL bytes and decodable as UTF-8 in the first 8 KiB.
  const head = buf.subarray(0, 8192);
  if (head.length > 0 && !head.includes(0)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(head); return 'text/plain'; } catch { return null; }
  }
  return null;
}

export function assertContentMatchesDeclaredType(declared: string, buf: Buffer): void {
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(declared)) throw new BadRequestException('File type not allowed');
  if (!buf || buf.length === 0) throw new BadRequestException('The file is empty');
  const actual = sniffContentType(buf);
  // A .doc has the same container as other legacy Office formats; the rest must match exactly.
  if (actual !== declared) throw new BadRequestException('The file content does not match its declared type');
  if (declared === 'text/plain' && /<\s*(script|html|iframe|svg)\b/i.test(buf.subarray(0, 8192).toString('utf8'))) {
    throw new BadRequestException('The file content is not allowed');
  }
}

/** A safe display/storage name: base name only, no control characters or separators, no dangerous extension. */
export function sanitizeFilename(original: string): string {
  const base = String(original ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[^\w.\- ()]/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim().slice(0, 120);
  if (!cleaned || !/[A-Za-z0-9]/.test(cleaned)) throw new BadRequestException('The file name is not valid');
  const parts = cleaned.toLowerCase().split('.').slice(1); // every extension segment, so "report.exe.pdf" is caught too
  if (parts.some((p) => DANGEROUS_EXTENSIONS.has(p))) throw new BadRequestException('This kind of file is not allowed');
  return cleaned;
}
