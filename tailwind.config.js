/** @type {import('tailwindcss').Config} */

/*
 * Every colour here is a pointer into `src/index.css`. Nothing is defined
 * twice, and there is no palette in this file to drift from that one.
 *
 * There is no `/opacity` support on these tokens on purpose: a token holds a
 * whole colour value, not channels, so `bg-accent/5` compiles to nothing at
 * all. Where a tint is genuinely wanted, index.css mixes a named one
 * (`accent-wash`, `accent-rim`, `cite-rim`) and it is used by name.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        'bg-card': 'var(--color-bg-card)',
        'bg-hover': 'var(--color-bg-hover)',
        border: 'var(--color-border)',
        'border-focus': 'var(--color-border-focus)',

        text: 'var(--color-text)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted': 'var(--color-text-muted)',
        // The whisper tier. Below the contrast bar in both themes, on
        // purpose — nothing load-bearing may be written in it.
        'text-faint': 'var(--color-text-faint)',

        accent: 'var(--color-accent)',
        'accent-quiet': 'var(--color-accent-quiet)',
        'accent-wash': 'var(--color-accent-wash)',
        'accent-rim': 'var(--color-accent-rim)',
        error: 'var(--color-error)',

        // Instrument hues — the setpoint wave and citation marks only.
        settled: 'var(--color-settled)',
        cite: 'var(--color-cite)',
        'cite-rim': 'var(--color-cite-rim)',
      },
      maxWidth: {
        content: 'var(--max-width)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
      },
      fontFamily: {
        // Two faces. `mono` is the instrument, `read` is the voice.
        mono: ['var(--font-mono)'],
        read: ['var(--font-read)'],
      },
      /*
       * The whole scale. Five steps, and density comes from line-height rather
       * than from padding, so each step carries its own.
       *
       *   2xs  micro instrument — heat cells, timing strip, chip labels
       *   xs   labels, captions, the footer
       *   sm   the UI default — nav, buttons, rows, most of the app
       *   base reading: pulse lines, prose, anything the owner wrote
       *   lg   display: the date, a page's one big number
       */
      /*
       * Two letter-spacings, both for uppercase runs — lowercase text gets
       * none. Four hand-written `tracking-[0.NNem]` values were in play, two
       * of which differed by 0.04em at 11px, which is a fifth of a pixel.
       */
      letterSpacing: {
        caps: '0.06em',
        label: '0.18em',
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '1.4' }],
        xs: ['11px', { lineHeight: '1.45' }],
        sm: ['14px', { lineHeight: '1.55' }],
        base: ['16px', { lineHeight: '1.7' }],
        lg: ['20px', { lineHeight: '1.25' }],
      },
    },
  },
  plugins: [],
};
