# WaFaChat Branding Refresh Design

**Date:** 2026-07-18
**Status:** Approved for implementation planning

## Goal

Make WaFaChat the sole product identity throughout the application so the interface is ready for multiple SaaS tenants. Remove Pustaka Islam branding because it represents a client, not the platform.

## Source Assets

- `assets/logo/logo-apps-1.png`: WaFaChat app mark.
- `assets/logo/logo-apps-2.png`: WaFaChat horizontal wordmark.

The supplied images are the visual source of truth. Derived assets must preserve the original mark, typography, colors, proportions, and internal white details.

## Asset Processing

Create production-ready transparent PNG derivatives from the supplied raster files. Remove only the near-white background connected to the outer image boundary so the white `W` inside the dark speech bubble remains opaque. Crop excess transparent whitespace while retaining consistent breathing room.

Generate the following roles:

- A transparent app mark for compact product branding.
- A transparent horizontal wordmark for wide placements.
- A square favicon/app icon derived from the app mark.
- An Apple touch icon derived from the app mark.

Do not use generative image editing or redraw the logo as SVG. Deterministic processing avoids visual drift from the approved brand source.

## Interface Placement

### Login

Replace the existing Bot icon and Pustaka Islam heading with the WaFaChat horizontal wordmark. Keep the existing `CS AI Panel` descriptor and login form behavior.

### Desktop Sidebar

Replace the Bot icon plus text-based WaFaChat lockup with the horizontal WaFaChat wordmark. The wordmark must fit the current sidebar without distorting its aspect ratio.

### Panel Header

Remove the Pustaka Islam logo and the `via WaFaChat` text. Show a compact WaFaChat brand treatment using the new assets without competing with the current page title or filters.

### Mobile

Preserve the current bottom navigation and available viewport space. Do not add a large wordmark to the mobile navigation. Mobile browsers receive the new identity through metadata and favicon; compact in-page branding may use the app mark where already appropriate.

## Application Metadata

Keep the product title `WaFaChat` and description `WaFaChat CS Control Panel`. Register the new favicon and Apple touch icon explicitly through Next.js metadata/file conventions so browser tabs, bookmarks, and supported home-screen installations use the new app mark.

## Accessibility and Rendering

- Every visible logo image has meaningful `alt` text (`WaFaChat`).
- Decorative duplicate marks use empty alternative text when appropriate.
- Images retain their intrinsic aspect ratio.
- Transparent edges must not show a white rectangle or obvious white fringe on the application's background.
- Assets must remain legible at favicon size and on the existing light application surfaces.

## Verification

1. Confirm all Pustaka Islam visual references are removed from runtime UI code.
2. Confirm generated PNGs have an alpha channel, transparent corners, and preserved opaque white logo details.
3. Confirm favicon and Apple icon metadata resolve to the new assets.
4. Run the production build.
5. Visually inspect login and panel layouts at desktop and mobile viewport widths.

## Out of Scope

- Tenant-specific runtime branding or white-label configuration.
- Redesigning the WaFaChat logo.
- Changing the application color system or general layout.
- Removing historical references to Pustaka Islam from internal documentation or tenant data.
