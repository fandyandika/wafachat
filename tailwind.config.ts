import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        // Indigo-tinted shadows (match the brand accent) — softer + more cohesive than flat black.
        sm: '0 1px 2px -1px oklch(0.45 0.04 280 / 0.10), 0 1px 3px 0 oklch(0.45 0.04 280 / 0.05)',
        DEFAULT: '0 2px 4px -2px oklch(0.45 0.05 280 / 0.10), 0 4px 10px -3px oklch(0.45 0.05 280 / 0.06)',
        elevate: '0 10px 28px -10px oklch(0.45 0.10 280 / 0.18), 0 4px 12px -4px oklch(0.45 0.08 280 / 0.09)',
      },
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--primary-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        lead: 'var(--lead)',
        'lead-soft': 'var(--lead-soft)',
        positive: 'var(--positive)',
        'positive-soft': 'var(--positive-soft)',
        negative: 'var(--negative)',
        'negative-soft': 'var(--negative-soft)',
        gold: 'var(--gold)',
        'gold-soft': 'var(--gold-soft)',
        'gold-foreground': 'var(--gold-foreground)',
      },
    },
  },
  plugins: [],
};

export default config;
