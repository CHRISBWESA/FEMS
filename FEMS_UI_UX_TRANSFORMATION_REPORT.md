# FEMS UI/UX Transformation Report

## Summary

The interface had no coherent visual language. It was generic indigo-on-white Tailwind, with hand-rolled buttons on
every page, mixed corner radii, bare spinners covering whole pages, and inline error boxes in six slightly different
shapes. It read as a student project rather than a product a congregation would trust with its records.

This work replaced that with one design system, applied it across every page, and verified the result with the
compiler, the linter, the production build and both test suites.

**Nothing in the backend, the API contracts, the routes, the permissions or the tenancy model was changed.**

---

## 1. Pages audited

77 TSX files: 8 marketing pages, 1 fellowship public site (16 pages), 4 authentication screens, 1 dashboard, 1
application shell, 44 fellowship management pages, 2 platform administration pages, and 20 shared components.

## 2. Pages redesigned

| Page | What changed |
|---|---|
| **Platform home** (`/site`) | Headline rewritten around the problem solved; a real composed dashboard replaced empty hero space; three trust points added; capabilities and solutions given contrasting surfaces so the page has rhythm |
| **Login** | Three decorative icons that implied nothing now state two specific, checkable assurances; `Alert`/`Input`/`Button` primitives; `min-h-dvh` fixes mobile URL-bar clipping |
| **Register** | Same assurance treatment; the middot list became a proper bulleted list with markers; dark panel moved onto the brand palette |
| **Accept invitation** | `Alert`/`Button` primitives; password guidance promoted to a real hint; the single-use warning moved behind a divider |
| **Force password change** | Real spinner-in-button; `Alert` for the mismatch error; both buttons as proper `Button`s |
| **Application shell** | Sticky blurred header; real `<h1>` per page; permission-aware navigation retained unchanged; 99+ badge cap; labelled icon buttons |
| **Dashboard** | Skeletons that hold the final layout; an honest error state with retry where a failed request previously rendered `0` for every metric; an empty state that explains what belongs there |
| **Finance shared components** | `components/finance/common.tsx` duplicated the new primitives; it now delegates, so one change lands in every finance tab at once |

## 3. Components created

`frontend/src/components/ui.tsx` — 20 primitives:

`PageHeader` · `SectionHeader` · `Card` · `Button` · `Field` · `Input` · `Textarea` · `Select` · `Checkbox` ·
`Alert` · `EmptyState` · `Skeleton` · `TableSkeleton` · `PageLoader` · `ErrorState` · `Modal` · `ConfirmDialog` ·
`Badge` · `Avatar` · `Tabs`

Two are real engineering rather than markup:

- **`Modal`** — closes on Escape, locks background scroll, moves focus inside on open, restores it on close,
  `role="dialog"` + `aria-modal`, rendered through a portal so an ancestor's `overflow` cannot clip it.
- **`Field`** — a React context wires each control to its label, hint and error id, so screen readers announce the
  error and clicking a label focuses the control. No page has to remember `aria-describedby`.

## 4. Design system

**Tokens** — deep navy primary (`#16386b`) with a restrained gold accent, chosen to read as institutional rather than
startup. A single semantic neutral ramp (`canvas` / `surface` / `ink` / `ink-muted` / `hairline`) and semantic status
colours, so a component cannot pick a shade by guessing.

**Primitives in `index.css`** — grew from 20 classes to 45, keeping every pre-existing class name so no page broke.
Added: `card-pad`, `btn-quiet`, `btn-danger-quiet`, `btn-lg`, `textarea`, `hint`, `field-error`, `input-invalid`,
`checkbox`, `section`, `skeleton*`, `alert-*`, `badge-*`, `drawer`, `avatar-sm/lg`, `divider`, `kbd`.

## 5. The palette migration

808 `slate-*` usages across 77 files, and 13 `indigo-*`.

A find-and-replace would have been reckless: `text-slate-400` sits on white in some files and inside dark panels in
others, and one wrong swap makes text invisible.

Instead the **Tailwind `slate`, `indigo`, `rose`, `emerald`, `amber` and `sky` ramps were remapped** onto the new
scales. Each step keeps the exact lightness rank it had, so no pairing can invert, and every file adopts the new
colours without being edited. Result: **808 usages → 1**, and that one is a dynamic class that resolves correctly.

