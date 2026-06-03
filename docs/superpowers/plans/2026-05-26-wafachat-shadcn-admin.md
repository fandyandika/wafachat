# WaFaChat shadcn Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert WaFaChat from a single handmade dashboard screen into the first slice of a productized shadcn/ui admin panel.

**Architecture:** Keep the existing Next.js App Router API routes and n8n data contract unchanged. Add shadcn/ui primitives and refactor only `/panel` plus shared UI support files into a sidebar-based operational dashboard shell.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, shadcn/ui, lucide-react, Vercel.

---

### Task 1: Install shadcn Foundation

**Files:**
- Create: `wafachat/components.json`
- Create: `wafachat/components/ui/*`
- Create: `wafachat/lib/utils.ts`
- Modify: `wafachat/app/globals.css`
- Modify: `wafachat/tailwind.config.ts`
- Modify: `wafachat/package.json`

- [ ] Run `npx shadcn@latest init -d` from `wafachat/`.
- [ ] Add components: `button card table badge switch separator skeleton sheet tooltip dropdown-menu`.
- [ ] Confirm `components.json` uses Tailwind config `tailwind.config.ts` and CSS `app/globals.css`.

### Task 2: Refactor Dashboard Shell

**Files:**
- Modify: `wafachat/app/panel/page.tsx`

- [ ] Keep existing `fetchAll`, `toggleGlobal`, `setStatus`, and metric calculations.
- [ ] Replace handmade shell with app sidebar containing Dashboard, Conversations, CS Team, Automation, Reports, Settings.
- [ ] Keep only Dashboard functional; mark future nav items as passive visual entries.
- [ ] Replace stat cards/table/actions with shadcn components.
- [ ] Add loading skeleton, empty state, and clear status badges.

### Task 3: Verify

**Files:**
- No source files beyond implementation changes.

- [ ] Run `npm run build` from `wafachat/`.
- [ ] Start local dev server and visually inspect `/panel`.
- [ ] Confirm live data still comes from `/api/stats`, `/api/conversations`, and `/api/global`.
- [ ] Deploy production with `npx vercel deploy --prod --yes`.

### Self-Review

- Scope is intentionally limited to the existing dashboard slice.
- No n8n API contract changes.
- No new unfinished pages or speculative data model changes.
- Future product modules are represented only as navigation structure.
