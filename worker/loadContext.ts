/**
 * loadContext.ts — the typed values every loader and action can reach.
 *
 * React Router v8 replaced the untyped `context` object with `createContext`
 * plus a `RouterContextProvider`. The upside is that a loader asking for the
 * environment gets a typed `Env` rather than `any` — worth the small ceremony,
 * because `context.env.DB` silently being `any` is how a typo reaches
 * production.
 */

import { createContext } from "react-router";
import type { Env } from "./context";

/** Worker bindings and secrets. */
export const envContext = createContext<Env>();

/** The Worker's ExecutionContext, for `waitUntil` on fire-and-forget work. */
export const execContext = createContext<ExecutionContext>();
