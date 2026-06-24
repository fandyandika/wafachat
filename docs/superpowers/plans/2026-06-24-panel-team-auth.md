# Panel Team Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single shared `PANEL_PASSWORD` with individual email+password logins, a two-role model (admin/cs), and admin-managed user accounts.

**Architecture:** A Convex `users` table is the source of truth. Login verifies email+password (PBKDF2 via Web Crypto) and issues a signed JWT cookie (`jose`); middleware verifies the JWT and gates `/panel/settings` to admins. Admin-only Convex writes are protected by a shared-secret arg (the `PANEL_AUTH_SECRET` env), the same pattern as `convex/http.ts`.

**Tech Stack:** Convex 1.39, Next.js 14 (App Router), TypeScript, `jose` (JWT), Web Crypto PBKDF2 (no native dep), vitest + convex-test (edge runtime).

## Global Constraints

- Convex 1.39, Next.js 14, single light theme, **no emoji in UI** (lucide icons only).
- Secrets only in env (`PANEL_AUTH_SECRET`), never echoed/committed.
- Reuse the shared-secret authorization pattern from `convex/http.ts` (`isAuthorized`).
- Deploy Convex only from `main` after `npm run build` (EXIT 0) + `npx vitest run` green.
- cwd resets between commands → prefix every shell command with `cd /f/Projects/whatsapp_cs_automotion/wafachat &&`.
- Repo Fact-Forcing Gate: before each Write/Edit/Bash, state importers, affected public functions, data fields, and quote the user instruction verbatim.

## File Structure

- `convex/schema.ts` (modify) — add `users` table + `by_email` index.
- `convex/passwordHash.ts` (create) — pure PBKDF2 `hashPassword`/`verifyPassword` (Web Crypto).
- `convex/auth.ts` (create) — Convex functions: `verifyCredentials`, `createUser`, `resetPassword`, `setActive`, `listUsers`, `seedFirstAdmin` (all secret-gated).
- `convex/passwordHash.test.ts`, `convex/auth.test.ts` (create) — unit tests.
- `lib/auth-jwt.ts` (create) — `signSession`/`verifySession` (jose), `routeGuard` pure helper.
- `lib/auth-jwt.test.ts` (create) — JWT round-trip + routeGuard tests.
- `app/api/auth/login/route.ts` (modify) — email+password → verifyCredentials → set cookie.
- `app/api/auth/logout/route.ts` (create) — clear cookie.
- `app/api/me/route.ts` (create) — return `{name, role, email}` from JWT.
- `app/api/admin/users/route.ts` (create) — GET list / POST create+reset+setActive, JWT-admin gated.
- `middleware.ts` (modify) — JWT verify + role-gate, drop `auth_session`.
- `app/login/page.tsx` (modify) — add email field.
- `app/panel/layout.tsx` (modify) — header identity + logout + role-gated Settings nav.
- `components/panel/settings-dashboard.tsx` (modify) — admin "Tim" user-management section.

---

### Task 1: users schema + PBKDF2 hashing + Convex auth functions

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/passwordHash.ts`, `convex/passwordHash.test.ts`
- Create: `convex/auth.ts`, `convex/auth.test.ts`

**Interfaces:**
- Consumes: nothing (foundation).
- Produces:
  - `hashPassword(plain: string): Promise<string>` → `"pbkdf2$<iter>$<saltB64>$<hashB64>"`
  - `verifyPassword(plain: string, stored: string): Promise<boolean>`
  - `api.auth.verifyCredentials({authSecret, email, password})` (mutation) → `{ok: boolean, userId?: string, role?: "admin"|"cs", name?: string, email?: string}`
  - `api.auth.createUser({authSecret, email, name, role, password})` → `{ok: boolean, error?: string}`
  - `api.auth.resetPassword({authSecret, email, newPassword})` → `{ok, error?}`
  - `api.auth.setActive({authSecret, email, isActive})` → `{ok, error?}`
  - `api.auth.listUsers({authSecret})` (query) → `Array<{email, name, role, isActive, lastLoginAt?}>` (no hash)
  - `api.auth.seedFirstAdmin({authSecret, email, name, password})` → `{ok, error?}`

- [ ] **Step 1: Add the `users` table to the schema**

In `convex/schema.ts`, add inside `defineSchema({ ... })`:

```ts
  users: defineTable({
    email: v.string(),
    name: v.string(),
    passwordHash: v.string(),
    role: v.union(v.literal("admin"), v.literal("cs")),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  }).index("by_email", ["email"]),
