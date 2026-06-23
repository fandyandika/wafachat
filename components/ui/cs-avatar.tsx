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

const sizeClass = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
} as const

/** Colored initials chip — the professional stand-in for the old 🟠 / medal emoji. */
export function CsAvatar({
  name,
  size = "md",
  className,
}: {
  name: string
  size?: keyof typeof sizeClass
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        sizeClass[size],
        colorFor(name),
        className,
      )}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  )
}
