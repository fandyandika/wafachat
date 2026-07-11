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

crons.interval(
  "ingest silence detector",
  { minutes: 15 }, // 15m cadence vs a 45m silence threshold — still detects in time; ~12->4 MB/day
  internal.ingest.monitor.checkHealth,
  {},
);

crons.interval(
  "berdu order reconciler",
  { minutes: 15 }, // safety net only (primary = Berdu webhook, real-time); 15m worst-case heal, ~3x less counter-scan I/O
  internal.ingest.reconciler.runReconcile,
  {},
);

crons.daily(
  "ingest events retention (30d)",
  { hourUTC: 19, minuteUTC: 30 }, // 02:30 WIB, quiet window
  internal.ingest.events.cleanupOldDaily,
  {},
);

crons.daily(
  "rollup true-up",
  { hourUTC: 20, minuteUTC: 0 }, // 03:00 WIB, after ingest retention
  internal.rollups.trueUp,
  {},
);

export default crons;