```

- [ ] **Step 2: Write the failing password-hash test**

Create `convex/passwordHash.test.ts`:

```ts
import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./passwordHash";

test("hashPassword/verifyPassword round-trips and rejects wrong password", async () => {
  const stored = await hashPassword("s3cret-pw");
  expect(stored.startsWith("pbkdf2$")).toBe(true);
  expect(await verifyPassword("s3cret-pw", stored)).toBe(true);
  expect(await verifyPassword("wrong", stored)).toBe(false);
});

test("verifyPassword returns false on malformed/tampered hash", async () => {
  expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  const stored = await hashPassword("abc");
  const tampered = stored.slice(0, -2) + "00";
  expect(await verifyPassword("abc", tampered)).toBe(false);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/passwordHash.test.ts`
Expected: FAIL (cannot find module `./passwordHash`).

- [ ] **Step 4: Implement the PBKDF2 helpers**

Create `convex/passwordHash.ts`:

```ts
// PBKDF2-HMAC-SHA256 password hashing using Web Crypto only — runs in the
// Convex V8 isolate, Next edge middleware, and convex-test (edge runtime).
const ITER = 100_000;
const KEYLEN_BITS = 256;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function derive(plain: string, salt: Uint8Array, iter: number, bits: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(plain), "PBKDF2", false, ["deriveBits"]);
  const out = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, key, bits);
  return new Uint8Array(out);
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(plain, salt, ITER, KEYLEN_BITS);
  return `pbkdf2$${ITER}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iter = parseInt(parts[1], 10);
  if (!Number.isFinite(iter) || iter <= 0) return false;
  let salt: Uint8Array, expected: Uint8Array;
  try {
    salt = fromB64(parts[2]);
    expected = fromB64(parts[3]);
  } catch {
    return false;
  }
  const got = await derive(plain, salt, iter, expected.length * 8);
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
  return diff === 0;
}
```

- [ ] **Step 5: Run the password-hash test to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/passwordHash.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the failing auth-functions test**

Create `convex/auth.test.ts`:

```ts
import { convexTest } from "convex-test";
import { beforeEach, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const SECRET = "test-auth-secret";
beforeEach(() => {
  process.env.PANEL_AUTH_SECRET = SECRET;
});

test("seedFirstAdmin creates an admin only when the table is empty", async () => {
  const t = convexTest(schema);
  expect((await t.mutation(api.auth.seedFirstAdmin, { authSecret: SECRET, email: "Owner@x.com", name: "Owner", password: "pw1" })).ok).toBe(true);
  const again = await t.mutation(api.auth.seedFirstAdmin, { authSecret: SECRET, email: "Two@x.com", name: "Two", password: "pw2" });
  expect(again.ok).toBe(false);
  const users = await t.query(api.auth.listUsers, { authSecret: SECRET });
  expect(users).toHaveLength(1);
  expect(users[0].email).toBe("owner@x.com"); // lowercased
  expect(users[0].role).toBe("admin");
  expect((users[0] as Record<string, unknown>).passwordHash).toBeUndefined();
});

test("verifyCredentials: correct password ok; wrong/inactive/unknown not ok", async () => {
  const t = convexTest(schema);
  await t.mutation(api.auth.seedFirstAdmin, { authSecret: SECRET, email: "owner@x.com", name: "Owner", password: "ownerpw" });
  await t.mutation(api.auth.createUser, { authSecret: SECRET, email: "Risma@x.com", name: "Risma", role: "cs", password: "rismapw" });

  const good = await t.mutation(api.auth.verifyCredentials, { authSecret: SECRET, email: "risma@x.com", password: "rismapw" });
  expect(good.ok).toBe(true);
  expect(good.role).toBe("cs");
  expect(good.name).toBe("Risma");

  expect((await t.mutation(api.auth.verifyCredentials, { authSecret: SECRET, email: "risma@x.com", password: "nope" })).ok).toBe(false);
  expect((await t.mutation(api.auth.verifyCredentials, { authSecret: SECRET, email: "ghost@x.com", password: "x" })).ok).toBe(false);

  await t.mutation(api.auth.setActive, { authSecret: SECRET, email: "risma@x.com", isActive: false });
  expect((await t.mutation(api.auth.verifyCredentials, { authSecret: SECRET, email: "risma@x.com", password: "rismapw" })).ok).toBe(false);
});

test("createUser rejects duplicate email; resetPassword changes the password", async () => {
  const t = convexTest(schema);
  await t.mutation(api.auth.createUser, { authSecret: SECRET, email: "a@x.com", name: "A", role: "cs", password: "old" });
  expect((await t.mutation(api.auth.createUser, { authSecret: SECRET, email: "A@x.com", name: "A2", role: "cs", password: "y" })).ok).toBe(false);
  await t.mutation(api.auth.resetPassword, { authSecret: SECRET, email: "a@x.com", newPassword: "new" });
  expect((await t.mutation(api.auth.verifyCredentials, { authSecret: SECRET, email: "a@x.com", password: "new" })).ok).toBe(true);
  expect((await t.mutation(api.auth.verifyCredentials, { authSecret: SECRET, email: "a@x.com", password: "old" })).ok).toBe(false);
});

test("wrong authSecret is rejected", async () => {
  const t = convexTest(schema);
  await expect(t.query(api.auth.listUsers, { authSecret: "wrong" })).rejects.toThrow();
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/auth.test.ts`
Expected: FAIL (cannot find `api.auth.*`).

- [ ] **Step 8: Implement the Convex auth functions**

Create `convex/auth.ts`:

```ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hashPassword, verifyPassword } from "./passwordHash";

const roleValidator = v.union(v.literal("admin"), v.literal("cs"));

function checkSecret(authSecret: string) {
  const expected = process.env.PANEL_AUTH_SECRET;
  if (!expected || authSecret !== expected) throw new Error("unauthorized");
}
function normEmail(email: string) {
  return email.trim().toLowerCase();
}

export const verifyCredentials = mutation({
  args: { authSecret: v.string(), email: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    checkSecret(args.authSecret);
    const email = normEmail(args.email);
    const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).unique();
    if (!user || !user.isActive) return { ok: false as const };
    if (!(await verifyPassword(args.password, user.passwordHash))) return { ok: false as const };
    await ctx.db.patch(user._id, { lastLoginAt: Date.now() });
    return { ok: true as const, userId: user._id, role: user.role, name: user.name, email: user.email };
  },
});

export const createUser = mutation({
  args: { authSecret: v.string(), email: v.string(), name: v.string(), role: roleValidator, password: v.string() },
  handler: async (ctx, args) => {
    checkSecret(args.authSecret);
    const email = normEmail(args.email);
    const existing = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).unique();
    if (existing) return { ok: false as const, error: "email already exists" };
    const now = Date.now();
    await ctx.db.insert("users", {
      email, name: args.name, passwordHash: await hashPassword(args.password),
      role: args.role, isActive: true, createdAt: now, updatedAt: now,
    });
    return { ok: true as const };
  },
});

export const resetPassword = mutation({
  args: { authSecret: v.string(), email: v.string(), newPassword: v.string() },
  handler: async (ctx, args) => {
    checkSecret(args.authSecret);
    const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", normEmail(args.email))).unique();
    if (!user) return { ok: false as const, error: "not found" };
    await ctx.db.patch(user._id, { passwordHash: await hashPassword(args.newPassword), updatedAt: Date.now() });
    return { ok: true as const };
  },
});

export const setActive = mutation({
  args: { authSecret: v.string(), email: v.string(), isActive: v.boolean() },
  handler: async (ctx, args) => {
    checkSecret(args.authSecret);
    const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", normEmail(args.email))).unique();
    if (!user) return { ok: false as const, error: "not found" };
    await ctx.db.patch(user._id, { isActive: args.isActive, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

export const listUsers = query({
  args: { authSecret: v.string() },
  handler: async (ctx, args) => {
    checkSecret(args.authSecret);
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({ email: u.email, name: u.name, role: u.role, isActive: u.isActive, lastLoginAt: u.lastLoginAt }));
  },
});

export const seedFirstAdmin = mutation({
  args: { authSecret: v.string(), email: v.string(), name: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    checkSecret(args.authSecret);
    const any = await ctx.db.query("users").take(1);
    if (any.length > 0) return { ok: false as const, error: "users already exist" };
    const now = Date.now();
    await ctx.db.insert("users", {
      email: normEmail(args.email), name: args.name, passwordHash: await hashPassword(args.password),
      role: "admin", isActive: true, createdAt: now, updatedAt: now,
    });
    return { ok: true as const };
  },
});
```

- [ ] **Step 9: Run codegen + the auth tests to verify they pass**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx convex codegen && npx vitest run convex/auth.test.ts convex/passwordHash.test.ts`
Expected: PASS (all tests).

- [ ] **Step 10: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/schema.ts convex/passwordHash.ts convex/passwordHash.test.ts convex/auth.ts convex/auth.test.ts convex/_generated && git commit -m "feat(auth): users table + PBKDF2 hashing + secret-gated Convex auth functions"
```

---

### Task 2: JWT session helpers + login/logout/me routes

**Files:**
- Modify: `package.json` (add `jose`)
- Create: `lib/auth-jwt.ts`, `lib/auth-jwt.test.ts`
- Modify: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`, `app/api/me/route.ts`

**Interfaces:**
- Consumes: `api.auth.verifyCredentials` (Task 1).
- Produces:
  - `signSession(s: Session): Promise<string>`, `verifySession(token?: string): Promise<Session | null>` where `Session = { userId: string; role: "admin"|"cs"; name: string; email: string }`
  - `routeGuard(pathname: string, session: Session | null): { redirect: string | null }`
  - Cookie `auth_token` (httpOnly JWT). `GET /api/me` → `{ name, role, email } | 401`.

- [ ] **Step 1: Install jose**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm install jose`
Expected: `jose` added to dependencies, EXIT 0.

- [ ] **Step 2: Write the failing JWT + routeGuard test**

Create `lib/auth-jwt.test.ts`:

```ts
import { beforeEach, expect, test } from "vitest";
import { signSession, verifySession, routeGuard, type Session } from "./auth-jwt";

beforeEach(() => { process.env.PANEL_AUTH_SECRET = "test-auth-secret"; });
const admin: Session = { userId: "u1", role: "admin", name: "Owner", email: "o@x.com" };
const cs: Session = { userId: "u2", role: "cs", name: "Risma", email: "r@x.com" };

test("signSession/verifySession round-trips; tampered/empty -> null", async () => {
  const token = await signSession(cs);
  const back = await verifySession(token);
  expect(back?.email).toBe("r@x.com");
  expect(back?.role).toBe("cs");
  expect(await verifySession(token + "x")).toBeNull();
  expect(await verifySession(undefined)).toBeNull();
});

test("routeGuard: unauthenticated -> /login; cs hitting settings -> /panel; allowed -> null", () => {
  expect(routeGuard("/panel", null).redirect).toBe("/login");
  expect(routeGuard("/panel/settings", cs).redirect).toBe("/panel");
  expect(routeGuard("/panel/settings", admin).redirect).toBeNull();
  expect(routeGuard("/panel", cs).redirect).toBeNull();
  expect(routeGuard("/", admin).redirect).toBe("/panel");
  expect(routeGuard("/", null).redirect).toBe("/login");
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run lib/auth-jwt.test.ts`
Expected: FAIL (cannot find module `./auth-jwt`).

- [ ] **Step 4: Implement the JWT + routeGuard helpers**

Create `lib/auth-jwt.ts`:

```ts
import { SignJWT, jwtVerify } from "jose";

export type Session = { userId: string; role: "admin" | "cs"; name: string; email: string };

function key(): Uint8Array {
  const secret = process.env.PANEL_AUTH_SECRET;
  if (!secret) throw new Error("PANEL_AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ userId: s.userId, role: s.role, name: s.name, email: s.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key());
}

export async function verifySession(token?: string): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const { userId, role, name, email } = payload as Record<string, unknown>;
    if (typeof userId !== "string" || (role !== "admin" && role !== "cs") || typeof name !== "string" || typeof email !== "string") {
      return null;
    }
    return { userId, role, name, email };
  } catch {
    return null;
  }
}

export function routeGuard(pathname: string, session: Session | null): { redirect: string | null } {
  if (pathname === "/") return { redirect: session ? "/panel" : "/login" };
  if (pathname.startsWith("/panel")) {
    if (!session) return { redirect: "/login" };
    if (pathname.startsWith("/panel/settings") && session.role !== "admin") return { redirect: "/panel" };
  }
  return { redirect: null };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run lib/auth-jwt.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Rewrite the login route for email+password**

Replace `app/api/auth/login/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { signSession } from '@/lib/auth-jwt';

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await convex.mutation(api.auth.verifyCredentials, {
    authSecret: process.env.PANEL_AUTH_SECRET!,
    email: String(email),
    password: String(password),
  });
  if (!result.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = await signSession({ userId: result.userId!, role: result.role!, name: result.name!, email: result.email! });
  const res = NextResponse.json({ ok: true });
  res.cookies.set('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  return res;
}
```

- [ ] **Step 7: Create the logout route**

Create `app/api/auth/logout/route.ts`:

```ts
import { NextResponse } from 'next/server';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('auth_token', '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
```

- [ ] **Step 8: Create the /api/me route**

Create `app/api/me/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth-jwt';

export async function GET(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ name: session.name, role: session.role, email: session.email });
}
```

- [ ] **Step 9: Build to verify routes compile**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build`
Expected: EXIT 0 (build needs `NEXT_PUBLIC_CONVEX_URL`; it is configured in the environment).

- [ ] **Step 10: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add package.json package-lock.json lib/auth-jwt.ts lib/auth-jwt.test.ts app/api/auth/login/route.ts app/api/auth/logout/route.ts app/api/me/route.ts && git commit -m "feat(auth): jose JWT session helpers + email/password login, logout, /api/me"
```

---

### Task 3: middleware JWT verification + role gating

**Files:**
- Modify: `middleware.ts`

**Interfaces:**
- Consumes: `verifySession`, `routeGuard` (Task 2).
- Produces: `/panel/**` requires a valid JWT; `/panel/settings/**` requires `role === "admin"`.

- [ ] **Step 1: Replace middleware with JWT + routeGuard logic**

Replace `middleware.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { verifySession, routeGuard } from '@/lib/auth-jwt';

export async function middleware(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  const { redirect } = routeGuard(req.nextUrl.pathname, session);
  if (redirect) return NextResponse.redirect(new URL(redirect, req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/panel/:path*'],
};
```

- [ ] **Step 2: Build to verify middleware compiles (edge runtime)**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build`
Expected: EXIT 0, no edge-runtime import errors (jose is edge-compatible).

- [ ] **Step 3: Run the full test suite (routeGuard already covers the logic)**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run`
Expected: PASS (all tests, including `lib/auth-jwt.test.ts` routeGuard cases).

- [ ] **Step 4: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add middleware.ts && git commit -m "feat(auth): JWT middleware with admin role-gate on /panel/settings"
```

---

### Task 4: Login page — email + password

**Files:**
- Modify: `app/login/page.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/login` `{ email, password }` (Task 2).
- Produces: login form collecting email + password.

- [ ] **Step 1: Add an email field and send both fields**

In `app/login/page.tsx`: add `const [email, setEmail] = useState('');`. In `handleSubmit`, change the body to `JSON.stringify({ email, password })`. Add an email input above the password input, matching the existing input styling:

```tsx
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-background border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
              placeholder="nama@email.com"
              autoComplete="email"
              required
            />
          </div>
```

Update the error copy to `'Email atau password salah'`.

- [ ] **Step 2: Build to verify the page compiles**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add app/login/page.tsx && git commit -m "feat(auth): login page collects email + password"
```

---

### Task 5: Header identity + logout + role-gated Settings nav

**Files:**
- Modify: `app/panel/layout.tsx`

**Interfaces:**
- Consumes: `GET /api/me` → `{ name, role, email }` (Task 2); `POST /api/auth/logout` (Task 2).
- Produces: header shows user name + role + Logout; Settings nav item visible only for admins.

- [ ] **Step 1: Fetch the current user and gate the nav + add logout**

In `app/panel/layout.tsx`, inside `PanelShell`:

Add to the existing react import: `useEffect`. Add to the lucide import: `LogOut`.

Add state + fetch + helpers (near the other hooks in `PanelShell`):

```tsx
  const [me, setMe] = useState<{ name: string; role: 'admin' | 'cs' } | null>(null);
  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then(setMe).catch(() => setMe(null));
  }, []);
  const navItems = NAV.filter((n) => n.href !== '/panel/settings' || me?.role === 'admin');
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }
```

Replace both `NAV.map(...)` usages (sidebar nav and mobile bottom nav) with `navItems.map(...)`.

In the header's right-hand controls container (`<div className="flex flex-wrap items-center gap-3">`), append a user block as the last child:

```tsx
                {me && (
                  <div className="flex items-center gap-2 border-l border-border pl-3">
                    <div className="hidden text-right sm:block">
                      <div className="text-sm font-medium leading-none text-foreground">{me.name}</div>
                      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{me.role}</div>
                    </div>
                    <button
                      type="button"
                      onClick={logout}
                      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"
                      aria-label="Keluar"
                    >
                      <LogOut className="size-4" />
                    </button>
                  </div>
                )}
```

- [ ] **Step 2: Build to verify the layout compiles**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add app/panel/layout.tsx && git commit -m "feat(auth): header shows user + logout; Settings nav admin-only"
```

---

### Task 6: Admin user-management routes + Settings "Tim" section

**Files:**
- Create: `app/api/admin/users/route.ts`
- Modify: `components/panel/settings-dashboard.tsx`

**Interfaces:**
- Consumes: `verifySession` (Task 2); `api.auth.listUsers/createUser/resetPassword/setActive` (Task 1).
- Produces: `GET /api/admin/users` → `{ users }`; `POST` `{ action: 'create'|'reset'|'setActive', ... }`. All require JWT `role === "admin"`, else 403.

- [ ] **Step 1: Create the admin users route (JWT-admin gated)**

Create `app/api/admin/users/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const secret = () => process.env.PANEL_AUTH_SECRET!;

async function requireAdmin(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  return session?.role === 'admin' ? session : null;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const users = await convex.query(api.auth.listUsers, { authSecret: secret() });
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json();
  const s = secret();
  if (body.action === 'create') {
    const r = await convex.mutation(api.auth.createUser, { authSecret: s, email: String(body.email), name: String(body.name), role: body.role === 'admin' ? 'admin' : 'cs', password: String(body.password) });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (body.action === 'reset') {
    const r = await convex.mutation(api.auth.resetPassword, { authSecret: s, email: String(body.email), newPassword: String(body.password) });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (body.action === 'setActive') {
    const r = await convex.mutation(api.auth.setActive, { authSecret: s, email: String(body.email), isActive: Boolean(body.isActive) });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ error: 'bad action' }, { status: 400 });
}
```

- [ ] **Step 2: Add the "Tim" section to the Settings dashboard**

In `components/panel/settings-dashboard.tsx`, ensure `useEffect` is imported from `react`. Add a self-contained `TeamSection` component (uses the existing `Card`/`CardHeader`/`CardTitle`/`CardContent`/`Button` imports already in the file):

```tsx
function TeamSection() {
  const [users, setUsers] = useState<Array<{ email: string; name: string; role: 'admin' | 'cs'; isActive: boolean }>>([]);
  const [form, setForm] = useState({ email: '', name: '', role: 'cs', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch('/api/admin/users');
    if (r.ok) setUsers((await r.json()).users);
  }
  useEffect(() => { load(); }, []);

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setErr(null);
    const r = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json()).error || 'Gagal'); return false; }
    await load();
    return true;
  }
  async function addUser() {
    if (!form.email || !form.name || !form.password) { setErr('Lengkapi semua field'); return; }
    if (await post({ action: 'create', ...form })) setForm({ email: '', name: '', role: 'cs', password: '' });
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Tim</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {err && <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{err}</div>}
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.email} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{u.name} <span className="text-xs text-muted-foreground">({u.role})</span></div>
                <div className="truncate text-xs text-muted-foreground">{u.email}{!u.isActive && ' — nonaktif'}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { const p = prompt(`Password baru untuk ${u.email}`); if (p) post({ action: 'reset', email: u.email, password: p }); }}>Reset</Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => post({ action: 'setActive', email: u.email, isActive: !u.isActive })}>{u.isActive ? 'Nonaktifkan' : 'Aktifkan'}</Button>
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
          <input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Nama" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select className="rounded-lg border border-input bg-background px-3 py-2 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="cs">CS</option>
            <option value="admin">Admin</option>
          </select>
          <input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Password awal" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Button disabled={busy} onClick={addUser} className="sm:col-span-2">Tambah user</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

Render `<TeamSection />` as the first child of the top-level `<div className="space-y-6">` returned by `SettingsDashboard`.

- [ ] **Step 3: Build to verify it compiles**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add app/api/admin/users/route.ts components/panel/settings-dashboard.tsx && git commit -m "feat(auth): admin user-management API + Settings Tim section"
```

---

### Task 7: Seed first admin + rollout

**Files:**
- None (ops/config). Final verification of the whole feature.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Set the auth secret env locally, on Convex, and on Vercel**

Generate a long random value and add `PANEL_AUTH_SECRET` to: the local `.env.local` (for `next dev`/build), the Convex deployment env, and Vercel (All Environments). Use the **same value** everywhere so JWT signing (Next) and `checkSecret` (Convex) agree.

Convex env: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx convex env set PANEL_AUTH_SECRET "<value>"`

- [ ] **Step 2: Full test suite + build green**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run && npm run build`
Expected: all tests PASS, build EXIT 0.

- [ ] **Step 3: Deploy Convex from main**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx convex deploy -y`
Expected: deployed (schema + auth functions live).

- [ ] **Step 4: Seed the owner admin (one-time)**

Run (replace values): `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx convex run auth:seedFirstAdmin '{"authSecret":"<value>","email":"fandy.andika@gmail.com","name":"Fandi","password":"<initial-pw>"}' --prod`
Expected: `{ ok: true }`. Re-running returns `{ ok: false, error: "users already exist" }`.

- [ ] **Step 5: Push, verify live login + role gating, then remove the old password env**

Push (`git push origin main`) so Vercel deploys the frontend. Verify: log in with the seeded admin at `/login`; the panel loads, the header shows the name + Logout, and Settings is visible. Then add a CS user via Settings → Tim, log in as that CS in a private window, and confirm Settings is hidden and visiting `/panel/settings` redirects to `/panel`.

Once confirmed, remove the now-unused `PANEL_PASSWORD` env from Vercel and Convex. Break-glass if locked out: re-run `auth:resetPassword` (or `auth:seedFirstAdmin` on an empty table) via the CLI.

- [ ] **Step 6: Finish the branch**

Use superpowers:finishing-a-development-branch.
