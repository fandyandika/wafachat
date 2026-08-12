import React from "react";
import { AlertCircle, CheckCheck, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

type AdminExpeditionMessageProps = {
  direction: "inbound" | "outbound";
  messageType: string;
  content: string;
  status: string;
  failureReason?: string;
  actorName?: string;
  createdAt: number;
};

function messageTime(value: number) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(value);
}

function statusLabel(status: string) {
  if (status === "accepted") return "Terkirim";
  if (status === "delivered") return "Diterima";
  if (status === "read") return "Dibaca";
  if (status === "failed") return "Gagal";
  if (status === "unknown") return "Perlu dicek";
  return "Mengirim";
}

export function AdminExpeditionMessage({
  direction,
  messageType,
  content,
  status,
  failureReason,
  actorName,
  createdAt,
}: AdminExpeditionMessageProps) {
  const outbound = direction === "outbound";
  const failed = outbound && status === "failed";
  const unknown = outbound && status === "unknown";

  return (
    <article data-direction={direction} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <span className="sr-only">{outbound ? "Pesan admin" : "Pesan customer"}</span>
      <div
        className={cn(
          "max-w-[86%] rounded-xl px-3.5 py-2.5 text-sm md:max-w-[72%]",
          outbound && !failed && !unknown && "rounded-br-sm bg-primary text-primary-foreground",
          !outbound && "rounded-bl-sm border border-ledger-rule bg-card text-foreground",
          failed && "rounded-br-sm border border-negative/30 bg-negative-soft text-ledger-ink",
          unknown && "rounded-br-sm border border-amber-300 bg-amber-50 text-amber-950",
        )}
      >
        {outbound && (actorName || messageType === "template") && (
          <div className={cn("mb-1.5 flex items-center gap-2 text-[10px] font-medium", failed || unknown ? "text-muted-foreground" : "text-primary-foreground/75")}>
            {actorName && <span>{actorName}</span>}
            {messageType === "template" && <span className="rounded bg-black/10 px-1.5 py-0.5">Template</span>}
          </div>
        )}

        <p className="whitespace-pre-wrap break-words leading-5">{content}</p>

        {(failed || unknown) && (
          <div className={cn("mt-3 rounded-lg px-2.5 py-2 text-xs leading-5", failed ? "bg-background/75 text-negative" : "bg-background/70 text-amber-950")}>
            <div className="flex items-start gap-2">
              {failed ? <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> : <Clock3 className="mt-0.5 size-3.5 shrink-0" />}
              <div>
                <p className="font-semibold">{failed ? "Pengiriman gagal" : "Status belum dapat dipastikan"}</p>
                {failureReason && <p>{failureReason}</p>}
                <p className="mt-1">{failed ? "Periksa pesan lalu kirim ulang sebagai pesan baru." : "Periksa riwayat sebelum mengirim ulang."}</p>
              </div>
            </div>
          </div>
        )}

        <div className={cn("mt-1.5 flex items-center justify-end gap-1 text-[10px] tabular-nums", outbound && !failed && !unknown ? "text-primary-foreground/75" : "text-muted-foreground")}>
          <time>{messageTime(createdAt)}</time>
          {outbound && <><CheckCheck className="size-3" /><span>{statusLabel(status)}</span></>}
        </div>
      </div>
    </article>
  );
}
