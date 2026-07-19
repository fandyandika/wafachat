/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as analytics from "../analytics.js";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as autoFollowUp from "../autoFollowUp.js";
import type * as closingRules from "../closingRules.js";
import type * as conversationLifecycle from "../conversationLifecycle.js";
import type * as crons from "../crons.js";
import type * as cs from "../cs.js";
import type * as csConfigs from "../csConfigs.js";
import type * as events from "../events.js";
import type * as followUp from "../followUp.js";
import type * as followUpMath from "../followUpMath.js";
import type * as http from "../http.js";
import type * as ingest_berduAdapter from "../ingest/berduAdapter.js";
import type * as ingest_core from "../ingest/core.js";
import type * as ingest_events from "../ingest/events.js";
import type * as ingest_kirimdevAdapter from "../ingest/kirimdevAdapter.js";
import type * as ingest_monitor from "../ingest/monitor.js";
import type * as ingest_reconcileState from "../ingest/reconcileState.js";
import type * as ingest_reconciler from "../ingest/reconciler.js";
import type * as ingest_signature from "../ingest/signature.js";
import type * as ingest_sources from "../ingest/sources.js";
import type * as lib from "../lib.js";
import type * as messages from "../messages.js";
import type * as metrics from "../metrics.js";
import type * as orgSettings from "../orgSettings.js";
import type * as orgs from "../orgs.js";
import type * as passwordHash from "../passwordHash.js";
import type * as responseTime from "../responseTime.js";
import type * as responseTimeMath from "../responseTimeMath.js";
import type * as rollupReaders from "../rollupReaders.js";
import type * as rollupVersion from "../rollupVersion.js";
import type * as rollups from "../rollups.js";
import type * as settings from "../settings.js";
import type * as shippingRecaps from "../shippingRecaps.js";
import type * as state from "../state.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  analytics: typeof analytics;
  auth: typeof auth;
  authz: typeof authz;
  autoFollowUp: typeof autoFollowUp;
  closingRules: typeof closingRules;
  conversationLifecycle: typeof conversationLifecycle;
  crons: typeof crons;
  cs: typeof cs;
  csConfigs: typeof csConfigs;
  events: typeof events;
  followUp: typeof followUp;
  followUpMath: typeof followUpMath;
  http: typeof http;
  "ingest/berduAdapter": typeof ingest_berduAdapter;
  "ingest/core": typeof ingest_core;
  "ingest/events": typeof ingest_events;
  "ingest/kirimdevAdapter": typeof ingest_kirimdevAdapter;
  "ingest/monitor": typeof ingest_monitor;
  "ingest/reconcileState": typeof ingest_reconcileState;
  "ingest/reconciler": typeof ingest_reconciler;
  "ingest/signature": typeof ingest_signature;
  "ingest/sources": typeof ingest_sources;
  lib: typeof lib;
  messages: typeof messages;
  metrics: typeof metrics;
  orgSettings: typeof orgSettings;
  orgs: typeof orgs;
  passwordHash: typeof passwordHash;
  responseTime: typeof responseTime;
  responseTimeMath: typeof responseTimeMath;
  rollupReaders: typeof rollupReaders;
  rollupVersion: typeof rollupVersion;
  rollups: typeof rollups;
  settings: typeof settings;
  shippingRecaps: typeof shippingRecaps;
  state: typeof state;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
