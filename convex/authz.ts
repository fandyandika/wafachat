import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getDefaultOrgId } from "./orgs";

// Authorization helpers for Convex functions (Fase 0 hardening).
//
// Identity arrives via Convex Custom JWT auth (convex/auth.config.ts): the panel
// exchanges its session cookie for a short-lived RS256 token carrying
// {role, name, email, csName} custom claims.
//
// ROLLOUT: starts PERMISSIVE — anonymous/mis-roled callers are logged, not rejected —
// so the live panel keeps working while we verify identity flows in production logs.
// Flip ENFORCE_DEFAULT to true (or set Convex env AUTH_ENFORCE=on) to start rejecting.
// The n8n write path (convex/http.ts, adapter secret) and the authSecret-arg pattern
// (auth.ts, followUp send/archive) are separate server-side channels — NOT affected.

export type Viewer = {
  subject: string;
  role: "admin" | "cs";
  name: string;
  email: string;
  csName?: string;
  orgIdClaim?: string;
};

// FLIPPED 2026-07-07 after verification: identity chain proven end-to-end (prod token ->
// whoami), n8n internalized, panel on token-carrying bundle, 4-min active-hours log
// observation showed zero anonymous callers. Emergency rollback: set Convex env
// AUTH_ENFORCE=off (dashboard) — overrides this default without a deploy.
const ENFORCE_DEFAULT = true;
function enforcing(): boolean {
  const env = (process.env.AUTH_ENFORCE ?? "").toLowerCase();
  if (env === "on" || env === "true") return true;
  if (env === "off" || env === "false") return false;
  return ENFORCE_DEFAULT;
}

export async function getViewer(ctx: { auth: { getUserIdentity: () => Promise<Record<string, unknown> | null> } }): Promise<Viewer | null> {
  const id = await ctx.auth.getUserIdentity();
  if (!id) return null;
  const role = id.role;
  if (role !== "admin" && role !== "cs") return null;
  return {
    subject: String(id.subject ?? ""),
    role,
    name: typeof id.name === "string" ? id.name : "",
    email: typeof id.email === "string" ? id.email : "",
    csName: typeof id.csName === "string" ? id.csName : undefined,
    orgIdClaim: typeof id.orgId === "string" ? id.orgId : undefined,
  };
}

/** Any logged-in panel user (admin or cs). Returns the viewer (null only while permissive). */
export async function requireMember(ctx: Parameters<typeof getViewer>[0], fn: string): Promise<Viewer | null> {
  const v = await getViewer(ctx);
  if (!v) {
    if (enforcing()) throw new Error(`unauthorized: ${fn} requires a logged-in user`);
    console.warn(`[authz-permissive] anonymous call: ${fn}`);
  }
  return v;
}

/** Verification probe: returns the identity Convex sees for this caller (null = anonymous). */
export const whoami = query({
  args: {},
  handler: async (ctx) => getViewer(ctx),
});

/** Admin-only functions (destructive/config/user management). */
export async function requireAdmin(ctx: Parameters<typeof getViewer>[0], fn: string): Promise<Viewer | null> {
  const v = await getViewer(ctx);
  if (!v || v.role !== "admin") {
    if (enforcing()) throw new Error(`unauthorized: ${fn} requires admin`);
    console.warn(`[authz-permissive] ${v ? `non-admin (${v.email})` : "anonymous"} call: ${fn}`);
  }
  return v;
}

// ─── Fase B2b: org resolution from the VIEWER (server-side; JWT untouched). ───
// users.orgId is REQUIRED (B1), so a users-row hit always yields an org.
// Admin WITHOUT a users row (_admin.mjs platform-operator token) falls back to the
// default org — single-tenant semantics, revisit with multi-org login (B3).
// CS without a users row is a misconfiguration: THROW (never silently default).

export type ViewerOrg = { viewer: Viewer; orgId: Id<"organizations"> };

async function resolveViewerOrg(ctx: any, viewer: Viewer, fn: string): Promise<Id<"organizations">> {
  const userRow = await ctx.db.query("users")
    .withIndex("by_email", (q: any) => q.eq("email", viewer.email)).unique();
  // B3: a token orgId claim is a HINT, never an authority — it must match the
  // users row (defense vs stale/forged claims after an org move).
  if (viewer.orgIdClaim) {
    if (!userRow) throw new Error(`unauthorized: ${fn} — org claim but no user record for ${viewer.email}`);
    if (String(userRow.orgId) !== viewer.orgIdClaim) throw new Error(`unauthorized: ${fn} — org claim mismatch`);
    return userRow.orgId;
  }
  if (userRow) return userRow.orgId;
  if (viewer.role === "admin") {
    // _admin.mjs platform-operator token (no users row, no claim): default org.
    // PERMANENT single-operator semantics (spec §2.3), not a temporary shim.
    const fallback = await getDefaultOrgId(ctx);
    if (fallback) return fallback;
    throw new Error(`unauthorized: ${fn} — org not seeded`);
  }
  throw new Error(`unauthorized: ${fn} — no user record for ${viewer.email}`);
}

export async function requireMemberOrg(ctx: any, fn: string): Promise<ViewerOrg> {
  const viewer = await requireMember(ctx, fn);
  if (!viewer) throw new Error(`unauthorized: ${fn} requires a logged-in user`);
  return { viewer, orgId: await resolveViewerOrg(ctx, viewer, fn) };
}

export async function requireAdminOrg(ctx: any, fn: string): Promise<ViewerOrg> {
  const viewer = await requireAdmin(ctx, fn);
  if (!viewer || viewer.role !== "admin") throw new Error(`unauthorized: ${fn} requires admin`);
  return { viewer, orgId: await resolveViewerOrg(ctx, viewer, fn) };
}

/** Test/diagnostic probe for viewer-org resolution (B2b). */
export const probeOrg = query({
  args: {},
  handler: async (ctx) => {
    const { viewer, orgId } = await requireMemberOrg(ctx, "authz.probeOrg");
    return { email: viewer.email, role: viewer.role, orgId };
  },
});
