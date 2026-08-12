import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";

type KirimdevCaptureInput = {
  sourceKey: string;
  kind: "message.event";
  rawHeaders: string;
  rawBody: string;
  signatureOk: boolean;
  orgId: Id<"organizations">;
};

type KirimdevDispatchCtx = Pick<ActionCtx, "runMutation" | "scheduler">;

export async function captureAndScheduleKirimdev(
  ctx: KirimdevDispatchCtx,
  input: KirimdevCaptureInput,
): Promise<Id<"ingestEvents">> {
  const eventId = await ctx.runMutation(
    internal.ingest.events.captureEvent,
    input,
  ) as Id<"ingestEvents">;
  await ctx.scheduler.runAfter(
    0,
    internal.ingest.dispatch.processScheduledEvent,
    { eventId },
  );
  return eventId;
}

const SAFE_PROCESSING_ERROR =
  "Event processing failed. The captured raw event remains available for replay.";

export const processScheduledEvent = internalAction({
  args: { eventId: v.id("ingestEvents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.ingest.core.processEvent, {
        eventId: args.eventId,
      });
    } catch {
      await ctx.runMutation(internal.ingest.events.markFailed, {
        eventId: args.eventId,
        error: SAFE_PROCESSING_ERROR,
      });
    }
    return null;
  },
});
