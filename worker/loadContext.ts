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

/**
 * How this request reached a club's site, when it did.
 *
 * Set by the Worker after it has resolved a custom hostname or verified a
 * preview token, and only then. Deliberately a router context rather than a
 * request header: a header can be sent by anybody, and `X-Sodalitas-Preview: 1`
 * on a plain request would otherwise be a way to read every club's unpublished
 * pages. Nothing outside worker/index.ts can set this.
 */
export interface SiteRequest {
  /** The club's own hostname, when the request arrived on one. */
  hostname: string | null;
  /** True when a valid preview token was presented. Drafts become visible. */
  preview: boolean;
  /** The site the token or hostname resolved to, so a loader can check. */
  siteId: string;
}

export const siteRequestContext = createContext<SiteRequest | null>(null);
