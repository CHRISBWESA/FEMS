import { BadRequestException } from '@nestjs/common';
import { DEV_JWT_FALLBACK, assertProductionConfig, parseTrustProxy, resolveJwtSecret } from '../config/security-config';
import { assertPasswordPolicy } from './utils/password-policy.util';
import { assertContentMatchesDeclaredType, sanitizeFilename, sniffContentType } from './utils/file-validation.util';
import { redactAuditPayload } from './audit/redact';
import { containsNul } from './middleware/reject-nul-bytes.middleware';
import { normalizeRequestId } from './middleware/request-context.middleware';

describe('production configuration', () => {
  const prod = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://runtime:secret@db.example.org:5432/fems',
    FRONTEND_URL: 'https://app.example.org',
    JWT_SECRET: 'A9bC2dE4fG6hI8jK0mN3pQ5rS7tU9vW1xY3zA5',
  };

  it('refuses weak or placeholder production secrets', () => {
    for (const bad of [undefined, '', DEV_JWT_FALLBACK, 'short', 'x'.repeat(40), 'change-this-to-a-random-secret-value-123456', 'replace-me-with-a-random-secret-123456']) {
      expect(() => resolveJwtSecret({ ...prod, JWT_SECRET: bad })).toThrow(/JWT_SECRET/);
    }
    expect(resolveJwtSecret(prod)).toBe(prod.JWT_SECRET);
  });

  it('keeps the development fallback outside production only', () => {
    expect(resolveJwtSecret({ NODE_ENV: 'development' })).toBe(DEV_JWT_FALLBACK);
    expect(resolveJwtSecret({ NODE_ENV: 'test', JWT_SECRET: 'abc' })).toBe('abc');
  });

  it('requires a PostgreSQL database and an exact public HTTPS origin', () => {
    expect(() => assertProductionConfig({ ...prod, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => assertProductionConfig({ ...prod, DATABASE_URL: 'https://db.example.org/fems' })).toThrow(/DATABASE_URL/);
    expect(() => assertProductionConfig({ ...prod, FRONTEND_URL: undefined })).toThrow(/FRONTEND_URL/);
    for (const origin of ['http://localhost:5173', 'http://app.example.org', 'https://localhost:5173', 'https://app.example.org/', 'https://app.example.org/app', 'https://user:pass@app.example.org', 'https://app.example.org?x=1']) {
      expect(() => assertProductionConfig({ ...prod, FRONTEND_URL: origin })).toThrow(/FRONTEND_URL/);
    }
    const warnings = assertProductionConfig(prod);
    expect(warnings.join(' ')).toMatch(/TRUST_PROXY/);
    expect(warnings.join(' ')).toMatch(/BILLING_WEBHOOK_SECRET/);
    expect(assertProductionConfig({ NODE_ENV: 'development' })).toEqual([]);
  });

  it('validates production ports, limits, booleans, and optional webhook secrets', () => {
    for (const patch of [{ PORT: '0' }, { PORT: '65536' }, { RATE_LIMIT_MAX: '1.5' }, { AUTH_RATE_LIMIT_WINDOW_MS: '-1' }, { UPLOAD_MAX_SIZE: '0' }, { DATABASE_FORCE_UTC_SESSION: 'sometimes' }]) {
      expect(() => assertProductionConfig({ ...prod, ...patch })).toThrow();
    }
    expect(() => assertProductionConfig({ ...prod, BILLING_WEBHOOK_SECRET: 'short' })).toThrow(/BILLING_WEBHOOK_SECRET/);
    expect(assertProductionConfig({ ...prod, PORT: '8080', RATE_LIMIT_MAX: '300', DATABASE_FORCE_UTC_SESSION: 'false' })).toHaveLength(2);
  });

  it('parses TRUST_PROXY', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined();
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('10.0.0.0/8, 172.16.0.0/12')).toEqual(['10.0.0.0/8', '172.16.0.0/12']);
  });
});

