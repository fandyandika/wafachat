# Fase 3A — Design System + Shell + Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a single light theme (indigo/violet accent), refine the shared UI primitives + add a `StatCard`, and restyle the app shell (sidebar/header) and login into an airy, elegant, light interface — so the whole panel is coherently light after 3A.

**Architecture:** Pure frontend, presentation-only. Replace the neutral-gray theme tokens in `globals.css` with a light indigo/violet palette plus semantic metric tokens, drop the `.dark` block and `next-themes` from the render tree, fix the primitives that carried dark-mode artifacts, and rebuild the shell/login markup with token-based classes. No data, Convex, or query changes.

**Tech Stack:** Next.js 14 (App Router), React 18, Tailwind CSS 3.4, base-ui primitives, `class-variance-authority`, `lucide-react`. Tokens are CSS custom properties (oklch) consumed via `tailwind.config.ts`.

## Global Constraints

- **Light-mode ONLY** — light is the single theme; no dark mode, no theme toggle, `next-themes` removed from the render tree. (Spec §2)
- **Accent: indigo/violet** on a neutral white/soft-gray base. Semantic metric colors: leads (sky/indigo), closing (emerald = positive), cancelled (red = negative). (Spec §2)
- **Density: airy/spacious** — generous whitespace, soft radius, subtle elevation shadows (not heavy). (Spec §2)
- **Presentation-only** — no data/Convex/query changes; components keep consuming the existing `useQuery` calls unchanged. (Spec §1, §4)
- **No new charting library, no new features.** (Spec §8)
- **Repo:** git root is `F:/Projects/whatsapp_cs_automotion/wafachat` (branch `main`). All paths below are relative to this repo root. All commit paths are repo-relative.
- **`AnimatedNumber` + highlight animation logic and the Dashboard restyle are OUT of 3A** — they land in Plan 3B. 3A only creates the static `StatCard` shell (with a `highlight` prop + transition hook that 3B will drive) and a `value: React.ReactNode` slot so 3B can inject `<AnimatedNumber/>`. (Spec §7)

## Testing approach (read before starting)

This project has **no React component test infrastructure** (no `@testing-library/react`, no jsdom/happy-dom; `vitest` is used only for Convex logic). Per the approved spec §6, UI work is verified by **`npm run build` (compile + typecheck)** plus a **visual-review checklist**, and the *only* unit test in Fase 3 is for `AnimatedNumber`'s pure logic — which is in Plan **3B**, not here. Therefore 3A has **no red-green unit tests**; each task instead ends with:

