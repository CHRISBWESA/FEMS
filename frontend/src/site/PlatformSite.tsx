import { Route, Routes, useLocation } from 'react-router-dom';
import PublicShell from './PublicShell';
import SeoTags from './SeoTags';
import { PLATFORM_NAV, PLATFORM_PAGES } from './site-copy';
import {
  PlatformHome,
  PlatformAbout,
  PlatformFeatures,
  PlatformSolutions,
  PlatformResources,
  PlatformFaq,
} from './PlatformPages';
import PlatformPricing from './PlatformPricing';
import PlatformContact from './PlatformContact';

/**
 * The platform's own public site, mounted at `/site`.
 *
 * The header and footer are supplied here rather than per page so the eight pages cannot drift apart, and so the
 * navigation is declared exactly once (in `PLATFORM_NAV`).
 *
 * The app itself lives at `/`, so this cannot also be at `/` in the same build without a hostname split. It is
 * reachable at `/site` in every environment, and `App.tsx` sends a visitor on the apex domain here automatically —
 * see `isAppHost` in that file.
 */
export default function PlatformSite() {
  const location = useLocation();
  const page = PLATFORM_PAGES.find((p) => p.path === (location.pathname === '/site' ? '/site' : location.pathname));

  return (
    <PublicShell nav={PLATFORM_NAV} brand="Fellowship Manager" brandTo="/site" accentLabel="Church Administration System">
      <SeoTags
        title={page ? `${page.title} | Fellowship Manager` : 'Fellowship Manager'}
        description={page?.description ?? 'Administration for fellowships, with each one kept to its own data.'}
        url={`https://${typeof window !== 'undefined' ? window.location.hostname : ''}${page?.path ?? '/site'}`}
        image={null}
        // The application itself must never be indexed; this is only about the marketing pages.
        noIndex={false}
      />
      <Routes>
        <Route index element={<PlatformHome />} />
        <Route path="about" element={<PlatformAbout />} />
        <Route path="features" element={<PlatformFeatures />} />
        <Route path="solutions" element={<PlatformSolutions />} />
        <Route path="pricing" element={<PlatformPricing />} />
        <Route path="resources" element={<PlatformResources />} />
        <Route path="faq" element={<PlatformFaq />} />
        <Route path="contact" element={<PlatformContact />} />
        <Route path="*" element={<PlatformHome />} />
      </Routes>
    </PublicShell>
  );
}
