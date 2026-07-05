import type { Config } from 'tailwindcss';

/**
 * Professional TradingView-style dark theme.
 * Colour tokens are exposed as CSS variables in globals.css so the theme
 * toggle can swap palettes without a rebuild.
 */
const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/features/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        terminal: {
          bg: 'var(--bg)',
          panel: 'var(--panel)',
          'panel-2': 'var(--panel-2)',
          border: 'var(--border)',
          hover: 'var(--hover)',
        },
        // Text
        ink: {
          DEFAULT: 'var(--text)',
          muted: 'var(--text-muted)',
          faint: 'var(--text-faint)',
        },
        // Brand / accent
        brand: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
        },
        // Market
        bull: 'var(--bull)',
        bear: 'var(--bear)',
        // SMC semantic
        bos: 'var(--bos)',
        choch: 'var(--choch)',
        fvg: 'var(--fvg)',
        ob: 'var(--ob)',
        liquidity: 'var(--liquidity)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      transitionDuration: {
        DEFAULT: '120ms',
      },
    },
  },
  plugins: [],
};

export default config;
