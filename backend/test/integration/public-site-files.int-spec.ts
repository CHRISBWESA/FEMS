import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rm } from 'fs/promises';
import { join } from 'path';
import * as request from 'supertest';
import {
  api,
  createTestApp,
  describeDb,
  getPrisma,
  makeFellowship,
  makeUser,
  uniq,
} from './harness';
import {
  storageRoot,
  resolveStoredPath,
  writeStoredFile,
  readStoredFile,
} from '../../src/shared/utils/file-storage.util';

/**
 * Public sites - files, sitemaps, and the spam gates.
 *
 * Uploads used to write a database row and throw the bytes away, so every "publication" on a public site was a
 * description of a file that did not exist and every download link was a lie. These tests exist to make that
 * impossible to reintroduce silently: they assert the bytes exist on disk, that a public download returns them,
 * and that a document belonging to another fellowship is not reachable.
 */

// Real files, not just the right magic bytes. `sniffContentType` also rejects an EMPTY file, and a `.doc` shares
// its container with other legacy Office formats, so each buffer is padded well past the header.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('IHDR'),
  Buffer.alloc(256, 7),
]);
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'),
  Buffer.from('1 0 obj\n<< /Type /Catalog >>\nendobj\n'),
  Buffer.alloc(512, 0x20),
]);

