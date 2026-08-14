/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#4f46e5',
        'primary-dark': '#4338ca',
        'primary-light': '#eef2ff',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        border: '#e2e8f0',
        background: '#f8fafc',
        foreground: '#0f172a',
        card: '#ffffff',
        muted: '#f1f5f9',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.06), 0 1px 3px rgba(15,23,42,0.1)',
        elevated: '0 4px 6px -1px rgba(15,23,42,0.08), 0 2px 4px -2px rgba(15,23,42,0.05)',
      },
      fontSize: {
        xxs: ['0.6875rem', '0.875rem'],
      },
    },
  },
  plugins: [],
};
