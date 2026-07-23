# WaFaChat Minimal PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the authenticated WaFaChat panel installable while keeping all business data network-only and showing a focused offline page when navigation loses connectivity.

**Architecture:** Next.js owns the manifest and offline route. A small public service worker precaches only that offline document and PWA assets, deleting old static caches on activation. A client-side panel component registers the worker and exposes the browser's native install prompt only when available.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Lucide, Vitest.

## Global Constraints

- No PWA dependency.
- No cache of Convex, API, order, closing, follow-up, auth, or dashboard responses.
- No Convex, n8n, webhook, notification, or database changes.
- No push notifications.
- Use existing `/icon.png`, `/apple-icon.png`, and WaFaChat brand assets.

---

### Task 1: Add install metadata and offline route

**Files:**
- Create: `app/manifest.ts`
- Create: `app/offline/page.tsx`
- Create: `app/manifest.test.ts`
- Create: `app/offline/page.test.tsx`

**Interfaces:**
- Produces: Next.js manifest at `/manifest.webmanifest` with `name`, `short_name`, `display`, `start_url`, `theme_color`, and two existing PNG icons.
- Produces: static `OfflinePage()` route at `/offline`; it has no data hooks or client-side state.

- [ ] **Step 1: Write failing metadata and route tests**

```tsx
// app/manifest.test.ts
import { expect, test } from 'vitest';
import manifest from './manifest';

test('declares installable WaFaChat metadata', () => {
  expect(manifest()).toMatchObject({
    name: 'WaFaChat',
    short_name: 'WaFaChat',
    start_url: '/panel',
    display: 'standalone',
    theme_color: '#ffffff',
  });
});
```

```tsx
// app/offline/page.test.tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import OfflinePage from './page';

test('shows a connection recovery page without business data', () => {
  const html = renderToStaticMarkup(<OfflinePage />);
  expect(html).toContain('Koneksi terputus');
  expect(html).toContain('Coba lagi');
  expect(html).not.toContain('Leads');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- app/manifest.test.ts app/offline/page.test.tsx`

Expected: FAIL because `manifest.ts` and `/offline` do not exist.

- [ ] **Step 3: Add the minimal manifest and static offline route**

```ts
// app/manifest.ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'WaFaChat',
    short_name: 'WaFaChat',
    description: 'WaFaChat CS Control Panel',
    start_url: '/panel',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  };
}
```

```tsx
// app/offline/page.tsx
export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-center text-foreground">
      <section className="max-w-sm space-y-3">
        <h1 className="text-2xl font-semibold">Koneksi terputus</h1>
        <p className="text-sm text-muted-foreground">Periksa internet, lalu buka kembali WaFaChat.</p>
        <a className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground" href="/panel">Coba lagi</a>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run focused tests**

Run: `npm test -- app/manifest.test.ts app/offline/page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/manifest.ts app/offline/page.tsx app/manifest.test.ts app/offline/page.test.tsx
git commit -m "feat: add PWA manifest and offline page"
```

### Task 2: Add a network-only service worker

**Files:**
- Create: `public/sw.js`

**Interfaces:**
- Consumes: `/offline`, `/manifest.webmanifest`, `/icon.png`, `/apple-icon.png`.
- Produces: `sw.js` that caches only those static URLs; failed document navigations receive cached `/offline`.

- [ ] **Step 1: Add service worker with static-cache-only policy**

```js
const CACHE = 'wafachat-static-v1';
const STATIC_URLS = ['/offline', '/manifest.webmanifest', '/icon.png', '/apple-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline')));
});
```

- [ ] **Step 2: Run a syntax check**

Run: `node --check public/sw.js`

Expected: exit code 0.

- [ ] **Step 3: Verify cache policy manually**

Run: Open Chrome DevTools → Application → Service Workers, then Application → Cache Storage.

Expected: only `wafachat-static-v1` exists and contains the four static URLs; no `/api/*`, Convex, or panel-data response is cached.

- [ ] **Step 4: Commit**

```bash
git add public/sw.js
git commit -m "feat: add network-only PWA service worker"
```

### Task 3: Register the worker and expose install action

**Files:**
- Create: `components/panel/pwa-install.tsx`
- Modify: `app/panel/layout.tsx:5-12,73-103`

**Interfaces:**
- Produces: `PwaInstallButton()`; returns `null` until a supported browser dispatches `beforeinstallprompt`, then renders a standard sidebar button.
- Consumes: browser `navigator.serviceWorker`, `beforeinstallprompt`, and `appinstalled` events only in `useEffect`.

- [ ] **Step 1: Add the client component**

```tsx
'use client';

import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function PwaInstallButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    navigator.serviceWorker?.register('/sw.js').catch(() => undefined);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!prompt) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await prompt.prompt();
        await prompt.userChoice;
        setPrompt(null);
      }}
      className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <Download className="size-4" />
      <span>Install WaFaChat</span>
    </button>
  );
}
```

- [ ] **Step 2: Insert the sidebar action without changing navigation or data hooks**

```tsx
import { PwaInstallButton } from '@/components/panel/pwa-install';

// In PanelShell, directly after </nav> and before the existing {isCs && ...} logout block:
<div className="px-4 pb-2">
  <PwaInstallButton />
</div>
```

- [ ] **Step 3: Run typecheck, tests, and production build**

Run: `npx tsc --noEmit && npm test && npm run build`

Expected: all commands exit 0.

- [ ] **Step 4: Verify install and offline behavior in Chrome**

Run: Open `/panel`, wait for the sidebar install action, install WaFaChat, then enable DevTools Network → Offline and navigate to `/panel`.

Expected: installed app launches standalone; offline navigation shows `/offline`; restoring network and reloading shows live Convex data again.

- [ ] **Step 5: Commit**

```bash
git add components/panel/pwa-install.tsx app/panel/layout.tsx
git commit -m "feat: add PWA install action"
```

## Plan Self-Review

- Scope coverage: manifest, installation, static offline fallback, no data caching, no push notifications, and verification are covered.
- No placeholders: every code-changing step names exact files and implementation.
- Type consistency: `PwaInstallButton` is the sole exported install UI and is mounted only inside the client `PanelShell`.
