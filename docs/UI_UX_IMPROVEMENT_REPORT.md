# FEMS UI/UX Improvement Report

Date: 4 November 2026. Companion documents: `UI_UX_AUDIT_REPORT.md` (findings) and `FEMS_UI_UX_STANDARDS.md` (rules).

Status: released to `main` on 4 November 2026. No database, API, authentication or permission
change was made; no feature, page or route was removed.

## Improvements implemented

| Area | What changed | Files |
|---|---|---|
| Dark theme | The theme switch now works. Every colour token has a light and a dark value (CSS variables); legacy colour ramps are mirrored in dark so their pairings keep their contrast; filled buttons keep a dark fill for white text; plain white panels follow the surface colour; native controls use `color-scheme`. | `tailwind.config.js`, `src/index.css` |
| Contrast | Subtle text darkened to AA (3.6 → 5.0:1); new `hairline-strong` token gives form-control edges 3.3:1; impersonation banners moved to AA fill colours. | `tailwind.config.js`, `src/index.css`, `components/platform/ImpersonationBanner.tsx` |
| Form labels | 87 labels linked to their fields; `Field` now also links a plain `<input>/<select>/<textarea>` placed inside it (Public site admin, workspace forms); filter dropdowns outside a field are named by their first choice; 7 search boxes named. | `components/ui.tsx`, 14 page files |
| Dialogs | New `DialogBackdrop` gives page-built dialogs `role="dialog"`, `aria-modal`, a name from their heading, Escape to close, focus moved in and restored, and scroll lock. Applied to all 16 such dialogs. Earlier today: pop-ups are capped at the screen height, with fixed title and buttons and scrolling fields. | `components/ui.tsx`, `src/index.css`, 11 page files |
| Button names | 17 icon-only buttons named (close, edit, cancel). | 12 page files |
| Keyboard | Main area reachable for keyboard scrolling; the Platform subscriptions row now has a real link. | `components/Layout.tsx`, `pages/Platform.tsx` |
| Responsive | Fixed sideways scroll on phones caused by a hidden table label escaping the table (affects every table with row actions). | `src/index.css` |
| Text quality | About 35 garbled characters restored on Platform and Users pages. | `pages/Platform.tsx`, `pages/Users.tsx` |
| Polish | Minimum text size 11 px; bigger tap area for member-name links; fixed-width drive filter; sidebar group names no longer cut off. | `fin/common.tsx`, `site/PlatformPages.tsx`, `pages/Members.tsx`, `fin/Drives.tsx`, `components/Layout.tsx` |

## Testing (all actually executed)

| Check | Result |
|---|---|
| `npx tsc --noEmit` (frontend) | Pass |
| `npx eslint src` (frontend) | Pass, no errors |
| `npx jest` (frontend) | 39 / 39 pass |
| `npx vite build` | Pass (PWA service worker still generated) |
| Browser, axe-core 4.10, WCAG 2.0/2.1/2.2 A + AA, 17 routes, light and dark (34 runs) | **0 violations** (before: 7 kinds of violation on 7 routes) |
| Horizontal overflow, 17 routes at 320 / 375 / 390 / 430 / 768 / 1024 / 1440 px (and 1280 / 1920 in the first pass) | **0 pages overflow** (before: Members at 320 px) |
| Sign-in (Treasurer and Secretary demo accounts) | Pass |
| Role permissions | Unchanged: the Treasurer opening `/users` is sent to the dashboard; each role saw only its own menu |
| Dialog by keyboard ("Add resource", "Register member" at 375 px) | Announced as a named dialog, focus moves in, fits the screen and scrolls, Escape closes, focus returns |
| Light and dark themes | Both pass axe contrast; dark screenshots checked by eye |
| Kiswahili | The switch works (`lang="sw"`, choice saved); see remaining issue 1 |

Routes tested — Treasurer: `/dashboard`, `/finance`, `/finance/contributions`, `/finance/expenses`, `/finance/reports`,
`/finance/settings`, `/inventory`, `/profile`, `/notifications`. Secretary: `/members`, `/activities`, `/departments`,
`/leadership`, `/reports`, `/programmes`, `/member-groups`, `/finance`.

Tests ran against a local copy on the Neon **test** branch, never against production data. Manual screen-reader testing
(NVDA, TalkBack) was **not** done; the dialog and label checks above are automated equivalents.

## Remaining issues and recommendations

1. **Kiswahili coverage (High).** Most screens are written in English directly in the code, so only some text changes.
   Move page text into `I18nContext`, starting with the sidebar, Finance and Members.
2. **Native browser pop-ups (Low).** 38 `alert`/`confirm`/`prompt` calls; replace with `ConfirmDialog` and toasts.
3. **Pages not covered by the browser run.** Department workspaces, Youth detail pages, Platform admin and the public
   site were checked in code only; run the same axe pass with a department-leader and a platform-admin account.
4. **Hand-built dialogs.** They are now accessible via `DialogBackdrop`; converting them to `FormModal` over time would
   also give them the fixed title and buttons.
5. **Legacy colour names** (`slate-*`, `amber-*` ...) still appear in a few files; replace them with tokens as files are edited.
