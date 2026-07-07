/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

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
import type * as lib from "../lib.js";
import type * as messages from "../messages.js";
import type * as metrics from "../metrics.js";
import type * as passwordHash from "../passwordHash.js";
import type * as responseTime from "../responseTime.js";
import type * as responseTimeMath from "../responseTimeMath.js";
import type * as settings from "../settings.js";
import type * as shippingRecaps from "../shippingRecaps.js";
import type * as state from "../state.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
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
  lib: typeof lib;
  messages: typeof messages;
  metrics: typeof metrics;
  passwordHash: typeof passwordHash;
  responseTime: typeof responseTime;
  responseTimeMath: typeof responseTimeMath;
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