1. `npm run build` passes (run from the `wafachat/` repo root).
2. A concrete visual-review checklist against `npm run dev` (http://localhost:3000).
3. A commit.

Do not invent placeholder unit tests for pure-CSS/JSX changes — build + visual review is the correct, honest verification for this task. The existing Convex suite must stay green and is untouched: `npm test` → 13/13.

**Commands (run from repo root `wafachat/`):**
- Build/typecheck: `npm run build`
- Dev server for visual review: `npm run dev` (then open http://localhost:3000/login and /panel)
- Convex regression (unchanged, run once at the end): `npm test`

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `app/globals.css` | Single light theme: indigo/violet primary, neutral base, semantic metric tokens (+ soft variants); **remove `.dark` block** | 1 |
| `tailwind.config.ts` | Map new semantic colors (`lead`, `positive`, `negative` + `-soft`); remove `darkMode` | 1 |
| `app/layout.tsx` | Drop `ThemeProvider` (next-themes) from the tree; force light | 2 |
| `components/theme-provider.tsx` | **Deleted** — unused after layout change | 2 |
| `components/ui/card.tsx` | Fix dark-mode `border-white/10` artifact → `border-border`; add soft `shadow-sm` | 3 |
| `components/ui/badge.tsx` | Add soft semantic variants `success` / `info` / `warning` | 3 |
| `components/ui/stat-card.tsx` | **New** — airy metric card primitive (static; `value` is a `ReactNode` slot; `highlight` prop for 3B) | 3 |
| `app/panel/page.tsx` | Restyle `<aside>` sidebar + `<header>`; remove `<ThemeToggle/>` import + usage | 4 |
| `components/theme-toggle.tsx` | **Deleted** — unused after panel change | 4 |
| `app/login/page.tsx` | Minimalist light card, indigo accent, airy spacing | 5 |

**Not touched / deliberately out of scope:** there is **no `Tabs` primitive** in this codebase — view switching uses the sidebar `navItems` buttons and a mobile `Badge` row (both restyled in Task 4), and the Performance sub-tabs are restyled in Plan 3C. So the spec's "Tabs" refinement is satisfied by the shell nav restyle; do not create a new `Tabs` component (YAGNI). `button.tsx` and `table.tsx` already render correctly on a light base (their `dark:` variants are simply inert with no `.dark` ancestor) — leave them for 3C to touch alongside the screens that use them, to keep 3A's diff focused.

---

### Task 1: Light theme tokens

**Files:**
- Modify: `app/globals.css` (replace the `:root` block, delete the `.dark` block)
- Modify: `tailwind.config.ts` (add semantic colors, remove `darkMode`)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties available app-wide — `--primary` (indigo/violet), `--lead`, `--positive`, `--negative`, `--lead-soft`, `--positive-soft`, `--negative-soft`, `--accent` (soft indigo, used as the highlight tint in 3B). Tailwind color utilities: `bg-primary`, `text-lead`, `bg-positive-soft`, `text-positive`, `bg-negative-soft`, `text-negative`, `bg-accent`, etc. (solid colors — safe without opacity modifiers).

- [ ] **Step 1: Replace the `:root` token block and delete the `.dark` block in `app/globals.css`**

Replace the entire `@layer base { ... }` block (lines 7–88, from `@layer base {` through its closing `}`) with this. Keep the three `@import`/`@tailwind` lines (1–5) above it exactly as they are.

```css
@layer base {
  .theme {
    --font-heading: var(--font-sans);
    --font-sans: var(--font-sans)
  }
  :root {
    /* Base surfaces */
    --background: oklch(0.99 0.004 270);
    --foreground: oklch(0.21 0.02 270);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.21 0.02 270);
    --popover: oklch(1 0 0);
    --popover-foreground: oklch(0.21 0.02 270);

    /* Accent: indigo / violet */
    --primary: oklch(0.52 0.22 280);
    --primary-foreground: oklch(0.985 0 0);
    --secondary: oklch(0.97 0.008 270);
    --secondary-foreground: oklch(0.30 0.03 280);
    --muted: oklch(0.968 0.006 270);
    --muted-foreground: oklch(0.55 0.02 270);
    --accent: oklch(0.96 0.025 285);
    --accent-foreground: oklch(0.38 0.12 282);

    /* Lines + focus */
    --destructive: oklch(0.58 0.22 27);
    --border: oklch(0.92 0.01 270);
    --input: oklch(0.92 0.01 270);
    --ring: oklch(0.52 0.22 280);
    --radius: 0.75rem;

    /* Semantic metric tokens (solid) */
    --lead: oklch(0.55 0.16 252);
    --positive: oklch(0.56 0.13 162);
    --negative: oklch(0.58 0.22 27);
    /* Soft tints for badge/pill fills (no opacity modifier needed) */
    --lead-soft: oklch(0.95 0.03 252);
    --positive-soft: oklch(0.95 0.04 162);
    --negative-soft: oklch(0.95 0.04 27);
  }
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
```

Note: the `--chart-*` and `--sidebar-*` tokens are intentionally dropped — they are unused (verified in Step 2). The `.dark` block is removed entirely.

- [ ] **Step 2: Verify the dropped tokens are unused**

Run (from repo root):
```bash
grep -rn "chart-[1-5]\|sidebar-\|--sidebar\|var(--chart" app components lib
```
Expected: no matches. If any match appears in `app/`, `components/`, or `lib/`, restore just that token to `:root` before continuing.

- [ ] **Step 3: Add semantic colors and remove `darkMode` in `tailwind.config.ts`**

Replace the file contents with:

```ts
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
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 4: Build to verify the theme compiles**

Run (from repo root `wafachat/`):
```bash
npm run build
```
Expected: build completes with no CSS/TS errors. (Convex client warnings about env are fine.)

- [ ] **Step 5: Visual sanity check**

Run `npm run dev`, open http://localhost:3000/panel (log in if prompted with the dev password). Confirm: background is near-white, primary/active elements are indigo/violet (not black/gray), text is dark slate and readable. The shell is not yet restyled — only colors should have shifted. No element should be invisible (e.g., white-on-white).

- [ ] **Step 6: Commit**

```bash
git add app/globals.css tailwind.config.ts
git commit -m "feat(ui): light indigo/violet theme tokens, drop dark theme"
```

---

### Task 2: Drop theme provider → force light

**Files:**
- Modify: `app/layout.tsx`
- Delete: `components/theme-provider.tsx`

**Interfaces:**
- Consumes: theme tokens from Task 1.
- Produces: a render tree with no `next-themes` provider and no `dark` class ever applied to `<html>`. `ConvexClientProvider` + `TooltipProvider` are preserved.

- [ ] **Step 1: Replace `app/layout.tsx` contents**

```tsx
import type { Metadata } from 'next';
import './globals.css';
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConvexClientProvider } from "./ConvexClientProvider";

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'WaFaChat',
  description: 'WaFaChat CS Control Panel',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={cn("font-sans", inter.variable)}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ConvexClientProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Delete the now-unused theme provider**

```bash
git rm components/theme-provider.tsx
```

Note: `components/theme-toggle.tsx` is still imported by `app/panel/page.tsx`, so it stays until Task 4. `theme-toggle.tsx` imports `useTheme` directly from `next-themes` (not from `theme-provider.tsx`), so deleting `theme-provider.tsx` does not break it.

- [ ] **Step 3: Confirm no remaining import of the deleted file**

```bash
grep -rn "theme-provider" app components
```
Expected: no matches.

- [ ] **Step 4: Build to verify**

```bash
npm run build
```
Expected: build completes, no errors. (`next-themes` remains an installed dependency — still referenced by `theme-toggle.tsx` until Task 4 — so no missing-module error.)

- [ ] **Step 5: Visual check**

`npm run dev` → http://localhost:3000/panel. Confirm the page renders light with no flash of dark and no hydration warning in the browser console related to theme/class.

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(ui): remove next-themes provider, force single light theme"
```

---

### Task 3: Refine primitives + StatCard

**Files:**
- Modify: `components/ui/card.tsx` (line 15 className)
- Modify: `components/ui/badge.tsx` (cva variants)
- Create: `components/ui/stat-card.tsx`

**Interfaces:**
- Consumes: theme tokens (Task 1) and Tailwind color utilities (`positive-soft`, `lead-soft`, `accent`, etc.).
- Produces:
  - `Badge` gains variants `success` (emerald soft), `info` (sky soft), `warning` (amber soft) — usable as `<Badge variant="success">`.
  - `StatCard` component exported from `components/ui/stat-card.tsx`:
    ```ts
    function StatCard(props: React.ComponentProps<"div"> & {
      label: string;
      value: React.ReactNode;          // slot — 3B injects <AnimatedNumber/>
      detail?: React.ReactNode;
      icon?: React.ComponentType<{ className?: string }>;
      tone?: "default" | "lead" | "positive" | "negative";
      highlight?: boolean;             // 3B toggles this to flash on increment
    }): JSX.Element
    export type StatTone = "default" | "lead" | "positive" | "negative";
    ```
    Plan 3B relies on exactly these prop names: `value`, `highlight`, `tone`, `label`, `detail`, `icon`.

- [ ] **Step 1: Fix the Card border + add elevation**

In `components/ui/card.tsx`, in the `Card` function's `className` (line 15), change `border border-white/10` → `border border-border` and insert `shadow-sm` right after `text-card-foreground`. The opening of the class string becomes:
```
"group/card flex flex-col gap-4 overflow-hidden rounded-xl border border-border bg-card py-4 text-sm text-card-foreground shadow-sm ...
```
Leave the rest of the class string (everything after `shadow-sm`) unchanged.

- [ ] **Step 2: Add soft semantic Badge variants**

In `components/ui/badge.tsx`, inside `badgeVariants` → `variants.variant`, add three entries after the existing `link` line (keep all existing variants):
```ts
        success: "bg-positive-soft text-positive",
        info: "bg-lead-soft text-lead",
        warning: "bg-amber-100 text-amber-700",
```

- [ ] **Step 3: Create the StatCard primitive**

Create `components/ui/stat-card.tsx`:
```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

type StatTone = "default" | "lead" | "positive" | "negative"

const toneIcon: Record<StatTone, string> = {
  default: "text-primary",
  lead: "text-lead",
  positive: "text-positive",
  negative: "text-negative",
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
  highlight = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  label: string
  value: React.ReactNode
  detail?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  tone?: StatTone
  highlight?: boolean
}) {
  return (
    <div
      data-slot="stat-card"
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors duration-500",
        highlight && "bg-accent",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        {Icon ? <Icon className={cn("size-4", toneIcon[tone])} /> : null}
      </div>
      <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </div>
      {detail ? <div className="text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  )
}

export { StatCard }
export type { StatTone }
```

- [ ] **Step 4: Build to verify primitives compile**

```bash
npm run build
```
Expected: build completes, no TS errors. `StatCard` is currently unused (consumed in 3B) — an unused export does not fail the build.

- [ ] **Step 5: Visual check of the Card border fix**

`npm run dev` → /panel. Confirm cards now have a visible light-gray border and a subtle shadow (previously the `border-white/10` border was invisible on the light background).

- [ ] **Step 6: Commit**

```bash
git add components/ui/card.tsx components/ui/badge.tsx components/ui/stat-card.tsx
git commit -m "feat(ui): airy Card border+shadow, soft Badge variants, StatCard primitive"
```

---

### Task 4: App shell restyle + remove theme toggle

**Files:**
- Modify: `app/panel/page.tsx` (remove `ThemeToggle` import line 32; restyle `<aside>` ≈ lines 618–661 and `<header>` ≈ lines 664–738; remove `<ThemeToggle />` usage)
- Delete: `components/theme-toggle.tsx`

**Interfaces:**
- Consumes: `Badge` `success` variant (Task 3), theme tokens (Task 1). Existing handlers/state (`navItems`, `panelView`, `setPanelView`, `selectedCsName`, `setSelectedCsName`, `csConfigs`, `lastUpdated`, `handleGlobalAiToggle`, `actionLoading`, `loading`, `displayGlobalEnabled`) are unchanged — only markup/classes change.
- Produces: a coherent airy light shell. No `ThemeToggle` anywhere.

- [ ] **Step 1: Remove the ThemeToggle import**

In `app/panel/page.tsx`, delete line 32:
```tsx
import { ThemeToggle } from '@/components/theme-toggle';
```

- [ ] **Step 2: Restyle the sidebar (`<aside>`)**

Replace the entire `<aside ...> ... </aside>` block (≈ lines 618–661) with:
```tsx
        <aside className="hidden w-64 shrink-0 border-r border-border bg-card/60 md:flex md:flex-col">
          <div className="px-6 py-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Bot className="size-5" />
              </div>
              <div>
                <div className="text-sm font-semibold leading-none text-foreground">WaFaChat</div>
                <div className="mt-1 text-xs text-muted-foreground">CS Automation</div>
              </div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 px-4">
            {navItems.map((item) => (
              <button
                key={item.key}
                className={cn(
                  'flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors',
                  panelView === item.key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
                onClick={() => setPanelView(item.key)}
                type="button"
              >
                <item.icon className="size-4" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="p-4">
            <Card size="sm" className="border-transparent bg-accent/60 shadow-none">
              <CardHeader>
                <CardTitle className="text-sm">Production</CardTitle>
                <CardDescription className="text-xs">n8n.miqra.dev</CardDescription>
              </CardHeader>
              <CardContent>
                <Badge variant="success">Live workflows</Badge>
              </CardContent>
            </Card>
          </div>
        </aside>
```

- [ ] **Step 3: Restyle the header (`<header>`) and remove `<ThemeToggle />`**

Replace the entire `<header ...> ... </header>` block (≈ lines 664–738) with the following. This keeps every handler/state reference identical and only changes classes + drops the `<ThemeToggle />` line:
```tsx
          <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-4 py-4 backdrop-blur md:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                    {panelView === 'dashboard' ? 'Dashboard' : panelView === 'shipping' ? 'Rekap Pengiriman' : 'Performance'}
                  </h1>
                  <Badge variant="secondary">pustakaislam.net</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  WhatsApp automation control room for CS operations.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Select value={selectedCsName} onValueChange={(value) => setSelectedCsName(value ?? 'all')}>
                  <SelectTrigger className="h-9 w-[180px]">
                    <SelectValue placeholder="Semua CS" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua CS</SelectItem>
                    {csConfigs.map((config) => (
                      <SelectItem key={config.csName} value={config.csName}>
                        {config.csName.replace(/^CS\s+/i, '')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs text-muted-foreground">
                  <RefreshCw className="size-3.5" />
                  <span>Updated {lastUpdated || '-'}</span>
                </div>
                <button
                  onClick={handleGlobalAiToggle}
                  disabled={actionLoading === 'global' || loading}
                  className={cn(
                    'flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-all duration-200',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    displayGlobalEnabled
                      ? 'border-positive bg-positive-soft text-positive hover:brightness-95'
                      : 'border-border bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {actionLoading === 'global' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : displayGlobalEnabled ? (
                    <Bot className="size-4" />
                  ) : (
                    <BotOff className="size-4" />
                  )}
                  <span>Global AI</span>
                  <span className={cn(
                    'rounded px-1.5 py-0.5 text-xs font-bold',
                    displayGlobalEnabled
                      ? 'bg-positive text-primary-foreground'
                      : 'bg-muted-foreground/15 text-muted-foreground',
                  )}>
                    {displayGlobalEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
            </div>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1 md:hidden">
              {navItems.map((item) => (
                <Badge
                  key={item.key}
                  onClick={() => setPanelView(item.key)}
                  role="button"
                  variant={panelView === item.key ? 'default' : 'secondary'}
                >
                  {item.label}
                </Badge>
              ))}
            </div>
          </header>
```

- [ ] **Step 4: Delete the unused theme toggle**

```bash
git rm components/theme-toggle.tsx
```

- [ ] **Step 5: Confirm no remaining references**

```bash
grep -rn "ThemeToggle\|theme-toggle" app components
```
Expected: no matches.

- [ ] **Step 6: Build to verify**

```bash
npm run build
```
Expected: build completes, no errors (no missing `ThemeToggle` import).

- [ ] **Step 7: Visual review checklist**

`npm run dev` → http://localhost:3000/panel:
- Sidebar: white-ish card panel, brand mark in an indigo rounded square, active nav item filled indigo with white text, inactive items gray → soft indigo hover.
- "Production" card reads as a soft indigo panel with an emerald "Live workflows" badge.
- Header: sticky, light, with a subtle bottom border; title is large/airy; CS selector, "Updated …" chip, and Global AI button aligned right; **no theme toggle present**.
- Global AI button: ON = soft emerald with emerald text + filled emerald "ON" pill; OFF = muted gray.
- Resize narrow (<768px): sidebar hides, the mobile `Badge` nav row appears under the header and switches views.

- [ ] **Step 8: Commit**

```bash
git add app/panel/page.tsx
git commit -m "feat(ui): airy light app shell (sidebar + header), remove theme toggle"
```

---

### Task 5: Login restyle

**Files:**
- Modify: `app/login/page.tsx`

**Interfaces:**
- Consumes: theme tokens (Task 1).
- Produces: a minimalist light login screen. Auth logic (`handleSubmit`, `fetch('/api/auth/login')`, redirect) is unchanged.

- [ ] **Step 1: Replace `app/login/page.tsx` contents**

```tsx
'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Bot } from 'lucide-react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push('/panel');
    } else {
      setError('Password salah');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Bot className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Pustaka<span className="text-primary">Islam</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">CS AI Panel</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-card border border-border rounded-2xl p-7 space-y-5 shadow-sm"
        >
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-background border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
              placeholder="Masukkan password"
              required
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm py-2.5 rounded-xl transition disabled:opacity-50"
          >
            {loading ? 'Masuk...' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify**

```bash
npm run build
```
Expected: build completes, no errors.

- [ ] **Step 3: Visual review**

`npm run dev` → http://localhost:3000/login:
- Centered card on a near-white background, indigo brand mark (Bot icon) in a rounded square, "Pustaka**Islam**" with the second word indigo.
- Password field: light, rounded-xl, focus shows an indigo ring (`focus:ring-primary/20`).
- "Masuk" button is solid indigo with white text; wrong password shows red "Password salah".

- [ ] **Step 4: Run the Convex regression suite (unchanged data layer)**

```bash
npm test
```
Expected: 13/13 pass (no UI change touches Convex).

- [ ] **Step 5: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat(ui): minimalist light login card"
```

---

## Self-Review

**1. Spec coverage:**
- §2 "Light-mode ONLY, no toggle" → Task 1 (drop `.dark`) + Task 2 (drop provider) + Task 4 (drop toggle). ✓
- §2 "Accent indigo/violet + semantic colors" → Task 1 tokens (`--primary`, `--lead`, `--positive`, `--negative`). ✓
- §2 "airy/spacious, soft radius/shadows" → Task 1 (`--radius: 0.75rem`), Task 3 (Card shadow, StatCard), Task 4 (header/sidebar spacing), Task 5. ✓
- §3.1 "single light theme tokens; refine Card/Badge/Button/Tabs/Table + StatCard" → Tasks 1+3; **Tabs** intentionally N/A (no such component — nav restyle in Task 4 covers it; noted in File Structure); Button/Table deferred to 3C alongside their screens (noted). ✓
- §3.2 "AnimatedNumber + highlight" → explicitly deferred to 3B; StatCard exposes the `highlight` prop + `value` slot the mechanism needs. ✓ (boundary stated in Global Constraints)
- §3.3 "shell/nav + header, login" → Tasks 4 + 5. Dashboard/Analytics/Rekap restyle = 3B/3C (out of 3A). ✓
- §4 "data flow unchanged" → no Convex/query edits in any task. ✓
- §6 "verified by build + visual review; one unit test for AnimatedNumber (in 3B)" → testing approach section + per-task build/visual steps. ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" — every code step shows complete content. The "no unit tests in 3A" decision is explicitly justified by the spec, not a placeholder. ✓

**3. Type/name consistency:** `StatCard` prop names (`label`, `value`, `detail`, `icon`, `tone`, `highlight`) and `StatTone` are defined once in Task 3 and referenced consistently in the Interfaces blocks. Tailwind color names (`positive`, `positive-soft`, `lead`, `lead-soft`, `negative`, `negative-soft`, `accent`) defined in Task 1 are used consistently in Tasks 3–4. Badge variants `success`/`info`/`warning` defined in Task 3, `success` consumed in Task 4. ✓

**Note on opacity modifiers:** New soft fills use **solid** `-soft` tokens (no `/opacity` dependency). Pre-existing `/opacity` usages (e.g., `bg-primary/90`, `focus:ring-primary/20`) are left as-is since they already render correctly in the deployed build.
