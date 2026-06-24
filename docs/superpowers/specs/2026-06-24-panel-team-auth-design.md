# Panel Team Auth (internal multi-user login + roles) — Design

**Date:** 2026-06-24
**Status:** Approved (design)

## Goal

Replace the single shared `PANEL_PASSWORD` with **individual email + password logins** for the internal team, plus a simple **two-role** model (admin / cs). Everyone sees the full dashboard; only **admin** can open/change Settings and manage the team. Accounts are created and managed by the admin — no self-signup, no external email/OAuth service.

## Problem

Today the panel uses one shared password (`PANEL_PASSWORD`): middleware checks a `auth_session=1` cookie ([middleware.ts](../../../middleware.ts)), the login route compares against the env password ([app/api/auth/login/route.ts](../../../app/api/auth/login/route.ts)). There is no per-user identity, no roles, no accountability, and no logout. Anyone with the password has full access including Settings.

## Approach (chosen: A — lightweight custom auth on Convex)

A new `users` table in Convex is the source of truth. Login verifies email+password against it and issues a **signed JWT cookie**; middleware verifies the JWT and gates roles. Admin manages users from Settings. Server-side enforcement of admin-only writes reuses the existing **shared-secret** pattern (like `x-wafachat-adapter-secret` in [convex/http.ts](../../../convex/http.ts)).

Rejected: Convex Auth (heavier than needed for ~5–10 internal users; admin-managed-password is against its grain), Clerk/Auth0 (external dependency + cost + data leaves to 3rd party).

---

## 1. Data model — `convex/schema.ts`

```ts
users: defineTable({
  email: v.string(),            // stored lowercased, unique
  name: v.string(),
  passwordHash: v.string(),     // "pbkdf2$<iter>$<saltB64>$<hashB64>"
  role: v.union(v.literal("admin"), v.literal("cs")),
  isActive: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastLoginAt: v.optional(v.number()),
}).index("by_email", ["email"]),
```

## 2. Password hashing — Web Crypto PBKDF2 (no native deps)

`convex/auth.ts` helper (pure Web Crypto `crypto.subtle`, runs in the Convex V8 isolate, edge middleware, and convex-test):

- `hashPassword(plain) -> "pbkdf2$<iter>$<saltB64>$<hashB64>"` — random 16-byte salt, PBKDF2-HMAC-SHA256, 100k iterations, 32-byte derived key.
- `verifyPassword(plain, stored) -> boolean` — re-derive with the stored salt/iter, constant-time compare of the derived bytes.

Rationale: avoids bcrypt's native binding / node-runtime constraints; testable everywhere. PBKDF2-SHA256 at 100k iterations is adequate for an internal tool.

## 3. Session — JWT cookie (`jose`)

- On successful verify, the Next login route signs a JWT (HS256, secret = `PANEL_AUTH_SECRET`) with claims `{ sub: userId, role, name, email }`, 7-day expiry.
- Stored in an `httpOnly`, `sameSite=lax`, `secure` (prod) cookie named `auth_token`.
- `jose` is used in both the Node route (sign) and the edge middleware (verify) — it is Web-Crypto based and edge-compatible.

## 4. Convex functions — `convex/auth.ts` / `convex/users.ts`

All functions require an `authSecret` arg checked against `process.env.PANEL_AUTH_SECRET`. Only the Next server routes hold the secret, so public clients cannot call these even though the functions are public. This mirrors `isAuthorized()` in [convex/http.ts](../../../convex/http.ts).

- `verifyCredentials({ authSecret, email, password })` (mutation — it stamps `lastLoginAt`) → `{ ok, userId?, role?, name?, email? }`. Looks up by `by_email`, rejects inactive users, `verifyPassword` (Web Crypto `deriveBits` works inside a Convex mutation), stamps `lastLoginAt`. Never returns the hash.
- `createUser({ authSecret, email, name, role, password })` (mutation) → hashes, inserts (rejects duplicate email).
- `resetPassword({ authSecret, email, newPassword })` (mutation).
- `setActive({ authSecret, email, isActive })` (mutation).
- `listUsers({ authSecret })` (query) → users without `passwordHash`.
- `seedFirstAdmin({ authSecret, email, name, password })` (mutation) → creates an admin **only if the table is empty** (one-time bootstrap; also the break-glass path if locked out).

