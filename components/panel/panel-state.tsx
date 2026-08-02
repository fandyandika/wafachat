import type { ReactNode } from "react";
import { CircleAlert, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function PanelState({
  kind,
  title,
  description,
  action,
}: {
  kind: "empty" | "error";
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const Icon = kind === "error" ? CircleAlert : Inbox;
  return (
    <div
      role={kind === "error" ? "alert" : undefined}
      className={cn("grid min-h-40 place-items-center rounded-xl border border-dashed px-6 py-10 text-center", kind === "error" && "border-destructive/30")}
    >
      <div className="max-w-sm space-y-2">
        <Icon aria-hidden className={cn("mx-auto size-5 text-muted-foreground", kind === "error" && "text-destructive")} />
        <p className="font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}