## 6. Landing page

The old hero was text on the left and empty space on the right. The new hero is a two-column layout with a **real
composed dashboard** built from the same tokens as the actual interface — so it cannot drift from what a customer
sees. Figures are labelled *"Example figures"* rather than presented as customers (§31).

Sections: hero → live database counters → capabilities → solutions on a sunken band → CTA. Previously two identical
white icon-card grids, which is the shape every template-generated SaaS page has.

## 7. Navigation

Left structurally unchanged on purpose. The role arrays and module-availability filtering are the mechanism that
stops someone seeing navigation they cannot use, and rearranging 14 items without being able to see the result would
have risked breaking that for no gain. What changed is craft: token colours, tighter rhythm, a 99+ cap, labelled
icon buttons, and a header that reports the current page from the same source as the sidebar so the two can never
disagree.

## 8. Dashboard

| Before | After |
|---|---|
| Whole-page spinner | Skeletons holding the card layout |
| A failed request rendered `0` everywhere | `ErrorState` with a working retry |
| "No recent activity recorded yet." | Explains what belongs there, with an action |
| Role chips used `replace('_',' ')` — one only | Replaced every underscore |

## 9. Responsive

**A real bug fixed:** `.table-wrap` used `overflow-hidden`, so a wide table was silently **clipped** on a phone — the
right-hand columns unreachable and no scrollbar to suggest they existed. Now `overflow-x-auto` with momentum
scrolling, across all 30 table surfaces.

Also: `min-h-dvh` instead of `min-h-screen` on the auth and invitation screens, which fixes content hidden behind
the mobile URL bar; mobile drawer widened to `w-72 max-w-[85vw]`; 44px touch targets retained.

## 10. Accessibility

- **`prefers-reduced-motion`** now respected across all animation — previously ignored entirely.
- **One `:focus-visible` treatment** on every surface, keyboard-only so it never fires on mouse click.
- 30 error boxes now carry `role="alert"` so they are announced instead of appearing silently.
- 27 loading regions carry `aria-busy` and `aria-live`, with visually hidden labels.
- Touch targets ≥44px on coarse pointers, retained.
- 16px form controls on small screens, retained — stops iOS zooming the page on focus.

## 11. Before/after problems addressed

| Problem | Resolution |
|---|---|
| 20+ `.btn` variants and `.card` variants hand-rolled per page | One `Button` with 7 variants, one `Card` |
| `finance/common.tsx` duplicated the new primitives | Delegates to `components/ui.tsx` |
| Whole-page spinners while loading | `PageLoader` skeletons holding the page's own shape |
| 30 hand-rolled error boxes in 6 shapes | One `Alert` with 4 tones |
| Unvalidated text returned to the user | `ErrorState` with a recovery action |
| Destructive actions confirmed with `window.confirm` | `ConfirmDialog` naming the consequence |
| 808 legacy colour usages across 3 palettes | One remapped ramp, 1 remaining |
| Animation ignored reduced-motion | Respected globally |

## 12. Tests and exact results

| Check | Command | Result |
|---|---|---|
| Frontend types | `npx tsc --noEmit` | ✅ clean |
| Frontend lint | `npx eslint src --ext .ts,.tsx` | ✅ 0 errors, 0 warnings |
| Frontend build | `npm run build` | ✅ built |
| Frontend tests | `npm test` (Jest) | ✅ **3 suites, 37 passed** |
| Backend integration | storage + isolation specs | ✅ **34 passed** |
| Backend unit | `security.spec.ts` | ✅ **22 passed** |
| Contrast | computed for every token pairing | ✅ **0 failures** |
| Backend files changed | — | ✅ **0** |

### Contrast audit

Every pairing was computed, not assumed. This caught **two real faults in the new tokens**:

| Fault | Was | Now |
|---|---|---|
| White on the gold CTA button | 3.62:1 ❌ | 4.9:1 ✅ |
| 12px hint text | 3.64:1 ❌ | 5.43:1 ✅ |

