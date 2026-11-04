# FEMS UI/UX Standards

How FEMS screens are built. References: WCAG 2.2 AA, Nielsen Norman Group's 10 heuristics, ISO 9241-110, Material
Design 3 (principles, not its look). FEMS keeps its own identity: institutional navy and gold, quiet surfaces, dense but
calm data.

## 1. Principles

1. **Clarity over decoration.** No gradients, heavy shadows or decorative motion in the signed-in app.
2. **One way to do a thing.** Use the shared components; do not hand-build a button, dialog or table.
3. **Say what happened.** Every action ends in visible feedback: a toast, an inline error, a disabled or loading button.
4. **Show only what the role may do.** Permissions decide what appears; never show a button that will fail with "forbidden".
5. **Works for everyone.** Keyboard, screen reader, phone, dark mode and Kiswahili are requirements, not extras.

## 2. Colour

Colours are **tokens**, defined once in `src/index.css` as CSS variables with a light and a dark value and exposed to
Tailwind in `tailwind.config.js`. Use the token name, never a hex value or a raw Tailwind palette shade.

| Role | Token | Use |
|---|---|---|
| Brand | `primary`, `primary-dark`, `primary-light`, `primary-muted` | Main actions, links, active navigation, selected states |
| Accent | `accent`, `accent-bright`, `accent-light` | Rare emphasis only |
| Page / panels | `canvas`, `surface`, `surface-sunken` | Page background, cards and dialogs, wells and table headers |
| Text | `ink`, `ink-muted`, `ink-subtle` | Main text, secondary text, metadata (all at least 4.5:1) |
| Lines | `hairline`, `hairline-strong` | Dividers and card edges; form-control edges (at least 3:1) |
| Status | `success`, `warning`, `danger`, `info` + `-light` tints | Badges, alerts, totals; pair the text colour with its own tint |

Rules:
- A solid fill carrying white text (`bg-primary text-white`, `.btn-primary`, `.btn-danger`, ...) automatically keeps a
  dark fill in dark mode. Do not invent new filled colours.
- Colour never carries meaning alone: pair it with a word or an icon (for example "Overdue", not just red).
- Dark mode is driven by the `dark` class that `ThemeContext` puts on `<html>`; `dark:` variants are available for the
  rare case the tokens cannot express.

## 3. Typography

Inter, one family, `font-synthesis` off, tabular numbers in tables.

| Level | Class | Size / weight |
|---|---|---|
| Page title | `.page-title` (via `PageHeader`) | 24 px, semibold |
| Section title | `.section-title` | 18 px, semibold |
| Dialog title | `.modal-title` | 18 px, semibold |
| Body | `text-sm` | 14 px, regular |
| Label | `.label` | 14 px, medium |
| Hint / metadata | `.hint`, `text-xs` | 12 px |
| Smallest allowed | `text-xxs` | 11 px; badges and counters only |

One `h1` per page (the page title). Do not skip heading levels inside dialogs and cards.

## 4. Spacing and layout

- **4 px grid.** Use Tailwind steps (1 = 4 px): 2 / 3 / 4 / 6 inside components, 6 / 8 between sections.
- Page content: `mx-auto max-w-7xl`, with page padding from the layout (`p-4 sm:p-6 lg:p-8`).
- Cards: `.card` + `.card-pad` (20 px, 24 px from `sm`). Radius: `rounded-card` (12 px) for surfaces, `rounded-control`
  (8 px) for controls.
- Forms in dialogs: one column on phones, two (`sm:grid-cols-2`) when fields are short.

## 5. Components (in `components/ui.tsx` unless noted)

| Need | Use | Notes |
|---|---|---|
| Page header | `PageHeader` | Title, optional eyebrow/description, actions on the right |
| Buttons | `Button` (`primary`, `secondary`, `ghost`, `danger`, `success`; `sm`, `lg`; `loading`) | One primary button per area. Icon-only buttons need `aria-label`. |
| Icon button | `IconButton` | Always pass `label` |
| Form field | `Field` + `Input` / `Select` / `Textarea` / `DatePicker` | `Field` links label, hint and error to the control, also for a plain `<input>` placed inside |
| Choices | `Checkbox`, `Radio`, `Switch`, `MultiSelect` | |
| Dialog | `Modal`, `FormModal` (`fin/common.tsx`), `ConfirmDialog` | For a page's own dialog markup, wrap it in `DialogBackdrop` |
| Data list | `DataTable` (`components/DataTable.tsx`) | Search, sort, paging, row actions, `onRowClick`, card layout on phones, keyboard-operable rows |
| Status | `Badge`, `.status-badge` | |
| Numbers | `StatCard`, `StatGrid` | Real data only, never placeholder figures |
| Tabs / steps | `Tabs`, `Stepper`, `Breadcrumb` | |
| Feedback | `useToast`, `Alert`, `EmptyState`, `ErrorState`, `Skeleton`, `TableSkeleton`, `PageLoader` | |

## 6. Accessibility (WCAG 2.2 AA)

- Contrast: text 4.5:1 (3:1 at 24 px or 19 px bold and above); control edges and focus 3:1. Measure new colours.
- Every control has a name: a linked `<label>`, a `Field`, or `aria-label` when there is no visible label. A placeholder
  is never the only name.
- Dialogs: `Modal`/`FormModal`, or `DialogBackdrop` for custom markup. They are announced as dialogs, named by their
  heading, closed by Escape, and they return focus.
- Keyboard: everything clickable is a `button` or a link (or a `DataTable` row). No click handlers on plain `div`s.
- Focus: keep the global `:focus-visible` ring; never remove an outline without a replacement.
- Targets at least 24 × 24 px (44 px on touch screens is applied automatically to buttons and fields).
- Status messages use toasts (announced politely) or `role="status"` / `role="alert"`.
- Decorative icons: `aria-hidden`.

## 7. Responsive design

Test at 320, 375, 390, 430, 768, 1024, 1280, 1440 and 1920 px.
- No sideways page scroll. Wide tables scroll inside `.table-wrap`, or use `DataTable`, which turns rows into cards on phones.
- Pop-ups never exceed the screen: the title and buttons stay visible, the fields scroll.
- The sidebar becomes a drawer below `lg` (1024 px).
- Inputs stay 16 px on phones.

## 8. Interaction

- Loading: skeletons for content areas, `loading` on the button that was pressed; never a blank page.
- Empty: `EmptyState` with what to do next (only if this role can do it).
- Errors: say what went wrong and how to fix it, next to the field when possible; keep what the user typed.
- Destructive or irreversible actions: `ConfirmDialog` that names the consequence.
- Motion: 150–300 ms, the shared `ease-out`; it is switched off when the reader prefers reduced motion.

## 9. Implementation conventions

- Do not add UI libraries for something the shared components already do.
- New text goes through `useI18n().t()` with English and Kiswahili entries in `context/I18nContext.tsx`.
- Before merging a screen: `npx tsc --noEmit`, `npx eslint src`, `npx jest`, `npx vite build`, and an axe check in
  light and dark at 375 px and 1280 px.
