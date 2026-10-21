/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as app from "../app.js";
import type * as backup from "../backup.js";
import type * as files from "../files.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_issueStudioFiles from "../lib/issueStudioFiles.js";
import type * as lib_store from "../lib/store.js";
import type * as operations_analytics from "../operations/analytics.js";
import type * as operations_issueStudio from "../operations/issueStudio.js";
import type * as operations_mutations from "../operations/mutations.js";
import type * as operations_paymentReceipts from "../operations/paymentReceipts.js";
import type * as operations_queries from "../operations/queries.js";
import type * as operations_utilities from "../operations/utilities.js";
import type * as records from "../records.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  app: typeof app;
  backup: typeof backup;
  files: typeof files;
  "lib/auth": typeof lib_auth;
  "lib/issueStudioFiles": typeof lib_issueStudioFiles;
  "lib/store": typeof lib_store;
  "operations/analytics": typeof operations_analytics;
  "operations/issueStudio": typeof operations_issueStudio;
  "operations/mutations": typeof operations_mutations;
  "operations/paymentReceipts": typeof operations_paymentReceipts;
  "operations/queries": typeof operations_queries;
  "operations/utilities": typeof operations_utilities;
  records: typeof records;
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
