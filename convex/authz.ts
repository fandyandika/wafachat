import { query } from "./_generated/server";

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
};

const ENFORCE_DEFAULT = false; // flip to true in the enforcement commit (plan task 6)
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
