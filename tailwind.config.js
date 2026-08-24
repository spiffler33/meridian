/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // CSS variable-based colors for theming
        bg: 'var(--color-bg)',
        'bg-card': 'var(--color-bg-card)',
        'bg-hover': 'var(--color-bg-hover)',
        border: 'var(--color-border)',
        'border-focus': 'var(--color-border-focus)',
        text: 'var(--color-text)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted': 'var(--color-text-muted)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        // Category colors
        work: 'var(--color-work)',
        self: 'var(--color-self)',
        family: 'var(--color-family)',
        // Feedback colors
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        // Setpoint palette - the Read pane (docs/PLAN_READING_PANE.md, App. A)
        sp: {
          bg: 'var(--sp-bg)',
          panel: 'var(--sp-panel)',
          panel2: 'var(--sp-panel2)',
          ink: 'var(--sp-ink)',
          muted: 'var(--sp-muted)',
          faint: 'var(--sp-faint)',
          hair: 'var(--sp-hair)',
          amber: 'var(--sp-amber)',
          green: 'var(--sp-green)',
          ice: 'var(--sp-ice)',
          rim: 'var(--sp-rim)',
        },
      },
      maxWidth: {
        'content': 'var(--max-width)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
        serif: ['var(--font-serif)'],
        read: ['var(--font-read)'],
      },
      fontSize: {
        'xs': ['11px', { lineHeight: '1.4' }],
        'sm': ['14px', { lineHeight: '1.5' }],
        'base': ['16px', { lineHeight: '1.5' }],
      },
    },
  },
  plugins: [],
}