## 5. Next API routes (hold the secret; gate by JWT)

- `POST /api/auth/login` — `{ email, password }` → calls `verifyCredentials` → sets `auth_token` cookie.
- `POST /api/auth/logout` — clears the cookie.
- `GET /api/me` — reads/verifies the JWT, returns `{ name, role, email }` (for the header + nav gating).
- `GET/POST /api/admin/users` (+ reset/setActive) — **verify JWT role === "admin"** in the route, then call the secret-gated Convex functions. Non-admin → 403.

## 6. Middleware — `middleware.ts`

- Verify `auth_token` JWT with `jose`. Invalid/expired/missing → redirect `/login`.
- `/panel/settings/**` → require `role === "admin"`, else redirect `/panel`.
- `/` → redirect to `/panel` (valid session) or `/login`.

## 7. UI

- **Login page** ([app/login/page.tsx](../../../app/login/page.tsx)): add an **email** field above password; keep the PustakaIslam branding and styling; inline error on failure.
- **Header** ([app/panel/layout.tsx](../../../app/panel/layout.tsx)): show the logged-in **name + role badge + Logout** button (fetched from `/api/me`). Show the **Settings** nav item only when `role === "admin"`.
- **Settings → "Tim" section** (admin-only): list users (name, email, role, active), **Add user** (email, name, role, initial password), **Reset password**, **Deactivate/Reactivate**. Calls the `/api/admin/users` routes. Styled like the existing Settings cards.

## 8. Admin-only writes — v1 enforcement (accepted trade-off)

The **new** user-management writes are properly server-gated (JWT-admin route + secret-gated Convex).

The **existing** Settings mutations (feature toggles via `csConfigs.upsert`, `setCsAvatar`, `clearCsAvatar`) stay as direct client mutations. For v1 they are gated by **middleware (blocks `/panel/settings` for non-admin) + hiding the UI**. A determined CS could call those mutations directly via the Convex client; this is accepted for a small trusted internal team. **Hardening path (future):** route those through the same secret-gated pattern. Documented, not built in v1.

## 9. Migration / rollout

- Add `PANEL_AUTH_SECRET` env (Vercel: all environments) — a long random value.
- Deploy Convex (schema + auth functions), then `seedFirstAdmin` once via `npx convex run` to create the owner admin account.
- Switch middleware + login to the new flow; **remove `PANEL_PASSWORD`** and the old `auth_session` cookie check. Break-glass = re-run `seedFirstAdmin`/`resetPassword` via CLI.

## 10. Testing

`convex-test` + vitest (edge runtime):
- `hashPassword`/`verifyPassword`: round-trip true; wrong password false; tampered hash false.
- `createUser`: stores lowercased email; duplicate rejected.
- `verifyCredentials`: correct → ok with role/name; wrong password → not ok; inactive user → not ok; unknown email → not ok; wrong `authSecret` → rejected.
- `seedFirstAdmin`: creates when empty; no-op/refuses when users exist.
- `listUsers`: never includes `passwordHash`.
- Build (`npm run build`, EXIT 0) + full `npx vitest run` green before deploy.

## 11. Global constraints

- Convex 1.39, Next.js 14, single light theme, no emoji in UI (icons only).
- Reuse the shared-secret authorization pattern already in `convex/http.ts`.
- Deploy Convex only from `main` after tests + build green (schema + new functions need a deploy).
- Secrets (`PANEL_AUTH_SECRET`) only in env, never echoed or committed.

## Out of scope (YAGNI)

- Self-service signup, email verification, magic links, OAuth/Google.
- Per-user data scoping (everyone sees the full team dashboard).
- Multi-tenant / multiple businesses (separate future project).
- Password-strength meters, 2FA, rate-limiting beyond basic (internal trusted team).
- Hardening existing Settings mutations with the secret-gate (future).
