import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily: close WON + STALE conversations so the "active" pool stays bounded (and the follow-up
// funnel stays fast). 19:00 UTC = 02:00 WIB — low traffic.
crons.daily(
  "archive won/stale conversations",
  { hourUTC: 19, minuteUTC: 0 },
  internal.conversationLifecycle.cronArchiveSweep,
  {},
);

// Hourly: auto-send follow-ups for enabled CS during business hours (08:00–14:00 WIB).
crons.hourly(
  "auto follow-up sweep",
  { minuteUTC: 0 },
  internal.autoFollowUp.autoFollowUpSweep,
  {},
);

export default crons;