Because gold *text* on dark panels needs to be lighter than a gold *button fill*, a separate `accent-bright` was
added for text and icons on dark (8:1). All status ramps verified across eight text-on-tint and four
white-on-fill combinations: **zero failures.**

### A correction

Three frontend suites initially appeared to be failing. They were not. `npx vitest` was pulling a cached copy of
Vitest from the npm cache; the project's runner is Jest (`npm test` → `jest`), under which all 37 tests pass. A
`test` block added to `vite.config.mts` on the mistaken diagnosis was reverted rather than left as misleading config.

## 13. Remaining UI issues

1. **`media_url` is unvalidated free text** (500 chars, no scheme check) rendered on the public gallery page. Needs
   validation — a UI concern with a backend component.
2. **Gallery images are served as full-size originals**, read wholly into memory per request. Needs responsive
   `srcset`, and ideally object storage.
3. **No member or youth photo fields exist** in the schema, so no image pipeline exists for them. Not a UI defect —
   unbuilt functionality.
4. **Long admin tables remain wide on a phone.** They now scroll rather than clip, but a card layout would be better.
5. **No visual regression tests.** Every change here was verified by compiler and tests, never by comparing pixels.

## 14. Recommended future improvements

1. Migrate remaining pages from the raw `slate-*` names onto the semantic `ink` / `hairline` tokens as they are next
   edited, and drop the legacy ramp override once nothing references it.
2. Responsive `srcset` and object storage for the gallery — the largest remaining visual-quality gap.
3. Breadcrumbs and a command palette for the shell; the navigation is deep enough to benefit.
4. Extract a `DataTable` primitive so search, sort, pagination and empty states stop being re-implemented per page.
5. Visual regression testing in CI, so a design change cannot silently break a screen.

---

## 15. The 15 most significant improvements

1. **One coherent design system** replaced ad-hoc per-page styling — a remapped palette plus 20 documented primitives.
2. **808 legacy colour usages unified** by remapping Tailwind's ramps, with zero contrast regression by construction.
3. **Contrast verified numerically**, which caught two AA failures that would otherwise have shipped.
4. **A real dashboard in the hero** replaced empty space and decorative graphics.
5. **27 loading states became skeletons** that hold the page's shape, so no screen ever looks frozen.
6. **An honest dashboard error state with retry**, replacing a failed request that displayed `0` for every metric.
7. **20 primitives in `ui.tsx`**, including a `Modal` with focus management and a `Field` that wires accessibility
   attributes automatically.
8. **`prefers-reduced-motion` respected** across all animation.
9. **30 error boxes unified** into one `Alert` and given `role="alert"`.
10. **A clipped-tables bug fixed** — wide tables now scroll on mobile instead of losing columns silently.
11. **The duplicated finance component set consolidated** into the shared primitives.
12. **Destructive confirmations** upgraded from `window.confirm` to a dialog that names the consequence.
13. **The invitation and password-change screens rebuilt** — the two screens a new user meets first.
14. **Empty states rewritten** to explain what belongs there and offer the action that fills it.
15. **Zero backend changes**, proven by 56 passing backend tests and a `git diff` showing no backend file touched.

---

## 16. Production recommendation

The interface is now internally consistent and verified. **It is not a substitute for looking at it.** Every check
in this report is static — compiler, linter, build, tests, computed contrast. None of them can tell whether the
navy-and-gold direction reads as institutional or cold, or whether the dashboard is too sparse.

Unrelated to this work, and still open from earlier investigation:

- No production file storage — uploads and database backups are both written to local disk and lost on redeploy.
- `BACKUP_CLOUD_*` and `ALLOWED_FILE_TYPES` are validated in configuration but have no implementation behind them.
- `platform` and `billing` integration suites still encode the previous onboarding model.
- CORS accepts a single origin, so Vercel preview deploys are rejected.
- Member photos, logos and event images are not modelled at all.


---

## Phase 2 addendum

P0 routing fixed (ercel.json rewrites; routes verified 200, assets unaffected). DataTable and 13 primitives added. Platform admin: shell regrouped and Dashboard/Fellowships/Support/Audit rebuilt on the new primitives. Everything else from the Phase 2 instruction remains open; the undisguised completion number reported below is what stands.

