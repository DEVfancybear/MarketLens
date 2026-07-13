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
          bg: 'rgb(var(--bg-rgb) / <alpha-value>)',
          panel: 'rgb(var(--panel-rgb) / <alpha-value>)',
          'panel-2': 'rgb(var(--panel-2-rgb) / <alpha-value>)',
          'panel-3': 'rgb(var(--panel-3-rgb) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised-rgb) / <alpha-value>)',
          border: 'rgb(var(--border-rgb) / <alpha-value>)',
          'border-strong': 'rgb(var(--border-strong-rgb) / <alpha-value>)',
          hover: 'rgb(var(--hover-rgb) / <alpha-value>)',
          pressed: 'rgb(var(--pressed-rgb) / <alpha-value>)',
        },
        // Text
        ink: {
          DEFAULT: 'rgb(var(--text-rgb) / <alpha-value>)',
          muted: 'rgb(var(--text-muted-rgb) / <alpha-value>)',
          faint: 'rgb(var(--text-faint-rgb) / <alpha-value>)',
        },
        // Brand / accent
        brand: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          hover: 'var(--accent-hover)',
        },
        // Market
        bull: 'rgb(var(--bull-rgb) / <alpha-value>)',
        bear: 'rgb(var(--bear-rgb) / <alpha-value>)',
        // SMC semantic
        bos: 'rgb(var(--bos-rgb) / <alpha-value>)',
        choch: 'rgb(var(--choch-rgb) / <alpha-value>)',
        fvg: 'rgb(var(--fvg-rgb) / <alpha-value>)',
        ob: 'rgb(var(--ob-rgb) / <alpha-value>)',
        liquidity: 'rgb(var(--liquidity-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      transitionDuration: {
        DEFAULT: '160ms',
      },
      borderRadius: {
        terminal: '10px',
      },
      boxShadow: {
        terminal: 'var(--shadow-panel)',
        accent: 'var(--glow-accent)',
        floating: 'var(--shadow-panel)',
        glow: 'var(--glow-accent)',
      },
    },
  },
  plugins: [],
};

export default config;
