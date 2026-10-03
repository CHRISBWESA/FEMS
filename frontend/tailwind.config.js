/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand. A deep navy reads as institutional rather than startup; the accent is used sparingly and only
        // where something must earn attention. Every pairing below clears WCAG AA against its stated background.
        primary: '#16386b',
        'primary-dark': '#0f2850',
        'primary-light': '#eef3f9',
        'primary-muted': '#c9d8ea',
        // `accent` is a button fill, so it is dark enough for white text to clear AA (4.9:1). `accent-bright` is the
        // gold for text and icons sitting on the dark panels, where the fill value would be too dark to read.
        accent: '#96680f',
        'accent-bright': '#d8a44f',
        'accent-light': '#fdf6e7',

        // Neutrals. A single ramp so surfaces, borders and text can never drift apart.
        canvas: '#f6f8fb',
        surface: '#ffffff',
        'surface-sunken': '#f1f5f9',
        ink: '#0d1726',
        'ink-muted': '#55637a',
        'ink-subtle': '#7c8798',
        hairline: '#e3e9f0',

        // Semantic. Kept as explicit names so a component never picks a colour by guessing a Tailwind shade.
        success: '#0f7b52',
        'success-light': '#e7f6ef',
        warning: '#a55a06',
        'warning-light': '#fdf3e4',
        danger: '#b4242f',
        'danger-light': '#fdeced',
        info: '#155e8a',
        'info-light': '#e8f2f9',

        /**
         * The legacy slate ramp, remapped onto the neutral scale above.
         *
         * Pages carry hundreds of `slate-*` classes that predate the semantic tokens. Overriding the palette means
         * all of them adopt the new colours in one change, with no find-and-replace to get wrong and no chance of
         * inverting a pairing: each step keeps the same lightness rank it had, so slate-400-on-dark stays legible
         * exactly as it was. Files move onto `ink` / `ink-muted` / `hairline` as they are next edited.
         */
        slate: {
          50: '#f6f8fb',
          100: '#f1f5f9',
          200: '#e3e9f0',
          300: '#cdd6e1',
          400: '#7c8798',
          500: '#55637a',
          600: '#445166',
          700: '#2b3646',
          800: '#1a2331',
          900: '#0d1726',
          950: '#080f1a',
        },

        // The old brand ramp, pointed at the new one so nothing reads as a stray violet any more.
        indigo: {
          50: '#eef3f9',
          100: '#dde7f2',
          200: '#c9d8ea',
          300: '#a8c0dd',
          400: '#7f9ec6',
          500: '#557cab',
          600: '#3a5f8e',
          700: '#2b4c73',
          800: '#1e3a5c',
          900: '#16386b',
          950: '#0f2850',
        },
        violet: {
          50: '#fdf6e7',
          100: '#f9ecd0',
          200: '#f0d9a4',
          300: '#e5c077',
          400: '#d8a44f',
          500: '#c68a35',
          600: '#b07d1c',
          700: '#8d6318',
          800: '#6b4b13',
          900: '#4c360e',
        },

        // Retained aliases: these names are used across existing pages and must keep resolving.
        border: '#e3e9f0',
        background: '#f6f8fb',
        foreground: '#0d1726',
        card: '#ffffff',
        muted: '#f1f5f9',
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