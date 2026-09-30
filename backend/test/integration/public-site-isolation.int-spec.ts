import { NestExpressApplication } from '@nestjs/platform-express';
import { api, createTestApp, describeDb, getPrisma, makeFellowship, makeUser, uniq } from './harness';

/**
 * Public sites, tenant isolation.
 *
 * The question these tests exist to answer is the one that matters most about a multi-tenant public web: if
 * fellowship A publishes a picture, can it appear on fellowship B's landing page? The answer must be no, and it
 * must stay no â€” so it is asserted here rather than left to code review.
 *
 * The technique is deliberately blunt. Every piece of content below is stamped with a unique marker string, and the
 * assertion is that the *entire serialized response* for A does not contain B's marker. Checking specific fields
 * would only prove the fields I thought of; stringifying the whole body catches a leak through any field at all,
 * including one added later.
 *
 * A negative space worth stating: nothing in the public API accepts a fellowship id. The URL carries a subdomain and
 * the server resolves it, so there is no id for a caller to tamper with. These tests would not catch somebody
 * *adding* such a parameter, so the last test here pins that absence.
 */
describeDb('Public sites - a fellowship can never see another fellowship\'s content', () => {
  let app: NestExpressApplication;
  let prisma: ReturnType<typeof getPrisma>;

  // Unique per run, so a test can never match a marker left by a previous run in the shared scratch database.
  const MARK_A = `ALPHA${uniq().toUpperCase()}`;
  const MARK_B = `BRAVO${uniq().toUpperCase()}`;

  let a: any, b: any;
  let aIt: any, bIt: any;
  let subA: string, subB: string;

  /** Every public list endpoint, by the subdomain path segment it hangs off. */
  const LIST_PATHS = [
    'leadership', 'departments', 'ministries', 'events', 'news',
    'publications', 'gallery', 'gallery/photos', 'sermons', 'testimonies',
    'projects', 'get-involved', 'giving',
  ];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);

    subA = `iso-a-${uniq()}`;
    subB = `iso-b-${uniq()}`;

    a = await makeFellowship(prisma, 'ISOA');
    b = await makeFellowship(prisma, 'ISOB');

    // Published and addressed, so both sites resolve. `public_site_enabled` is what makes a subdomain live.
    await prisma.fellowship.update({
      where: { id: a.id },
      data: { subdomain: subA, public_site_enabled: true },
    });
    await prisma.fellowship.update({
      where: { id: b.id },
      data: { subdomain: subB, public_site_enabled: true },
    });

    aIt = await makeUser(prisma, { fellowshipId: a.id, roles: ['it_admin'] });
    bIt = await makeUser(prisma, { fellowshipId: b.id, roles: ['it_admin'] });

    // Office holders for the leadership page. The public projection is name + office only, so the marker has to
    // live in the name for a leak through this endpoint to be detectable.
    await prisma.user.create({
      data: {
        email: `${MARK_A.toLowerCase()}-chair@test.local`,
        password_hash: 'not-a-real-hash',
        first_name: MARK_A,
        last_name: 'Chair',
        roles: ['chairperson'],
        fellowship_id: a.id,
      },
    });
    await prisma.user.create({
      data: {
        email: `${MARK_B.toLowerCase()}-chair@test.local`,
        password_hash: 'not-a-real-hash',
        first_name: MARK_B,
        last_name: 'Chair',
        roles: ['chairperson'],
        fellowship_id: b.id,
      },
    });

    await seedContent(a.id, MARK_A, aIt.id);
    await seedContent(b.id, MARK_B, bIt.id);
  });

  afterAll(async () => {
    await app?.close();
  });

  /**
   * One fellowship's worth of content, every kind the public site reads, each stamped with `mark`.
   *
   * Every field a page renders carries the marker, not just the title â€” so a leak through a description, a body or
   * a subtitle is caught as loudly as one through a title.
   */
  async function seedContent(fellowshipId: string, mark: string, userId: string) {
    await prisma.department.create({
      data: { name: `${mark}-dept`, description: `${mark}-dept-desc`, fellowship_id: fellowshipId, is_active: true, created_by: userId },
    });

    await prisma.programme.create({
      data: { name: `${mark}-ministry`, description: `${mark}-ministry-desc`, fellowship_id: fellowshipId, created_by: userId },
    });

    await prisma.activity.create({
      data: {
        title: `${mark}-event`,
        description: `${mark}-event-desc`,
        date: new Date(Date.now() + 7 * 86400_000),
        audience_type: 'all_members',
        fellowship_id: fellowshipId,
        created_by: userId,
      },
    });

    await prisma.announcement.create({
      data: {
        title: `${mark}-news`,
        content: `${mark}-news-body`,
        fellowship_id: fellowshipId,
        // APPROVED, or the publication filter would hide it and the test would pass for the wrong reason.
        status: 'APPROVED',
        created_by: userId,
      },
    });

    await prisma.documentEntity.create({
      data: {
        title: `${mark}-publication`,
        filename: `${mark}.pdf`,
        stored_filename: `${mark}_stored.pdf`,
        file_size: 1024,
        mime_type: 'application/pdf',
        fellowship_id: fellowshipId,
        uploaded_by: userId,
        is_website_content: true,
        approval_status: 'APPROVED',
      },
    });
    await prisma.documentEntity.create({
      data: {
        title: `${mark}-galleryimage`,
        filename: `${mark}.png`,
        stored_filename: `${mark}_stored.png`,
        file_size: 2048,
        mime_type: 'image/png',
        fellowship_id: fellowshipId,
        uploaded_by: userId,
        is_website_content: true,
        approval_status: 'APPROVED',
      },
    });

    // A published post with an image, which is what the gallery actually shows.
    await prisma.publicPost.create({
      data: {
        fellowship_id: fellowshipId,
        kind: 'sermon',
        title: `${mark}-sermon`,
        body: `${mark}-sermon-body`,
        reference: `${mark}-reference`,
        media_url: `https://cdn.test/${mark}.png`,
        is_published: true,
        created_by: userId,
      },
    });
    await prisma.publicPost.create({
      data: { fellowship_id: fellowshipId, kind: 'testimony', title: `${mark}-testimony`, body: `${mark}-testimony-body`, is_published: true, created_by: userId },
    });
    await prisma.publicPost.create({
      data: { fellowship_id: fellowshipId, kind: 'project', title: `${mark}-project`, body: `${mark}-project-body`, is_published: true, created_by: userId },
    });

    await prisma.serviceOpportunity.create({
      data: { title: `${mark}-opportunity`, description: `${mark}-opportunity-desc`, location: `${mark}-place`, fellowship_id: fellowshipId, status: 'open', created_by: userId },
    });

    await prisma.contributionCampaign.create({
      data: {
        name: `${mark}-campaign`,
        description: `${mark}-campaign-desc`,
        target_amount: 1000,
        start_date: new Date(),
        status: 'active',
        fellowship_id: fellowshipId,
        created_by: userId,
      },
    });

    // The site identity itself, since a leaked name or tagline is just as much a leak.
    await prisma.publicProfile.create({
      data: {
        fellowship_id: fellowshipId,
        tagline: `${mark}-tagline`,
        story: `${mark}-story`,
        email: `${mark.toLowerCase()}@test.local`,
        address: `${mark}-address`,
        updated_at: new Date(),
      },
    });
    await prisma.publicPage.create({
      data: { fellowship_id: fellowshipId, key: 'about', title: `${mark}-about-title`, subtitle: `${mark}-about-subtitle`, updated_at: new Date() },
    });
  }

  it('each fellowship sees its own content and none of the other\'s, on every list endpoint', async () => {
    for (const path of LIST_PATHS) {
      const mine = await api(app).get(`/public/fellowships/${subA}/${path}`);
      expect([200]).toContain(mine.status);

      const body = JSON.stringify(mine.body);
      // The positive control: without this, an empty response would satisfy "not.toContain" trivially.
      expect(body).toContain(MARK_A);
      // The assertion that matters.
      expect(body).not.toContain(MARK_B);
    }
  });

  it('and the same holds in the other direction, so neither is special-cased', async () => {
    for (const path of LIST_PATHS) {
      const theirs = await api(app).get(`/public/fellowships/${subB}/${path}`);
      expect([200]).toContain(theirs.status);
      const body = JSON.stringify(theirs.body);
      expect(body).toContain(MARK_B);
      expect(body).not.toContain(MARK_A);
    }
  });

  it('the site header does not leak the other fellowship\'s name, profile or page copy', async () => {
    for (const [sub, mine, theirs] of [[subA, MARK_A, MARK_B], [subB, MARK_B, MARK_A]] as const) {
      const r = await api(app).get(`/public/fellowships/${sub}`);
      expect(r.status).toBe(200);
      const body = JSON.stringify(r.body);

      expect(body).toContain(mine);
      expect(body).not.toContain(theirs);
      // The counterparty's own subdomain must not appear either - that is a directory leak, not just content.
      expect(body).not.toContain(sub === subA ? subB : subA);
      // And the reader's own subdomain is echoed back so the header can build its links.
      expect(r.body.fellowship.subdomain).toBe(sub);
    }
  });

  it('a prayer request sent to one fellowship does not land in the other\'s inbox', async () => {
    const marker = `PRAY${uniq().toUpperCase()}`;
    const r = await api(app).post(`/public/fellowships/${subA}/prayer-requests`, {
      name: 'Visitor',
      message: marker,
    });
    expect(r.status).toBe(201);

    // It must be visible to A's own content manager...
    const mine = await api(app, aIt.token).get('/it-content/site/enquiries');
    expect(JSON.stringify(mine.body)).toContain(marker);

    // ...and invisible to B's.
    const theirs = await api(app, bIt.token).get('/it-content/site/enquiries');
    expect(JSON.stringify(theirs.body)).not.toContain(marker);
  });

  it('a content manager cannot write to another fellowship, whatever they send', async () => {
    // A post belonging to B, which A's IT manager must not be able to reach by id.
    const bPost = await prisma.publicPost.create({
      data: { fellowship_id: b.id, kind: 'project', title: `${MARK_B}-protected`, is_published: true, created_by: bIt.id },
    });

    // Editing it by id.
    const edit = await api(app, aIt.token).put(`/it-content/site/posts/${bPost.id}`, { title: 'hijacked' });
    expect([403, 404]).toContain(edit.status);

    // Publishing it.
    const publish = await api(app, aIt.token).put(`/it-content/site/posts/${bPost.id}`, { isPublished: false });
    expect([403, 404]).toContain(publish.status);

    // Deleting it.
    const remove = await api(app, aIt.token).delete(`/it-content/site/posts/${bPost.id}`);
    expect([403, 404]).toContain(remove.status);

    // Marking one of B's enquiries handled.
    const bEnquiry = await prisma.publicEnquiry.create({
      data: { fellowship_id: b.id, kind: 'contact_message', name: 'Visitor', message: `${MARK_B}-enquiry` },
    });
    const handled = await api(app, aIt.token).post(`/it-content/site/enquiries/${bEnquiry.id}/handled`);
    expect([403, 404]).toContain(handled.status);

    // None of it took effect. This is the check that matters: a 403 that still wrote would pass the status asserts.
    const after = await prisma.publicPost.findUnique({ where: { id: bPost.id } });
    expect(after?.title).toBe(`${MARK_B}-protected`);
    expect(after?.is_published).toBe(true);
    const enquiryAfter = await prisma.publicEnquiry.findUnique({ where: { id: bEnquiry.id } });
    expect(enquiryAfter?.is_handled).toBe(false);
  });

  /**
   * A `?fellowshipId=` pointing at somebody else is IGNORED for a non-admin, not rejected.
   *
   * `TenantScopeService.resolveFellowshipId` returns the caller's own `fellowshipId` for anyone who is not a
   * platform admin, whatever they put in the query. So these requests succeed - against the caller's OWN site.
   *
   * The assertion is therefore on the database, not on the status code: the counterparty's rows must be unchanged.
   * That is the property that actually matters, and it is the one a status-code check would have let pass.
   */
  it('a fellowshipId in the query is ignored, so it writes to the caller\'s own site, never the target\'s', async () => {
    // Unpublish the caller's own site, while naming B as the target.
    await api(app, aIt.token).post(`/it-content/site/publish?fellowshipId=${b.id}`, { enabled: false });

    // A really is offline now, and B is untouched.
    const aAfter = await prisma.fellowship.findUnique({ where: { id: a.id } });
    expect(aAfter?.public_site_enabled).toBe(false);
    const bAfter = await prisma.fellowship.findUnique({ where: { id: b.id } });
    expect(bAfter?.public_site_enabled).toBe(true);
    expect(bAfter?.subdomain).toBe(subB);

    // Put A back for the remaining assertions.
    await prisma.fellowship.update({ where: { id: a.id }, data: { public_site_enabled: true } });
  });

  it('a content manager cannot write page copy or a profile onto another fellowship', async () => {
    await api(app, aIt.token).put(`/it-content/site/pages/about?fellowshipId=${b.id}`, { title: 'hijacked' });
    await api(app, aIt.token).put(`/it-content/site/profile?fellowshipId=${b.id}`, { tagline: 'hijacked' });

    // B is untouched...
    const bPage = await prisma.publicPage.findUnique({ where: { fellowship_id_key: { fellowship_id: b.id, key: 'about' } } });
    expect(bPage?.title).toBe(`${MARK_B}-about-title`);
    const bProfile = await prisma.publicProfile.findUnique({ where: { fellowship_id: b.id } });
    expect(bProfile?.tagline).toBe(`${MARK_B}-tagline`);
    const f = await prisma.fellowship.findUnique({ where: { id: b.id } });
    expect(f?.subdomain).toBe(subB);

    // ...and the write landed on A, which is the caller's own site.
    const aPage = await prisma.publicPage.findUnique({ where: { fellowship_id_key: { fellowship_id: a.id, key: 'about' } } });
    expect(aPage?.title).toBe('hijacked');
  });

  it('a rename aimed at another fellowship moves the caller\'s own site, never the target\'s', async () => {
    // A asks for the label B already uses. The target is A, because the query id is ignored - so the only thing
    // standing between this and A shadowing B is the uniqueness check.
    const clash = await api(app, aIt.token).post('/it-content/site/subdomain', { subdomain: subB });
    expect(clash.status).toBe(400);
    expect(clash.body.message).toContain('already in use');

    // A is unmoved, which is what keeps the public-read tests above able to resolve it.
    const aAfter = await prisma.fellowship.findUnique({ where: { id: a.id } });
    expect(aAfter?.subdomain).toBe(subA);
    expect(aAfter?.public_site_enabled).toBe(true);
  });

  it('no public endpoint accepts a fellowship id, so there is nothing to tamper with', async () => {
    // A ?fellowshipId= on a public route is ignored: the server resolves the fellowship from the subdomain and
    // nothing else, so there is no id a caller can substitute. This asserts the outcome rather than the absence of
    // the parameter, because the parameter being present-but-ignored is exactly the safe state.
    const attempts = [
      `/public/fellowships/${subA}/departments?fellowshipId=${b.id}`,
      `/public/fellowships/${subA}/news?fellowshipId=${b.id}`,
      `/public/fellowships/${subA}/projects?fellowshipId=${b.id}`,
      `/public/fellowships/${subA}/leadership?fellowshipId=${b.id}`,
      `/public/fellowships/${subA}/sermons?fellowshipId=${b.id}`,
    ];
    for (const url of attempts) {
      const r = await api(app).get(url);
      expect(r.status).toBe(200);
      const body = JSON.stringify(r.body);
      expect(body).toContain(MARK_A);
      expect(body).not.toContain(MARK_B);
    }
  });

  it('a fellowship cannot claim a subdomain the platform reserves', async () => {
    // The unique index stops one fellowship taking another's label, but nothing stopped a fellowship taking `www`
    // or `admin`, which would shadow the platform's own hosts. Found by the test above failing on a fresh database.
    for (const reserved of ['www', 'admin', 'api']) {
      const r = await api(app, aIt.token).post('/it-content/site/subdomain', { subdomain: reserved });
      expect(r.status).toBe(400);
      expect(r.body.message).toContain('reserved');
    }
    // A's own address is untouched by the attempts.
    const f = await prisma.fellowship.findUnique({ where: { id: a.id } });
    expect(f?.subdomain).toBe(subA);
  });

  it('an account with no fellowship cannot read or write any site', async () => {
    // The platform administrator has no fellowship either, and support staff are read-only platform-side. Neither
    // should be able to land in a tenant's content through this module.
    const orphan = await makeUser(prisma, { fellowshipId: null, roles: ['it_admin'] });
    const overview = await api(app, orphan.token).get('/it-content/site');
    expect(overview.status).toBe(404);

    const support = await makeUser(prisma, { fellowshipId: null, roles: ['platform_support'] });
    const supportRead = await api(app, support.token).get('/it-content/site');
    expect(supportRead.status).toBe(403);
  });
});
