# FEMS UI/UX Audit Report

Date: 4 November 2026 · Scope: the React frontend (`frontend/src`), every signed-in area, light and dark themes, phone to desktop.

## How the audit was done

1. **Code inspection** of the design tokens (`tailwind.config.js`, `src/index.css`), the shared component library
   (`components/ui.tsx`, `components/DataTable.tsx`, `components/Layout.tsx`) and every page in `pages/`, `fin/`, `inv/`,
   `workspace/`, `site/` and `fellowship-site/`.
2. **Scripted scans of the source**: form controls with no label, icon-only buttons with no name, mouse-only click
   targets, hand-built dialogs, hard-coded colours, tiny text, broken characters.
3. **Contrast measured numerically** (WCAG relative-luminance formula) for every token pairing.
4. **Automated testing in a real browser** (Playwright + axe-core 4.10, rules WCAG 2.0/2.1/2.2 A and AA) against a local
   copy of FEMS on the test database, signed in as a demo Treasurer and a demo Secretary: 19 routes, 5 widths
   (320–1920 px), light and dark.

## What is already good (kept as is)

- A real design system already exists: semantic colour tokens (primary, surface, ink, success, warning, danger, info),
  one radius and shadow scale, Inter with tabular numbers, and a documented reason for each choice.
- Shared components cover almost everything a page needs: `Button`, `Field`/`Input`/`Select`, `Modal`, `ConfirmDialog`,
  `DataTable` (sorting, paging, search, mobile card layout, keyboard-operable rows), `Tabs`, `Badge`, `StatCard`,
  skeletons, `EmptyState`, `ErrorState`, toasts.
- One visible keyboard focus style; reduced-motion respected; 44 px touch targets on touch screens; 16 px inputs on
  phones (no iOS zoom); tables scroll sideways instead of clipping.
- Every text colour pairing except one (below) already met AA.

## Findings

Severity: **Critical** blocks a task for some users · **High** a WCAG AA failure or a broken feature · **Medium** a
usability or consistency problem · **Low** polish.

| # | Issue | Where | Standard | Severity | Correction |
|---|-------|-------|----------|----------|------------|
| 1 | The light/dark theme switch had no effect: no dark colours existed (0 `dark:` styles, colours were fixed hex values). | Whole app; switch in header | NN/g #1 visibility of system status, #4 consistency; ISO 9241-110 conformity with expectations | High | Turn every token into a CSS variable with a light and a dark value; enable Tailwind's class-based dark mode. |
| 2 | About 130 form fields had a visible label that was not linked to the field, so screen readers announced a blank field and clicking the label did nothing. | Members, Member detail, Users, Activities, Youth, IT Content, Reports, Programmes, Public site, workspaces | WCAG 1.3.1, 3.3.2, 4.1.2 | Critical | Link each label to its field (`htmlFor`/`id`); make `Field` wire up plain inputs placed inside it. |
| 3 | 16 hand-built dialogs on 11 pages were not announced as dialogs, did not close with Escape, did not move focus into the dialog or return it, and let the page scroll behind. | Members, Users, Activities, Programmes, Youth, Profile, Reports, IT Content, Member/Youth detail, Age groups | WCAG 2.1.2, 2.4.3, 4.1.2; NN/g #3 user control | High | One shared `DialogBackdrop` that adds all of this; swap it in at each dialog. |
| 4 | Long pop-up forms grew taller than the screen; the Save button could be pushed out of view. | Every pop-up form | WCAG 1.4.10 reflow; NN/g #5 error prevention | High | Cap pop-ups at the screen height: title and buttons stay fixed, the fields scroll. *(Fixed and released earlier today.)* |
| 5 | De-emphasised grey text (`ink-subtle`, 266 uses) was 3.4–3.6:1. | Hints, metadata, table secondary text everywhere | WCAG 1.4.3 (4.5:1) | High | Darken the token to `#647083` (4.6–5.0:1). |
| 6 | Text-box and dropdown edges were 1.2:1 against white, so fields were hard to see. | All forms | WCAG 1.4.11 (3:1) | High | New `hairline-strong` token (3.3:1) for control edges. |
| 7 | 17 icon-only buttons (mostly ✕ close) had no accessible name. | Dialogs on 12 pages; Profile edit/cancel | WCAG 4.1.2, 2.5.3 | High | `aria-label` on each; icons marked decorative. |
| 8 | Filter dropdowns and search boxes named only by a placeholder or by nothing. | Leadership, Members, Contribution Drives, Finance settings, Users, Platform, Volunteering | WCAG 1.3.1, 4.1.2 | High | Filter dropdowns are named by their first choice automatically; search boxes get an `aria-label`. |
| 9 | Members page scrolled sideways by 181 px on a 320 px phone: a hidden "Actions" label escaped the table's scroll box. | Every `DataTable` with row actions | WCAG 1.4.10 reflow | Medium | Make the table box the positioning context. |
| 10 | Main content area could not be scrolled by keyboard when it had nothing focusable. | Finance dashboard and similar read-only pages | WCAG 2.1.1 | Medium | Make the main region focusable. |
| 11 | A clickable table row worked only with a mouse. | Platform → Subscriptions | WCAG 2.1.1 | Medium | The fellowship name is now a real link. |
| 12 | Garbled characters: `â€”`, `â€¦`, `Â·` and `�` where `—`, `…`, `·`, `’`, `→` belong (about 35 places). | Platform and Users pages | ISO 9241-110 self-descriptiveness | Medium | Restored the characters. |
| 13 | Member-name links in the members table were smaller than the 24 px minimum target. | Members | WCAG 2.5.8 | Medium | Larger hit area. |
| 14 | Impersonation warning banner: white text on amber was 3.0:1. | Platform impersonation banner | WCAG 1.4.3 | Medium | Use the `warning`/`danger` fill tokens (5.2:1, 6.5:1). |
| 15 | Text at 10 px. | Finance trend chart labels, public landing page | Readability; Material 3 type scale minimum | Low | Raised to the 11 px `xxs` step. |
| 16 | The drive status filter stretched across the whole page; the sidebar cut "Finance & Resources" short. | Contribution Drives; sidebar | NN/g #8 aesthetic and minimalist design | Low | Fixed width for the filter; the group name may wrap. |
| 17 | Most screens are written in English directly in the code, so switching to Kiswahili changes only some text (the switch itself works). | Most pages and the sidebar | NN/g #2 match with the real world | High | **Not fixed** (large). Move page text into `I18nContext` page by page. |
| 18 | 38 native browser pop-ups (`alert`, `confirm`, `prompt`) look different from the rest of FEMS and cannot be themed. | Users, Members and others | NN/g #4 consistency | Low | **Not fixed.** Replace with `ConfirmDialog` and toasts over time. They are accessible, so this is consistency only. |

## Contrast measurements (selection)

| Pairing | Before | After |
|---|---|---|
| Subtle text on white / page background | 3.64 / 3.42 | 5.02 / 4.71 |
| Form control edge on white | 1.22 | 3.27 |
| Body text, muted text, primary, status badges (light) | 4.55–11.6 | unchanged (already AA) |
| Dark theme: text on surfaces | — | 5.9–15.6 |
| Dark theme: status text on its tint | — | 6.7–8.4 |
| Dark theme: white text on filled buttons | — | 4.9–7.0 |
