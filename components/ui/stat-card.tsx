import * as React from "react"

import { cn } from "@/lib/utils"

type StatTone = "default" | "lead" | "positive" | "negative"

const toneIcon: Record<StatTone, string> = {
  default: "text-primary",
  lead: "text-lead",
  positive: "text-positive",
  negative: "text-negative",
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
  highlight = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  label: string
  value: React.ReactNode
  detail?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  tone?: StatTone
  highlight?: boolean
}) {
  return (
    <div
      data-slot="stat-card"
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-elevate hover:border-primary/30",
        highlight && "bg-accent",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        {Icon ? <Icon className={cn("size-4", toneIcon[tone])} /> : null}
      </div>
      <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </div>
      {detail ? <div className="text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  )
}

export { StatCard }
export type { StatTone }
