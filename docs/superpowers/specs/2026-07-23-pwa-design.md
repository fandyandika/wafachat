# WaFaChat Minimal PWA Design

## Goal

Make WaFaChat installable on supported mobile and desktop browsers while keeping dashboard data online-only and Convex usage unchanged.

## Scope

- Add a web app manifest using existing WaFaChat icon assets.
- Register one small service worker from the authenticated panel.
- Cache only the offline document and static branding assets required for PWA installation.
- On a navigation failure caused by no connection, show a static Indonesian offline page.
- Add an "Install WaFaChat" sidebar action when the browser exposes the install prompt; remove it after installation.
- On service-worker activation, delete every named cache except its current static-cache version; never retain dashboard or API responses.

## Non-goals

- No push notifications.
- No caching or offline display of Convex, API, order, closing, follow-up, or authentication data.
- No database, webhook, n8n, notification, or Convex-query changes.
- No new PWA dependency.

## Architecture

Next.js serves `app/manifest.ts` and the existing icon assets. A small client component registers `public/sw.js` after the panel loads and owns the browser's `beforeinstallprompt` event. The service worker precaches the static offline page and manifest assets only, then falls back to the offline page when a document navigation cannot reach the network. All successful dashboard navigation and all data requests remain network-only.

## UX

- Eligible browsers show an "Install WaFaChat" action in the panel sidebar.
- Clicking it opens the native browser install prompt.
- The action disappears after installation or when the browser does not offer installation.
- Offline navigation displays a focused connection-recovery page with a retry action.
- iOS Safari continues to use its native Share > Add to Home Screen flow because Safari does not expose `beforeinstallprompt`.

## Verification

- `npm run build` completes.
- Chrome Application panel recognizes a valid manifest and active service worker.
- Installation opens WaFaChat in standalone mode with WaFaChat name and icons.
- With DevTools Offline enabled, navigation reaches the offline page and no stale metric/order data is visible.
- Restoring connectivity and reloading returns to the normal authenticated panel.
