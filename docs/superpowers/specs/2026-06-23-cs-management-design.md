# CS Management (Profile Photos + Settings + Filter Fix) — Design

**Date:** 2026-06-23
**Status:** Approved (design)

## Goal

Give the panel a single, correct notion of "who the CS are," then build on it: (a) a Settings page where each CS can have a profile photo uploaded and their feature toggles managed, and (b) a CS filter that lists **every** CS in the data and actually filters every view.

## Problem

- The header CS filter is populated from `csConfigs.list`, which returns a curated default list (`CS Aisyah`, `CS Risma`, `CS Lila`, `CS Azela`). The **data** uses different forms (`Aisyah`, `Risma`, `Lila`, `Azelia`, `Nabila`). Result: most CS never appear, and selecting one (e.g. `CS Aisyah`) returns empty/partial data because of the name mismatch.
- Two Performance queries — `getCsLeaderboard` and `getProductDifficulty` — take no `csName` arg, so the Performance tab ignores the filter entirely.
- There is no UI to manage CS, and no way to set a CS profile photo (`CsAvatar` already accepts an optional `src`, but nothing supplies it).

## Approach (chosen: A — data-derived registry + config overlay)

A new query is the single source of truth for the CS list. It derives CS from real data and overlays per-CS settings from `csConfigs`. Both the filter dropdown and the Settings page consume it. Photos live in Convex file storage, referenced from `csConfigs`.

---

## 1. CS Registry — `convex/cs.ts` → `listCs`

A `query` returning the unified CS list.

- Scan `orders` over the last 90 days via the `by_createdAt` index (bounded), collect distinct `assignedCsName`, key by `normalizeCsName`.
- Union with all `csConfigs` rows (so a configured CS with no recent orders still appears).
- For each `normalizedName`, resolve a display name: the stored `csConfigs.csName` if present, else the most-common raw form seen in data.
- Resolve `avatarStorageId` → URL via `ctx.storage.getUrl(storageId)` (null if unset).

**Return shape (per CS):**
```ts
{
  csName: string;          // display name
  normalizedName: string;  // stable key
  avatarUrl: string | null;
  isActive: boolean;
  orderAutomationEnabled: boolean;
  aiAssistantEnabled: boolean;
  reportingEnabled: boolean;
  csPhone?: string;
}
```
Internal-test phones / `normalizeCsName` "Unknown" rows are excluded from the registry.

---

## 2. Filter fix (4b)

- **Dropdown source:** header in `app/panel/layout.tsx` switches from `api.csConfigs.list` to `api.cs.listCs`. Display strips a leading `CS ` as today. The filter value remains the display `csName` (no contract change for consumers).
- **Add `csName` to the two queries that ignore it:** `getCsLeaderboard` and `getProductDifficulty` (`convex/analytics.ts`). When set, they filter orders/recaps by `normalizeCsName(record.assignedCsName | record.csName) === normalizeCsName(csName)` — the same predicate the other queries use.
- **Normalize on both sides everywhere:** audit the existing `csName`-aware queries (`getDashboardSummary`, `getTrend`, `getDuplicateOrders`, `getResponseTimes`, `getPerformance`) to confirm they compare via `normalizeCsName`. Fix any that compare raw strings. This is what makes `CS Aisyah` match `Aisyah` and restores the missing omzet/closing when a CS is selected.

No view should silently ignore the filter after this.

---

## 3. Settings page (4a + CS management)

- **Route:** `app/panel/settings/page.tsx`, behind the existing panel login (same middleware). No per-user roles — single shared password.
- **Nav:** add "Settings" (gear icon) to the sidebar and the mobile bottom nav in `app/panel/layout.tsx`.
- **Content:** a list of all CS from `listCs`. Each row:
  - Avatar (photo if set, else initials) + display name.
  - **Upload foto** button (see §4).
  - Toggles: **Otomasi Order**, **AI Assistant**, **Reporting**, **Aktif** — each writes via the existing `csConfigs.upsert` mutation (passing the full current config + the changed field).
  - CS phone shown read-only (informational).
- Loading / empty / error states styled like the rest of the panel.

---

## 4. Photo upload (Convex file storage)

Flow:
1. `convex/cs.ts → generateUploadUrl` (mutation) returns a short-lived upload URL (`ctx.storage.generateUploadUrl()`).
2. Browser **resizes/compresses** the chosen image to ~256×256 (canvas, JPEG/PNG) to keep avatars tiny, then `POST`s the blob to the upload URL → receives `{ storageId }`.
3. `convex/cs.ts → setCsAvatar({ csName, storageId })` (mutation) upserts `csConfigs` by `normalizedName`, setting `avatarStorageId`. Deletes the previous `avatarStorageId` from storage if one existed (no orphan files).
4. `listCs` resolves `avatarStorageId` → `avatarUrl`.

**Wiring photos into avatars:** pages that render CS avatars (`app/panel/page.tsx`, `components/panel/daily-report-dashboard.tsx`, `app/panel/performance/page.tsx` → `performance-panel.tsx`) fetch `listCs` once, build a `Map<normalizedName, avatarUrl>`, and pass `src` into each `CsAvatar`. `CsAvatar` already supports `src` with initials fallback — no component change needed beyond threading the prop.

Constraints: accept common image types; cap pre-resize size client-side (e.g. reject > 8 MB); the resize keeps stored files small regardless.

---

## 5. Schema change

`convex/schema.ts` — `csConfigs` gains:
```ts
avatarStorageId: v.optional(v.id("_storage")),
```
Additive/optional → no migration needed.

---

## 6. Error handling

- Upload failure (network / blocked context): inline error on the row, no `window.alert`.
- `generateUploadUrl` / `setCsAvatar` are mutations behind the panel login; invalid `csName` is upserted as a new config row (consistent with existing `upsert`).
- `listCs` resolves a missing/expired `avatarStorageId` to `null` (initials fallback) rather than throwing.

## 7. Testing

`convex-test` + vitest (edge runtime):
- `listCs`: union of data-CS + config-CS, normalization collapses `CS Aisyah`/`Aisyah`, excludes internal-test phones, resolves avatar URL when set.
- `setCsAvatar`: upserts `avatarStorageId`; replacing a photo removes the old storage object.
- Filter: `getCsLeaderboard` and `getProductDifficulty` with `csName` return only that CS; without it, unchanged.
- Regression: existing `csName`-aware queries still match after the normalization audit.

Build (`npm run build`, EXIT 0) + full `npx vitest run` green before deploy.

## 8. Global constraints

- Convex 1.39, Next.js 14, single light theme, no emoji in UI (icons only).
- Deploy Convex only from `main` after tests + build green (schema + new queries + filter changes need a deploy).
- Presentation stays consistent with the existing design system (cards, tiles, CR colors, avatars).

## Out of scope (YAGNI)

- Per-user accounts / roles.
- Editing CS display names or merging typo'd name variants (normalization handles the common cases).
- Image cropping UI (center-fit resize only).
