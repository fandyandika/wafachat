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
        sm: '0 1px 2px 0 oklch(0.22 0.025 258 / 0.08)',
        DEFAULT: '0 8px 24px -18px oklch(0.22 0.025 258 / 0.28)',
        elevate: '0 14px 34px -22px oklch(0.22 0.025 258 / 0.34)',
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
        'ledger-ink': 'var(--ledger-ink)',
        'ledger-rule': 'var(--ledger-rule)',
      },
    },
  },
  plugins: [],
};

export default config;