describe('request correlation', () => {
  it('accepts bounded safe ids and replaces unsafe input', () => {
    expect(normalizeRequestId('edge-123_ABC.4')).toBe('edge-123_ABC.4');
    for (const value of ['', 'x'.repeat(129), 'bad value', 'bad\nvalue', '<script>', null, 123]) {
      expect(normalizeRequestId(value)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('password policy', () => {
  const who = { email: 'grace.hopper@example.org', firstName: 'Grace', lastName: 'Hopper' };
  it('accepts a long, unpredictable password', () => {
    expect(assertPasswordPolicy('Correct-Horse-Battery-9', who)).toBe('Correct-Horse-Battery-9');
    expect(assertPasswordPolicy('a passphrase with spaces 2026')).toContain('passphrase');
  });
  it.each([
    ['too short', 'Abc123!x'], ['common', 'password123'], ['common, other case', 'Password1234'], ['repetitive', 'aaaaaaaaaaaa'], ['contains the name', 'my-hopper-2026-x'], ['contains the e-mail name', 'xx-grace.hopper-xx'],
    ['not a string', 12345678901 as any], ['undefined', undefined as any], ['too long', 'x1'.repeat(70)],
  ])('rejects %s', (_label, pw) => {
    expect(() => assertPasswordPolicy(pw, who)).toThrow(BadRequestException);
  });
});

describe('upload validation', () => {
  const pdf = Buffer.from('%PDF-1.7\n...');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const gif = Buffer.from('GIF89a\x01\x00');
  const doc = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(8)]);

  it('recognises the allowed kinds by content', () => {
    expect(sniffContentType(pdf)).toBe('application/pdf');
    expect(sniffContentType(png)).toBe('image/png');
    expect(sniffContentType(jpg)).toBe('image/jpeg');
    expect(sniffContentType(gif)).toBe('image/gif');
    expect(sniffContentType(doc)).toBe('application/msword');
    expect(sniffContentType(Buffer.from('Just some notes, café.'))).toBe('text/plain');
    expect(sniffContentType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]))).toBeNull(); // Windows executable
    expect(sniffContentType(Buffer.from([0x50, 0x4b, 3, 4, 0, 0]))).toBeNull(); // zip / docx / jar
    expect(sniffContentType(Buffer.alloc(0))).toBeNull();
  });

  it('requires the declared type to match the content', () => {
    expect(() => assertContentMatchesDeclaredType('application/pdf', pdf)).not.toThrow();
    expect(() => assertContentMatchesDeclaredType('image/png', pdf)).toThrow(/does not match/);
    expect(() => assertContentMatchesDeclaredType('application/pdf', Buffer.from('MZ....'))).toThrow(BadRequestException);
    expect(() => assertContentMatchesDeclaredType('application/x-msdownload', pdf)).toThrow(/not allowed/);
    expect(() => assertContentMatchesDeclaredType('text/plain', Buffer.from('<html><script>x</script>'))).toThrow(BadRequestException);
    expect(() => assertContentMatchesDeclaredType('application/pdf', Buffer.alloc(0))).toThrow(/empty/);
  });

  it('reduces file names to a harmless form and refuses dangerous ones', () => {
    expect(sanitizeFilename('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(sanitizeFilename('C:\\Users\\me\\Budget 2026.pdf')).toBe('Budget 2026.pdf');
    expect(sanitizeFilename('bad\u0000name\r\n.png')).toBe('badname.png');
    expect(sanitizeFilename('weird<>|?*name.txt')).toBe('weird_____name.txt');
    expect(sanitizeFilename('a'.repeat(300) + '.pdf').length).toBeLessThanOrEqual(120);
    for (const bad of ['run.exe', 'x.pdf.exe', 'page.html', 'shell.php.pdf', 'logo.svg', 'a.js', '...', '', '   ', '////']) {
      expect(() => sanitizeFilename(bad)).toThrow(BadRequestException);
    }
  });
});


describe('audit payload redaction', () => {
  it('never lets secrets reach the audit trail, at any depth', () => {
    const out: any = redactAuditPayload({
      email: 'a@b.c',
      password: 'hunter2',
      new_password: 'x',
      password_hash: '$2a$12$abc',
      nested: { refreshToken: 'r', accessToken: 'a', apiKey: 'k', authorization: 'Bearer z', card_number: '4111', keep: 'this' },
      list: [{ webhookSecret: 's', signature: 'sig', ok: 1 }],
    });
    expect(out.email).toBe('a@b.c');
    expect(out.password).toBe('[redacted]');
    expect(out.new_password).toBe('[redacted]');
    expect(out.password_hash).toBe('[redacted]');
    expect(out.nested).toMatchObject({ refreshToken: '[redacted]', accessToken: '[redacted]', apiKey: '[redacted]', authorization: '[redacted]', card_number: '[redacted]', keep: 'this' });
    expect(out.list[0]).toMatchObject({ webhookSecret: '[redacted]', signature: '[redacted]', ok: 1 });
    expect(JSON.stringify(out)).not.toMatch(/hunter2|Bearer z|4111/);
  });

  it('keeps harmless bookkeeping fields and ordinary data, and bounds the size', () => {
    const out: any = redactAuditPayload({ must_change_password: true, token_version: 3, password_changed_at: 'x', big: 'y'.repeat(5000), deep: { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } } });
    expect(out.must_change_password).toBe(true);
    expect(out.token_version).toBe(3);
    expect(out.password_changed_at).toBe('x');
    expect(out.big.length).toBeLessThan(2100);
    expect(JSON.stringify(out)).toContain('[nested]');
    expect(redactAuditPayload(undefined)).toBeUndefined();
    expect(redactAuditPayload(null)).toBeNull();
    const d = new Date();
    expect((redactAuditPayload({ d }) as any).d).toBe(d);
  });
});

describe('NUL byte detection', () => {
  it('finds U+0000 in strings, nested values and object keys, and nowhere else', () => {
    const nul = String.fromCharCode(0);
    expect(containsNul(`a${nul}b`)).toBe(true);
    expect(containsNul({ a: { b: [`x${nul}`] } })).toBe(true);
    expect(containsNul({ [`k${nul}ey`]: 1 })).toBe(true);
    expect(containsNul({ a: 'plain', b: [1, 2, { c: 'ok' }], d: null, e: undefined, f: 5, g: true })).toBe(false);
    expect(containsNul('café 😀')).toBe(false);
    expect(containsNul(undefined)).toBe(false);
  });
});
