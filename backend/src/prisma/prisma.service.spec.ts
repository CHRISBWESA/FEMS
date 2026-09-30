import { withUtcSession } from './prisma.service';

describe('withUtcSession', () => {
  const env = (o: Record<string, string> = {}) => o as NodeJS.ProcessEnv;
  const decoded = (url: string | undefined) => decodeURIComponent(url ?? '');

  it('adds a UTC session option to a URL without query parameters', () => {
    const out = withUtcSession('postgresql://u:p@db:5432/fems', env());
    expect(out).toMatch(/^postgresql:\/\/u:p@db:5432\/fems\?options=/);
    expect(decoded(out)).toContain('options=-c TimeZone=UTC');
  });

  it('keeps the existing query parameters', () => {
    const out = withUtcSession('postgresql://u:p@db:5432/fems?schema=public&sslmode=require', env());
    expect(out).toContain('schema=public');
    expect(out).toContain('sslmode=require');
    expect(decoded(out)).toContain('-c TimeZone=UTC');
    expect(out!.match(/\?/g)).toHaveLength(1);
  });

  it('merges with an options parameter that is already there', () => {
    const out = withUtcSession('postgresql://u:p@db/fems?options=-c%20search_path%3Dapp&schema=public', env());
    expect(decoded(out)).toContain('options=-c search_path=app -c TimeZone=UTC');
    expect(out).toContain('schema=public');
  });

  it('leaves alone a time zone the operator chose, and does nothing when switched off or without a URL', () => {
    const chosen = 'postgresql://u:p@db/fems?options=-c%20TimeZone%3DAfrica%2FNairobi';
    expect(withUtcSession(chosen, env())).toBe(chosen);
    const url = 'postgresql://u:p@db/fems';
    expect(withUtcSession(url, env({ DATABASE_FORCE_UTC_SESSION: 'false' }))).toBe(url);
    expect(withUtcSession(undefined, env())).toBeUndefined();
    expect(withUtcSession('', env())).toBe('');
  });

  it('is idempotent', () => {
    const once = withUtcSession('postgresql://u:p@db/fems', env());
    expect(withUtcSession(once, env())).toBe(once);
  });
});
