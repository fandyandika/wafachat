import * as React from "react"

import { cn } from "@/lib/utils"

type MetricTone = "default" | "lead" | "positive" | "negative" | "amber"

const toneChip: Record<MetricTone, string> = {
  default: "bg-primary/10 text-primary",
  lead: "bg-lead-soft text-lead",
  positive: "bg-positive-soft text-positive",
  negative: "bg-negative-soft text-negative",
  amber: "bg-amber-100 text-amber-700",
}

/**
 * The single premium metric tile used across every panel surface. Icon chip,
 * uppercase micro-label, oversized tabular figure, optional hint/delta row.
 * `emphasis` lifts the headline metric out of the flat grid with a soft ring.
 */
function MetricCard({
  label,
  value,
  hint,
  delta,
  icon: Icon,
  tone = "default",
  emphasis = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  delta?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  tone?: MetricTone
  emphasis?: boolean
}) {
  return (
    <div
      data-slot="metric-card"
      className={cn(
        "group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevate",
        emphasis && "ring-1 ring-primary/15",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {Icon ? (
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl", toneChip[tone])}>
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
      <div className="text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </div>
      {hint || delta ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {delta}
          {hint ? <span className="truncate">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Compact colored delta pill (↑/↓ + value). Tone derives from sign unless inverted. */
function DeltaPill({ value, suffix = "", invert = false }: { value: number; suffix?: string; invert?: boolean }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const good = invert ? value < 0 : value > 0
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
        good ? "bg-positive-soft text-positive" : "bg-negative-soft text-negative",
      )}
    >
      {value > 0 ? "↑" : "↓"}
      {Math.abs(value)}
      {suffix}
    </span>
  )
}

export { MetricCard, DeltaPill }
export type { MetricTone }