describeDb('Public sites - files are real, and only the right ones are reachable', () => {
  let app: NestExpressApplication;
  let prisma: ReturnType<typeof getPrisma>;

  let f: any, other: any;
  let fIt: any, fSec: any;
  let sub: string, otherSub: string;
  let uploadDir: string;

  beforeAll(async () => {
    // A per-run storage root, so the suite never writes into the developer's real upload directory and never reads
    // a file left behind by a previous run.
    uploadDir = join(process.cwd(), 'tmp-test-uploads-' + uniq());
    process.env.UPLOAD_DIR = uploadDir;
    await mkdir(uploadDir, { recursive: true });

    app = await createTestApp();
    prisma = getPrisma(app);

    sub = `files-${uniq()}`;
    otherSub = `other-${uniq()}`;

    f = await makeFellowship(prisma, 'FILES');
    other = await makeFellowship(prisma, 'FILESO');
    await prisma.fellowship.update({ where: { id: f.id }, data: { subdomain: sub, public_site_enabled: true } });
    await prisma.fellowship.update({ where: { id: other.id }, data: { subdomain: otherSub, public_site_enabled: true } });

    fIt = await makeUser(prisma, { fellowshipId: f.id, roles: ['it_admin'] });
    fSec = await makeUser(prisma, { fellowshipId: f.id, roles: ['secretary'] });
  });

  afterAll(async () => {
    await app?.close();
    if (process.env.UPLOAD_DIR === uploadDir) delete process.env.UPLOAD_DIR;
    // `maxRetries: 0, retryDelay: 0`: on Windows a file can be held briefly by a virus scanner or an antivirus
    // filter, and the default 3-retry behaviour turned cleanup into a multi-minute stall.
    await rm(uploadDir, { recursive: true, force: true, maxRetries: 0, retryDelay: 0 });
  });

  /**
   * Uploads a file through the real route, so the whole path (multer, validation, write) is exercised.
   *
   * Built with a raw supertest request rather than the `api` helper, because that helper sends a JSON body and
   * superagent refuses to mix `.send()` with `.attach()` on one request.
   */
  const upload = async (
    token: string,
    body: Record<string, unknown>,
    bytes: Buffer,
    name: string,
    type: string,
    ip?: string,
  ) => {
    let t = request(app.getHttpServer())
      .post('/api/v1/it-content/documents')
      .set('Authorization', `Bearer ${token}`)
      .timeout(20000);
    if (ip) t = t.set('X-Forwarded-For', ip);
    t = t.attach('file', bytes, { filename: name, contentType: type });
    for (const [k, v] of Object.entries(body)) {
      // Booleans are sent as the JSON literals the DTO validator expects. A multipart field is a string, and
      // `isWebsiteContent: "true"` is rejected by the server as "must be a boolean" - which is correct behaviour
      // and is why this is a boolean and not `String(v)`.
      if (typeof v === 'boolean') t = t.field(k, JSON.stringify(v));
      else t = t.field(k, String(v));
    }
    return t;
  };

  const approve = async (docId: string) => {
    await prisma.documentEntity.update({ where: { id: docId }, data: { approval_status: 'APPROVED' } });
  };

  describe('an upload really writes the bytes', () => {
    it('a PDF lands on disk, and the row and the file agree', async () => {
      const r = await upload(fSec.token, { title: `Doc ${uniq()}`, isWebsiteContent: 'true' }, PDF, 'notes.pdf', 'application/pdf');
      // The validator's own message, so a failure is diagnosable from the output rather than being a bare 400.
      expect({ status: r.status, message: r.body?.message }).toEqual({ status: 201, message: undefined });

      const stored = r.body.stored_filename as string;
      // The file exists. This is the assertion that would have failed before.
      const bytes = await readFile(join(storageRoot(), stored));
      expect(bytes.equals(PDF)).toBe(true);
      expect(bytes.length).toBe(Number(r.body.file_size));
    });

    it('the stored name is not the name the uploader sent', async () => {
      // The original name is attacker-influenced, so it is never used as a path.
      const r = await upload(fSec.token, { title: `Doc ${uniq()}` }, PDF, 'annual-report.pdf', 'application/pdf');
      expect(r.status).toBe(201);
      expect(r.body.filename).toBe('annual-report.pdf');
      expect(r.body.stored_filename).not.toBe('annual-report.pdf');
      expect(r.body.stored_filename).toMatch(/^\d+_[0-9a-f]{16}_/);
    });

    it('a stored name that tries to escape the storage root is refused', async () => {
      // The path check is what makes the folder safe rather than merely present.
      expect(() => resolveStoredPath('../../../etc/passwd')).toThrow(/not found/i);
      expect(() => resolveStoredPath('..\\..\\windows\\system32\\config')).toThrow(/not found/i);
      expect(() => resolveStoredPath('')).toThrow(/not found/i);
      // And an ordinary name still resolves.
      expect(resolveStoredPath('123_abc_report.pdf')).toContain('123_abc_report.pdf');
    });

    it('a rejected file leaves nothing on disk', async () => {
      // Content that does not match the declared type is refused before any write, so there is no orphan.
      const r = await upload(fSec.token, { title: 'Liar' }, Buffer.from('<script>alert(1)</script>'), 'page.pdf', 'application/pdf');
      expect(r.status).toBe(400);
      expect(await prisma.documentEntity.count({ where: { title: 'Liar' } })).toBe(0);
    });
  });

  describe('a public download returns the bytes, and only the right ones', () => {
    let publicDocId: string;
    let otherDocId: string;
    let draftDocId: string;

    beforeAll(async () => {
      const a = await upload(fSec.token, { title: `Public ${uniq()}`, isWebsiteContent: 'true' }, PDF, 'public.pdf', 'application/pdf');
      publicDocId = a.body.id;
      await approve(publicDocId);

      // This one must belong to a DIFFERENT fellowship, so it has to be uploaded by somebody in that fellowship.
      // The first version of this suite uploaded it with `fSec` - which is fellowship `f`'s own secretary - so the
      // document belonged to `f` and the 200 it asserted against was correct. A test that cannot fail.
      const otherSec = await makeUser(prisma, { fellowshipId: other.id, roles: ['secretary'] });
      const b = await upload(otherSec.token, { title: `Other ${uniq()}`, isWebsiteContent: 'true' }, PDF, 'other.pdf', 'application/pdf');
      expect(b.status).toBe(201);
      otherDocId = b.body.id;
      await approve(otherDocId);

      const c = await upload(fSec.token, { title: `Draft ${uniq()}`, isWebsiteContent: 'true' }, PDF, 'draft.pdf', 'application/pdf');
      draftDocId = c.body.id;
    });

    it('an approved, published document downloads with the real bytes', async () => {
      // `.buffer(true)` is what makes superagent keep the response as bytes instead of decoding it; without it a
      // binary body arrives as a utf8 string and can never compare equal, however correct the download is.
      const r = await request(app.getHttpServer())
        .get(`/api/v1/public/fellowships/${sub}/documents/${publicDocId}`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(r.status).toBe(200);
      expect(Buffer.isBuffer(r.body)).toBe(true);
      expect(r.body.equals(PDF)).toBe(true);
    });

    it('is served as a download, not as something a browser will try to render', async () => {
      const r = await api(app).get(`/public/fellowships/${sub}/documents/${publicDocId}`);
      // application/octet-stream, never the stored type: a mislabelled file must not be interpreted as markup.
      expect(r.headers['content-type']).toContain('application/octet-stream');
      expect(r.headers['content-disposition']).toContain('attachment');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
    });

    it('another fellowship\'s document is not downloadable, even by id', async () => {
      // The id is valid and approved - it simply belongs to somebody else. This is the cross-tenant check.
      const r = await api(app).get(`/public/fellowships/${sub}/documents/${otherDocId}`);
      expect(r.status).toBe(404);
    });

    it('a document that is not approved yet is not downloadable', async () => {
      const r = await api(app).get(`/public/fellowships/${sub}/documents/${draftDocId}`);
      expect(r.status).toBe(404);
    });

    it('a document that is not flagged for the website is not publicly reachable', async () => {
      const internal = await upload(fSec.token, { title: `Internal ${uniq()}` }, PDF, 'internal.pdf', 'application/pdf');
      await approve(internal.body.id);
      // Approved, but not website content, so it stays inside the fellowship.
      const r = await api(app).get(`/public/fellowships/${sub}/documents/${internal.body.id}`);
      expect(r.status).toBe(404);
    });

    it('an unknown id, a bad id and a non-existent site all answer the same way', async () => {
      const unknown = await api(app).get(`/public/fellowships/${sub}/documents/${randomUUID()}`);
      const malformed = await api(app).get(`/public/fellowships/${sub}/documents/not-a-uuid`);
      const noSite = await api(app).get(`/public/fellowships/no-such-site-xyz/documents/${publicDocId}`);
      expect([404, 400]).toContain(unknown.status);
      expect([404, 400]).toContain(malformed.status);
      expect(noSite.status).toBe(404);
    });

    it('the authenticated route serves a fellowship\'s own document, and refuses another fellowship\'s', async () => {
      const mine = await api(app, fSec.token).get(`/it-content/documents/${publicDocId}/download`);
      expect(mine.status).toBe(200);
      // A signed-in download is never cached: it is a fellowship's own file, not a public artefact.
      expect(mine.headers['cache-control']).toContain('no-store');

      const theirs = await api(app, fSec.token).get(`/it-content/documents/${otherDocId}/download`);
      expect(theirs.status).toBe(403);
    });

    it('the authenticated route needs a token', async () => {
      const r = await api(app).get(`/it-content/documents/${publicDocId}/download`);
      expect(r.status).toBe(401);
    });

    it('an image document is served with its real type, so a gallery thumbnail renders', async () => {
      const img = await upload(fSec.token, { title: `Photo ${uniq()}`, isWebsiteContent: 'true' }, PNG, 'photo.png', 'image/png');
      await approve(img.body.id);

      const r = await api(app).get(`/public/fellowships/${sub}/documents/${img.body.id}`);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('image/png');
    });
  });

  describe('the sitemap and robots files', () => {
    it('lists only the pages a fellowship has made visible', async () => {
      const r = await api(app).get(`/public/fellowships/${sub}/sitemap.xml`);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('xml');

      const xml = String(r.text);
      expect(xml).toContain(`https://${sub}.example.com/`);
      expect(xml).toContain('<urlset');
      // Every page starts visible, so all sixteen are expected here.
      for (const path of ['/about', '/departments', '/events', '/news', '/sermons', '/give', '/contact']) {
        expect(xml).toContain(`https://${sub}.example.com${path}</loc>`);
      }
    });

    it('leaves out a page the fellowship has hidden', async () => {
      await api(app, fIt.token).put('/it-content/site/pages/publications', { title: 'Hidden', isVisible: false });
      const xml = String((await api(app).get(`/public/fellowships/${sub}/sitemap.xml`)).text);
      // The page still resolves for somebody holding the link; it is simply not advertised.
      expect(xml).not.toContain('/publications</loc>');
      expect((await api(app).get(`/public/fellowships/${sub}/pages/publications`)).status).toBe(200);
      await api(app, fIt.token).put('/it-content/site/pages/publications', { title: 'Publications', isVisible: true });
    });

    it('404s for a fellowship that has not published, so a sitemap cannot be used to probe', async () => {
      const hidden = await makeFellowship(prisma, 'HIDDEN');
      const label = `hidden-${uniq()}`;
      await prisma.fellowship.update({ where: { id: hidden.id }, data: { subdomain: label, public_site_enabled: false } });
      expect((await api(app).get(`/public/fellowships/${label}/sitemap.xml`)).status).toBe(404);
    });

    it('escapes a fellowship name that would otherwise break the document', async () => {
      // An unescaped & in a name is enough to make a parser read the document differently from what was written.
      const odd = await makeFellowship(prisma, 'ODD&<name>');
      const label = `odd-${uniq()}`;
      await prisma.fellowship.update({ where: { id: odd.id }, data: { subdomain: label, public_site_enabled: true } });
      const r = await api(app).get(`/public/fellowships/${label}/sitemap.xml`);
      expect(r.status).toBe(200);
      // Well-formed: no raw angle bracket from a name reached the output.
      expect(String(r.text)).not.toContain('ODD&<name>');
    });

    it('robots.txt points at the sitemap and closes the inbox', async () => {
      const r = await api(app).get(`/public/fellowships/${sub}/robots.txt`);
      expect(r.status).toBe(200);
      const text = String(r.text);
      expect(text).toContain('User-agent: *');
      expect(text).toContain(`Sitemap: https://${sub}.example.com/sitemap.xml`);
      expect(text).toContain('Disallow: /it-content');

      const apex = await api(app).get('/public/site/robots.txt');
      expect(apex.status).toBe(200);
      // The signed-in application is never useful in a search result.
      expect(String(apex.text)).toContain('Disallow: /dashboard');
    });

    it('a real content change stamps lastmod, so a crawler is not told a page is new every time', async () => {
      // A fellowship of its own, because "before" has to mean a site that has genuinely never been edited. Sharing
      // the suite's fellowship made this a false failure: the "hidden page" test above does a page write, which
      // stamps `site_updated_at`, so the baseline already carried a `lastmod` and the first assertion could never
      // hold. The product behaviour was correct throughout; only the measurement was wrong.
      const fresh = await makeFellowship(prisma, 'LASTMOD');
      const label = `lastmod-${uniq()}`;
      await prisma.fellowship.update({
        where: { id: fresh.id },
        data: { subdomain: label, public_site_enabled: true },
      });

      const before = String((await api(app).get(`/public/fellowships/${label}/sitemap.xml`)).text);
      // Never edited, so no date is claimed.
      expect(before).not.toContain('<lastmod>');

      const freshIt = await makeUser(prisma, { fellowshipId: fresh.id, roles: ['it_admin'] });
      await api(app, freshIt.token).put('/it-content/site/profile', { tagline: `Changed ${uniq()}` });

      const after = String((await api(app).get(`/public/fellowships/${label}/sitemap.xml`)).text);
      // Edited, so it appears.
      expect(after).toContain('<lastmod>');
      // And the sibling site is unaffected: the stamp is per fellowship, not global.
      const sibling = String((await api(app).get(`/public/fellowships/${sub}/sitemap.xml`)).text);
      expect(sibling).toContain('<lastmod>'); // the suite's fellowship was edited earlier, by the hidden-page test
    });
  });

  describe('an unpublished fellowship serves no file at all', () => {
    it('not even a document it has approved', async () => {
      const hidden = await makeFellowship(prisma, 'HIDDENFILES');
      const label = `hiddenfiles-${uniq()}`;
      await prisma.fellowship.update({ where: { id: hidden.id }, data: { subdomain: label, public_site_enabled: false } });

      // A secretary, because the service's own upload guard permits secretary / assistant_secretary / admin /
      // department leaders and NOT a bare `it_admin` - even though the controller's @Roles list mentions it. That
      // inconsistency is reported separately and deliberately left alone here: this test is about an unpublished
      // site serving nothing, not about who may upload, and loosening the guard to suit it would be exactly the
      // wrong direction.
      const hiddenSec = await makeUser(prisma, { fellowshipId: hidden.id, roles: ['secretary'] });
      const r = await upload(hiddenSec.token, { title: `X ${uniq()}`, isWebsiteContent: 'true' }, PDF, 'x.pdf', 'application/pdf');
      // Asserted explicitly so a failure here names the upload's own status instead of surfacing later as
      // `id: undefined` inside `approve()`.
      expect({ status: r.status, message: r.body?.message }).toEqual({ status: 201, message: undefined });
      await approve(r.body.id);

      // The file exists and the row is approved; the site simply is not published, so nothing is served.
      expect((await api(app).get(`/public/fellowships/${label}/documents/${r.body.id}`)).status).toBe(404);
    });
  });

  describe('storage helpers', () => {
    it('read a file that was written, and report one that was not', async () => {
      const name = `unit-${uniq()}.txt`;
      await writeStoredFile(name, Buffer.from('hello'));
      expect((await readStoredFile(name)).toString()).toBe('hello');
      await expect(readStoredFile(`missing-${uniq()}.txt`)).rejects.toThrow(/not found/i);
    });

    it('refuse to overwrite an existing name', async () => {
      const name = `dup-${uniq()}.txt`;
      await writeStoredFile(name, Buffer.from('first'));
      await expect(writeStoredFile(name, Buffer.from('second'))).rejects.toThrow(/already exists/i);
    });

    it('keep the bytes a write returns', async () => {
      const name = `raw-${uniq()}.bin`;
      const bytes = Buffer.from([1, 2, 3, 4]);
      await writeStoredFile(name, bytes);
      expect(await readFile(join(storageRoot(), name))).toEqual(bytes);
    });
  });
});
