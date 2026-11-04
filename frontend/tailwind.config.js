// Every colour is a CSS variable (defined in src/index.css for light and dark), so one class works in both themes
// and opacity modifiers such as `ring-primary/35` keep working.
const c = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  // The theme switch (ThemeContext) puts `dark` on <html>.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand. A deep navy reads as institutional rather than startup; the accent is used sparingly and only
        // where something must earn attention. Every pairing below clears WCAG AA against its stated background.
        primary: c('primary'),
        'primary-dark': c('primary-dark'),
        'primary-light': c('primary-light'),
        'primary-muted': c('primary-muted'),
        // `accent` is a button fill, so it is dark enough for white text to clear AA (4.9:1). `accent-bright` is the
        // gold for text and icons sitting on the dark panels, where the fill value would be too dark to read.
        accent: c('accent'),
        'accent-bright': c('accent-bright'),
        'accent-light': c('accent-light'),

        // Neutrals. A single ramp so surfaces, borders and text can never drift apart.
        canvas: c('canvas'),
        surface: c('surface'),
        'surface-sunken': c('surface-sunken'),
        ink: c('ink'),
        'ink-muted': c('ink-muted'),
        'ink-subtle': c('ink-subtle'),
        hairline: c('hairline'),
        'hairline-strong': c('hairline-strong'),

        // Semantic. Kept as explicit names so a component never picks a colour by guessing a Tailwind shade.
        success: c('success'),
        'success-light': c('success-light'),
        warning: c('warning'),
        'warning-light': c('warning-light'),
        danger: c('danger'),
        'danger-light': c('danger-light'),
        info: c('info'),
        'info-light': c('info-light'),

        /**
         * The legacy slate ramp, remapped onto the neutral scale above.
         *
         * Pages carry hundreds of `slate-*` classes that predate the semantic tokens. Overriding the palette means
         * all of them adopt the new colours in one change, with no find-and-replace to get wrong and no chance of
         * inverting a pairing: each step keeps the same lightness rank it had, so slate-400-on-dark stays legible
         * exactly as it was. Files move onto `ink` / `ink-muted` / `hairline` as they are next edited.
         */
        slate: {
          50: c('slate-50'),
          100: c('slate-100'),
          200: c('slate-200'),
          300: c('slate-300'),
          400: c('slate-400'),
          500: c('slate-500'),
          600: c('slate-600'),
          700: c('slate-700'),
          800: c('slate-800'),
          900: c('slate-900'),
          950: c('slate-950'),
        },

        // The old brand ramp, pointed at the new one so nothing reads as a stray violet any more.
        indigo: {
          50: c('indigo-50'),
          100: c('indigo-100'),
          200: c('indigo-200'),
          300: c('indigo-300'),
          400: c('indigo-400'),
          500: c('indigo-500'),
          600: c('indigo-600'),
          700: c('indigo-700'),
          800: c('indigo-800'),
          900: c('indigo-900'),
          950: c('indigo-950'),
        },
        violet: {
          50: c('violet-50'),
          100: c('violet-100'),
          200: c('violet-200'),
          300: c('violet-300'),
          400: c('violet-400'),
          500: c('violet-500'),
          600: c('violet-600'),
          700: c('violet-700'),
          800: c('violet-800'),
          900: c('violet-900'),
        },

        /**
         * The status ramps, remapped onto the semantic scale above.
         *
         * For the same reason as `slate`: pages are full of `rose-*`, `emerald-*`, `amber-*` and `sky-*` classes
         * that predate the semantic names. Redirecting the ramps keeps the lightness order intact — so a
         * `text-rose-700` on a `bg-rose-50` panel keeps the contrast it had — while the whole product moves onto
         * one set of status colours. Bright Tailwind defaults never mix with the new navy-and-gold palette.
         */
        rose: {
          50: c('rose-50'),
          100: c('rose-100'),
          200: c('rose-200'),
          300: c('rose-300'),
          400: c('rose-400'),
          500: c('rose-500'),
          600: c('rose-600'),
          700: c('rose-700'),
          800: c('rose-800'),
          900: c('rose-900'),
        },
        emerald: {
          50: c('emerald-50'),
          100: c('emerald-100'),
          200: c('emerald-200'),
          300: c('emerald-300'),
          400: c('emerald-400'),
          500: c('emerald-500'),
          600: c('emerald-600'),
          700: c('emerald-700'),
          800: c('emerald-800'),
          900: c('emerald-900'),
        },
        amber: {
          50: c('amber-50'),
          100: c('amber-100'),
          200: c('amber-200'),
          300: c('amber-300'),
          400: c('amber-400'),
          500: c('amber-500'),
          600: c('amber-600'),
          700: c('amber-700'),
          800: c('amber-800'),
          900: c('amber-900'),
        },
        sky: {
          50: c('sky-50'),
          100: c('sky-100'),
          200: c('sky-200'),
          300: c('sky-300'),
          400: c('sky-400'),
          500: c('sky-500'),
          600: c('sky-600'),
          700: c('sky-700'),
          800: c('sky-800'),
          900: c('sky-900'),
        },

        // Retained aliases: these names are used across existing pages and must keep resolving.
        border: c('hairline'),
        background: c('canvas'),
        foreground: c('ink'),
        card: c('surface'),
        muted: c('surface-sunken'),
      },
      boxShadow: {
        // Three deliberate steps. `card` is the resting card, `raised` is hover/floating, `overlay` is modal.
        card: '0 1px 2px rgba(13,23,38,0.04), 0 1px 3px rgba(13,23,38,0.07)',
        elevated: '0 2px 4px rgba(13,23,38,0.04), 0 8px 16px rgba(13,23,38,0.08)',
        overlay: '0 8px 24px rgba(13,23,38,0.12), 0 24px 48px rgba(13,23,38,0.16)',
        // Focus is drawn as a ring, never as a shadow, so it is visible on every surface it lands on.
        focus: '0 0 0 3px rgba(22,56,107,0.28)',
      },
      borderRadius: {
        card: '0.75rem',
        control: '0.5rem',
      },
      fontFamily: {
        // Institutional, tabular-friendly. Loaded once in index.html and applied to body only, so headings and UI
        // inherit one voice while numbers stay lining up.
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        xxs: ['0.6875rem', '1rem'],
        'display-sm': ['2rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],
        'display-md': ['2.5rem', { lineHeight: '2.75rem', letterSpacing: '-0.02em' }],
        'display-lg': ['3.25rem', { lineHeight: '3.5rem', letterSpacing: '-0.025em' }],
      },
      maxWidth: {
        prose: '68ch',
      },
      transitionTimingFunction: {
        // A single easing for the whole product so motion feels like one hand made it.
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-rise': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        'fade-rise': 'fade-rise 0.28s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 0.2s ease-out both',
      },
    },
  },
  plugins: [],
};