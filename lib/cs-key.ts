// MUST mirror convex/lib.ts csKey(). Used client-side to map a CS display
// name to the registry key for avatar lookups.
export function csKey(name: string | undefined): string {
  const n = (name ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return n.startsWith("cs") && n.length > 2 ? n.slice(2) : n;
}
