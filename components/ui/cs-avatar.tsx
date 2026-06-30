import { cn } from "@/lib/utils"

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
 * Neutral initials chip (or a profile photo if `src` is set) — the professional
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
          className={cn("flex size-full items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground", s.text)}
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
