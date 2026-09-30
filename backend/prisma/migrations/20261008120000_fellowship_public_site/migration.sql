-- Fellowship public sites: the DNS label a fellowship is published at, plus an explicit opt-in switch.
--
-- Both columns are additive and defaulted on purpose. Existing tenants must keep resolving and must NOT silently
-- appear on the internet: a null `subdomain` means "no public site yet", and `public_site_enabled` defaults to
-- false so no content becomes reachable until somebody deliberately turns it on.
ALTER TABLE "fellowships" ADD COLUMN "subdomain" TEXT;
ALTER TABLE "fellowships" ADD COLUMN "public_site_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Unique so a public host can be mapped to exactly one fellowship. This is a plain unique index rather than a
-- partial one: Postgres already treats every NULL as distinct from every other NULL, so the many fellowships that
-- have not chosen a subdomain yet are all permitted, and matching the shape Prisma generates for `@unique` keeps
-- `migrate diff` clean.
CREATE UNIQUE INDEX "fellowships_subdomain_key" ON "fellowships"("subdomain");

-- Deliberately no index on `public_site_enabled`. It is a low-selectivity flag, so an index on it would only cost
-- write amplification; public host resolution goes through the unique `subdomain` index above.
