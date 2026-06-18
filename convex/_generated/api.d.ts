/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as closingRules from "../closingRules.js";
import type * as csConfigs from "../csConfigs.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as messages from "../messages.js";
import type * as metrics from "../metrics.js";
import type * as settings from "../settings.js";
import type * as shippingRecaps from "../shippingRecaps.js";
import type * as state from "../state.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  closingRules: typeof closingRules;
  csConfigs: typeof csConfigs;
  events: typeof events;
  http: typeof http;
  lib: typeof lib;
  messages: typeof messages;
  metrics: typeof metrics;
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
