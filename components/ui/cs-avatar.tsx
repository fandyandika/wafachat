import { cn } from "@/lib/utils"

// Deterministic, calm tints — one per CS, derived from the name so it stays stable.
const AVATAR_COLORS = [
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
  "bg-fuchsia-100 text-fuchsia-700",
]

function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function initialsOf(name: string): string {
  const clean = name.replace(/^CS\s+/i, "").trim()
  if (!clean) return "?"
  const parts = clean.split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

const SIZES = {
  sm: { box: "size-7", text: "text-[11px]", dot: "size-2" },
  md: { box: "size-9", text: "text-xs", dot: "size-2.5" },
  lg: { box: "size-11", text: "text-sm", dot: "size-3" },
} as const

/**
 * Colored initials chip (or a profile photo if `src` is set) — the professional
 * stand-in for the old 🟠 / medal emoji. `online` adds a presence dot.
 */
export function CsAvatar({
  name,
  size = "md",
  src,
  online,
  className,
}: {
  name: string
  size?: keyof typeof SIZES
  src?: string
  online?: boolean
  className?: string
}) {
  const s = SIZES[size]
  return (
    <span className={cn("relative inline-flex shrink-0", s.box, className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="size-full rounded-full object-cover" />
      ) : (
        <span
          className={cn("flex size-full items-center justify-center rounded-full font-semibold", s.text, colorFor(name))}
          aria-hidden
        >
          {initialsOf(name)}
        </span>
      )}
      {online != null && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full border-2 border-card",
            s.dot,
            online ? "bg-positive" : "bg-muted-foreground/50",
          )}
          aria-hidden
        />
      )}
    </span>
  )
}
