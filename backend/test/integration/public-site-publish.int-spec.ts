import { NestExpressApplication } from '@nestjs/platform-express';
import * as request from 'supertest';
import { api, createTestApp, describeDb, getPrisma, makeFellowship, makeUser, uniq } from './harness';
import { PublicSiteManageService } from '../../src/public-site/public-site-manage.service';

/**
 * Public sites - publishing, visibility and the public forms.
 *
 * The rules under test are the ones a stranger relies on. A site that has not been published must not exist. A
 * draft must not be readable. A message must be stored exactly once, with a fixed reply, and a flood must be
 * refused. The 404 is deliberately identical in every "not available" case, because a distinguishable error is how a
 * public endpoint becomes an enumeration tool.
 */
describeDb('Public sites - publishing, visibility and the three public forms', () => {
  let app: NestExpressApplication;
  let prisma: ReturnType<typeof getPrisma>;

  let f: any, draft: any, suspended: any;
  let fIt: any, fSec: any, platformAdmin: any;
  let sub: string, draftSub: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    // A platform administrator, who is global and can therefore act on any fellowship. Needed for the two
    // "cannot publish" cases, which a content manager cannot even reach: their own site is the only one they
    // can act on, and it already has a subdomain.
    platformAdmin = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });

    sub = `pub-${uniq()}`;
    draftSub = `draft-${uniq()}`;

    f = await makeFellowship(prisma, 'PUB');
    await prisma.fellowship.update({ where: { id: f.id }, data: { subdomain: sub, public_site_enabled: true } });

    // Never published: the site has an address but the switch is off.
    draft = await makeFellowship(prisma, 'PUBDRAFT');
    await prisma.fellowship.update({ where: { id: draft.id }, data: { subdomain: draftSub, public_site_enabled: false } });

    // Published but suspended by the platform.
    suspended = await makeFellowship(prisma, 'PUBSUSP');
    const suspSub = `susp-${uniq()}`;
    await prisma.fellowship.update({
      where: { id: suspended.id },
      data: { subdomain: suspSub, public_site_enabled: true, status: 'suspended', suspended_at: new Date() },
    });

    fIt = await makeUser(prisma, { fellowshipId: f.id, roles: ['it_admin'] });
    fSec = await makeUser(prisma, { fellowshipId: f.id, roles: ['secretary'] });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('a site only exists once its fellowship has published it', () => {
    it('an unpublished fellowship 404s on every route, not just the home page', async () => {
      for (const path of ['', '/departments', '/news', '/sermons', '/giving', '/pages/about']) {
        const r = await api(app).get(`/public/fellowships/${draftSub}${path}`);
        expect(r.status).toBe(404);
      }
    });

    it('a suspended fellowship 404s as well', async () => {
      const r = await api(app).get('/public/fellowships/' + (await subdomainOf(suspended.id)));
      expect(r.status).toBe(404);
    });

    it('an unknown subdomain gives exactly the same answer, so the three cases cannot be told apart', async () => {
      // If these three differed, this endpoint would tell a stranger which congregations exist and which have
      // chosen to go public. They must be byte-identical.
      const unknown = await api(app).get('/public/fellowships/definitely-not-a-real-subdomain-xyz');
      const unpublished = await api(app).get(`/public/fellowships/${draftSub}`);
      const suspendedSite = await api(app).get('/public/fellowships/' + (await subdomainOf(suspended.id)));

      expect(unknown.status).toBe(404);
      expect(unpublished.status).toBe(404);
      expect(suspendedSite.status).toBe(404);
      expect(unpublished.body.message).toBe(unknown.body.message);
      expect(suspendedSite.body.message).toBe(unknown.body.message);
    });

    it('a subdomain written in full host form, with a port, resolves to the same site', async () => {
      // In production the subdomain arrives in the Host header; in development it is a path segment. Both must work,
      // or the site would break the moment a DNS record was pointed at it.
      for (const variant of [sub, `${sub}.example.com`, `${sub}.example.com:5173`, sub.toUpperCase()]) {
        const r = await api(app).get(`/public/fellowships/${variant}`);
        expect([200]).toContain(r.status);
        expect(r.body.fellowship.subdomain).toBe(sub);
      }
    });

    it('a nonsense subdomain is refused rather than folded into something real', async () => {
      for (const junk of ['---', '...', 'localhost', '127.0.0.1']) {
        const r = await api(app).get(`/public/fellowships/${encodeURIComponent(junk)}`);
        expect(r.status).toBe(404);
      }
    });
  });

  describe('publication is an explicit act', () => {
    it('a platform administrator cannot reach a fellowship\'s public-site editor at all', async () => {
      // The platform runs tenants, accounts and backups. A fellowship's landing page is that fellowship's business,
      // so `PlatformBoundaryGuard` keeps a platform account out of this controller entirely - and that is the right
      // answer, which means the two refusals below cannot be reached from a platform account. They are asserted
      // against the service instead, where the rule actually lives.
      for (const path of ['/it-content/site', '/it-content/site/enquiries']) {
        expect((await api(app, platformAdmin.token).get(path)).status).toBe(403);
      }
      expect((await api(app, platformAdmin.token).post('/it-content/site/publish', { enabled: true })).status).toBe(403);

      // And a platform administrator therefore cannot publish, or unpublish, any tenant's site.
      const susp = await prisma.fellowship.findUnique({ where: { id: suspended.id } });
      expect(susp?.public_site_enabled).toBe(true);
    });

    it('publishing is refused when there is no subdomain, or the fellowship is suspended', async () => {
      // Driven through the service rather than over HTTP, because the guard above is the only route in and a
      // platform account cannot use it. A new IT manager is minted per case so each has their own target.
      const service = app.get(PublicSiteManageService);

      const noSub = await makeFellowship(prisma, 'PUBNOSUB');
      const noSubIt = await makeUser(prisma, { fellowshipId: noSub.id, roles: ['it_admin'] });
      await expect(service.setPublished({ userId: noSubIt.id, roles: ['it_admin'], fellowshipId: noSub.id }, { enabled: true }))
        .rejects.toThrow(/subdomain/i);
      const afterNoSub = await prisma.fellowship.findUnique({ where: { id: noSub.id } });
      expect(afterNoSub?.public_site_enabled).toBe(false);

      const suspIt = await makeUser(prisma, { fellowshipId: suspended.id, roles: ['it_admin'] });
      await expect(service.setPublished({ userId: suspIt.id, roles: ['it_admin'], fellowshipId: suspended.id }, { enabled: true }))
        .rejects.toThrow(/suspended/i);
      const afterSusp = await prisma.fellowship.findUnique({ where: { id: suspended.id } });
      expect(afterSusp?.public_site_enabled).toBe(true);
    });

    it('taking a site offline makes every one of its pages 404 again', async () => {
      await api(app, fIt.token).post('/it-content/site/publish', { enabled: false });
      for (const path of ['', '/departments', '/news', '/sermons']) {
        const r = await api(app).get(`/public/fellowships/${sub}${path}`);
        expect(r.status).toBe(404);
      }
      // Back on.
      await api(app, fIt.token).post('/it-content/site/publish', { enabled: true });
      expect((await api(app).get(`/public/fellowships/${sub}`)).status).toBe(200);
    });

    it('an unpublished post stays invisible, and publishing it is what makes it appear', async () => {
      const marker = `PUB${uniq().toUpperCase()}`;
      const created = await api(app, fIt.token).post('/it-content/site/posts', { kind: 'sermon', title: marker });
      expect(created.status).toBe(201);

      // Created, but not published, so it must not be in the public list.
      const before = await api(app).get(`/public/fellowships/${sub}/sermons`);
      expect(JSON.stringify(before.body)).not.toContain(marker);

      await api(app, fIt.token).put(`/it-content/site/posts/${created.body.id}`, { isPublished: true });

      const after = await api(app).get(`/public/fellowships/${sub}/sermons`);
      expect(JSON.stringify(after.body)).toContain(marker);

      // And unpublishing takes it away again.
      await api(app, fIt.token).put(`/it-content/site/posts/${created.body.id}`, { isPublished: false });
      const gone = await api(app).get(`/public/fellowships/${sub}/sermons`);
      expect(JSON.stringify(gone.body)).not.toContain(marker);
    });

    it('a DRAFT announcement is never served, and an APPROVED one is', async () => {
      const draftMarker = `DRAFT${uniq().toUpperCase()}`;
      const okMarker = `OK${uniq().toUpperCase()}`;

      await prisma.announcement.create({ data: { title: draftMarker, content: draftMarker, fellowship_id: f.id, status: 'DRAFT', created_by: fIt.id } });
      await prisma.announcement.create({ data: { title: okMarker, content: okMarker, fellowship_id: f.id, status: 'APPROVED', created_by: fIt.id } });

      const r = await api(app).get(`/public/fellowships/${sub}/news`);
      const body = JSON.stringify(r.body);
      expect(body).toContain(okMarker);
      expect(body).not.toContain(draftMarker);
    });

    it('removing a published item unpublishes it rather than breaking the link', async () => {
      const marker = `DEL${uniq().toUpperCase()}`;
      const created = await api(app, fIt.token).post('/it-content/site/posts', { kind: 'project', title: marker, isPublished: true });
      expect(JSON.stringify((await api(app).get(`/public/fellowships/${sub}/projects`)).body)).toContain(marker);

      await api(app, fIt.token).delete(`/it-content/site/posts/${created.body.id}`);

      // Gone from the public list...
      expect(JSON.stringify((await api(app).get(`/public/fellowships/${sub}/projects`)).body)).not.toContain(marker);
      // ...but the row survives as a draft, so a mistake is recoverable.
      const row = await prisma.publicPost.findUnique({ where: { id: created.body.id } });
      expect(row).not.toBeNull();
      expect(row?.is_published).toBe(false);
    });
  });

  describe('the three public forms', () => {
    const marker = () => `MSG${uniq().toUpperCase()}`;

    // Each form test gets its own client address, so the throttle budget of one test cannot be spent by the last.
    let nextIp = 0;
    const asVisitor = () => api(app, undefined, `203.0.113.${(nextIp += 1) % 250 + 1}`);

    it('a prayer request needs only a name and a message, and is stored as private', async () => {
      const m = marker();
      const r = await asVisitor().post(`/public/fellowships/${sub}/prayer-requests`, { name: 'Visitor', message: m });
      expect(r.status).toBe(201);
      expect(r.body.message).toContain('prayer request');

      // The reply is a fixed acknowledgement: no id, no timestamps, nothing that confirms how it was stored.
      expect(Object.keys(r.body)).toEqual(['message']);

      const row = await prisma.publicEnquiry.findFirst({ where: { message: m } });
      expect(row?.kind).toBe('prayer_request');
      // There is no `is_private` column, and no way to publish one: privacy comes from there being no public route
      // that can reach a prayer request, not from a flag the visitor could have set to false.
      const cols = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'public_enquiries' AND column_name = 'is_private'`;
      expect(cols).toHaveLength(0);
    });

    it('a prayer request is not reachable from any public route', async () => {
      // The real reason a prayer request is private, asserted directly: nothing under /public can return one,
      // because none of those routes read the enquiries table at all.
      const m = `UNREACHABLE${uniq().toUpperCase()}`;
      await asVisitor().post(`/public/fellowships/${sub}/prayer-requests`, { name: 'Visitor', message: m });

      for (const path of ['', '/news', '/events', '/sermons', '/testimonies', '/projects', '/pages/about']) {
        const r = await api(app).get(`/public/fellowships/${sub}${path}`);
        expect(JSON.stringify(r.body)).not.toContain(m);
      }
    });

    it('a submission with the hidden field filled in is dropped silently', async () => {
      // The honeypot. A bot fills in every input it finds; a person never sees this one. It must be dropped with
      // the SAME acknowledgement as a real submission, or the response tells the bot it was caught.
      const m = `HONEYPOT${uniq().toUpperCase()}`;
      const r = await asVisitor().post(`/public/fellowships/${sub}/prayer-requests`, {
        name: 'Bot',
        message: m,
        company_website: 'http://spam.example',
      });

      expect(r.status).toBe(201);
      // Identical to a genuine submission.
      const clean = await asVisitor().post(`/public/fellowships/${sub}/prayer-requests`, { name: 'Visitor', message: 'real' });
      expect(r.body).toEqual(clean.body);

      // ...and nothing was stored.
      expect(await prisma.publicEnquiry.count({ where: { message: m } })).toBe(0);
    });

    it('the per-fellowship cap stops a flood that rotates source addresses', async () => {
      // The per-IP route limit is invisible to a botnet. This cap counts everything aimed at one fellowship over
      // an hour, so it holds however many addresses are used. Set low here so the test does not need 30 requests.
      const cap = process.env.PUBLIC_ENQUIRY_CAP;
      process.env.PUBLIC_ENQUIRY_CAP = '5';
      try {
        // A different address per request, so nothing here is stopped by the per-IP limit instead.
        let refused = 0;
        let accepted = 0;
        for (let i = 0; i < 12; i += 1) {
          const r = await api(app, undefined, `192.0.2.${i + 1}`).post(`/public/fellowships/${sub}/prayer-requests`, {
            name: 'Rotator',
            message: marker(),
          });
          if (r.status === 201) accepted += 1;
          else if (r.status === 429) refused += 1;
        }
        expect(accepted).toBeGreaterThan(0);
        expect(refused).toBeGreaterThan(0);
        expect(accepted).toBeLessThanOrEqual(5);
      } finally {
        if (cap === undefined) delete process.env.PUBLIC_ENQUIRY_CAP;
        else process.env.PUBLIC_ENQUIRY_CAP = cap;
      }
    });

    it('a contact message and an intention to give are stored against the right fellowship', async () => {
      const c = marker();
      const g = marker();
      await asVisitor().post(`/public/fellowships/${sub}/contact`, { name: 'Visitor', message: c });
      await asVisitor().post(`/public/fellowships/${sub}/donations`, { name: 'Visitor', message: g, amount: 250, currency: 'KES' });

      const contact = await prisma.publicEnquiry.findFirst({ where: { message: c } });
      expect(contact?.kind).toBe('contact_message');
      expect(contact?.fellowship_id).toBe(f.id);

      const giving = await prisma.publicEnquiry.findFirst({ where: { message: g } });
      expect(giving?.kind).toBe('donation_pledge');
      expect(Number(giving?.amount)).toBe(250);
      expect(giving?.currency).toBe('KES');
      // Stored, never processed: there is no gateway, so nothing may claim a payment happened.
      expect(giving?.is_handled).toBe(false);
    });

    it('the same message sent twice is stored twice, because a visitor may genuinely resend', async () => {
      const m = marker();
      await asVisitor().post(`/public/fellowships/${sub}/prayer-requests`, { name: 'V', message: m });
      await asVisitor().post(`/public/fellowships/${sub}/prayer-requests`, { name: 'V', message: m });
      const rows = await prisma.publicEnquiry.count({ where: { message: m } });
      expect(rows).toBe(2);
    });

    it('a message missing its name, message or e-mail format is refused', async () => {
      const cases: Record<string, unknown>[] = [
        { message: 'no name' },
        { name: 'no message' },
        { name: 'V', message: 'bad email', email: 'not-an-email' },
        { name: 'V', message: 'x'.repeat(4001) },
        { name: 'x'.repeat(121), message: 'name too long' },
        {},
      ];
      for (const body of cases) {
        const r = await asVisitor().post(`/public/fellowships/${sub}/prayer-requests`, body);
        expect([400]).toContain(r.status);
      }
    });

    it('a non-object body is refused rather than coerced', async () => {
      // Sent as raw strings so supertest does not JSON-encode them: a body of `"a string"` arrives at the server
      // as a JSON string, which is exactly the shape being tested.
      const raw = ['', 'a string', '42', 'true', '[]'];
      for (const body of raw) {
        const r = await request(app.getHttpServer())
          .post(`/api/v1/public/fellowships/${sub}/contact`)
          .set('Content-Type', 'application/json')
          .send(body);
        expect([400]).toContain(r.status);
      }
    });

    it('a giving amount must be a real number, and a bad one is refused', async () => {
      for (const amount of ['abc', -5, 0, '1.234', 1e12]) {
        const r = await asVisitor().post(`/public/fellowships/${sub}/donations`, { name: 'V', message: 'give', amount });
        expect([400]).toContain(r.status);
      }
    });

    it('a form submission to a fellowship that never published is refused', async () => {
      const r = await asVisitor().post(`/public/fellowships/${draftSub}/prayer-requests`, { name: 'V', message: 'hi' });
      expect(r.status).toBe(404);
    });

    it('a flood of submissions is refused, so the inbox cannot be filled from one address', async () => {
      // The write routes carry a 5-per-minute budget, well below the global limit, precisely because these are the
      // only unauthenticated writes on a fellowship's site. One dedicated address, so this measures the budget
      // rather than what earlier tests left behind.
      const flooder = api(app, undefined, '198.51.100.7');
      let accepted = 0;
      let refused = 0;
      for (let i = 0; i < 12; i += 1) {
        const r = await flooder.post(`/public/fellowships/${sub}/prayer-requests`, { name: 'Flooder', message: marker() });
        if (r.status === 201) accepted += 1;
        else if (r.status === 429) refused += 1;
      }
      // The budget is enforced, and it is a real budget rather than a blanket denial.
      expect(accepted).toBeGreaterThan(0);
      expect(refused).toBeGreaterThan(0);
      expect(accepted).toBeLessThanOrEqual(5);

      // And another address is unaffected by the flooder's exhaustion, or one abuser would lock out the site.
      const other = await api(app, undefined, '198.51.100.8').post(`/public/fellowships/${sub}/prayer-requests`, { name: 'Visitor', message: marker() });
      expect(other.status).toBe(201);
    });
  });

  describe('the content manager screen', () => {
    const marker = () => `MSG${uniq().toUpperCase()}`;

    it('lists only its own fellowship, with every page from the catalogue', async () => {
      const r = await api(app, fIt.token).get('/it-content/site');
      expect(r.status).toBe(200);
      // Sixteen pages, whether or not a row exists, so the editor shows a page that has not been written yet.
      expect(r.body.pages).toHaveLength(16);
      expect(r.body.fellowship.id).toBe(f.id);
      expect(r.body.fellowship.host).toBeTruthy();
    });

    it('counts outstanding messages and lets one be marked handled', async () => {
      const m = marker();
      await api(app, undefined, '203.0.113.90').post(`/public/fellowships/${sub}/contact`, { name: 'Visitor', message: m });

      const before = await api(app, fIt.token).get('/it-content/site');
      expect(before.body.enquiries.outstanding).toBeGreaterThan(0);

      const listed = await api(app, fIt.token).get(`/it-content/site/enquiries?kind=contact_message`);
      const row = listed.body.data.find((e: any) => e.message === m);
      expect(row).toBeDefined();
      expect(row.is_handled).toBe(false);

      await api(app, fIt.token).post(`/it-content/site/enquiries/${row.id}/handled`);

      const after = await api(app, fIt.token).get('/it-content/site/enquiries?kind=contact_message');
      const same = after.body.data.find((e: any) => e.message === m);
      expect(same.is_handled).toBe(true);
      expect(same.handled_at).toBeTruthy();
    });

    it('rejects an unknown page key, an unknown post kind and an unknown enquiry kind', async () => {
      expect((await api(app, fIt.token).put('/it-content/site/pages/not-a-page', { title: 'x' })).status).toBe(404);
      expect((await api(app, fIt.token).post('/it-content/site/posts', { kind: 'not-a-kind', title: 'x' })).status).toBe(400);
      expect((await api(app, fIt.token).get('/it-content/site/enquiries?kind=nope')).status).toBe(400);
    });

    it('rejects a link that is not an absolute http(s) address, so a page cannot carry javascript:', async () => {
      for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'not a url', '/relative']) {
        const r = await api(app, fIt.token).put('/it-content/site/profile', { facebook_url: bad });
        expect([400]).toContain(r.status);
      }
      const ok = await api(app, fIt.token).put('/it-content/site/profile', { facebook_url: 'https://facebook.com/example' });
      // 201 on the first write (the row is created), 200 afterwards (it is updated). Both are success.
      expect([200, 201]).toContain(ok.status);
      const stored = await prisma.publicProfile.findUnique({ where: { fellowship_id: f.id } });
      expect(stored?.facebook_url).toBe('https://facebook.com/example');
    });

    it('rejects an e-mail that is not an address, on the profile', async () => {
      const r = await api(app, fIt.token).put('/it-content/site/profile', { email: 'nope' });
      expect(r.status).toBe(400);
    });

    it('is reachable by the content manager and the Secretary, but not by an ordinary member or a treasurer', async () => {
      expect((await api(app, fSec.token).get('/it-content/site')).status).toBe(200);

      const member = await makeUser(prisma, { fellowshipId: f.id, roles: ['ordinary_member'] });
      expect((await api(app, member.token).get('/it-content/site')).status).toBe(403);

      const treasurer = await makeUser(prisma, { fellowshipId: f.id, roles: ['treasurer'] });
      expect((await api(app, treasurer.token).get('/it-content/site')).status).toBe(403);
    });

    it('requires authentication at all', async () => {
      expect((await api(app).get('/it-content/site')).status).toBe(401);
    });
  });

  async function subdomainOf(fellowshipId: string): Promise<string> {
    const row = await prisma.fellowship.findUnique({ where: { id: fellowshipId }, select: { subdomain: true } });
    return row?.subdomain as string;
  }
});
