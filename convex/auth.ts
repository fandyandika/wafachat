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
