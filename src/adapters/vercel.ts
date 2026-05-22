/**
 * Vercel / web-standard handler.
 *
 * Vercel now recommends the Node.js runtime over Edge for new functions. The
 * runtime is web-standard, but the export shape differs by integration: Node
 * `/api` functions use a default `{ fetch }` object, while Edge functions and
 * Next.js route handlers use function exports.
 *
 *   // Vercel Functions (`api/[...path].ts`)
 *   import { toFetchHandler } from "@daloyjs/core/vercel";
 *   export default toFetchHandler(app);
 *
 *   // Next.js App Router (`app/api/[...slug]/route.ts`)
 *   import { toRouteHandlers } from "@daloyjs/core/vercel";
 *   export const { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } =
 *     toRouteHandlers(app);
 *
 * `toEdgeHandler` is kept as a backward-compatible alias of `toWebHandler`.
 */
import type { App } from "../app.js";

/** Web-standard handler shape used by Vercel Edge Functions, Next.js route handlers, and middleware. */
export type WebHandler = (req: Request) => Promise<Response>;
/** Default export shape for Vercel's web-standard `{ fetch }` runtime. */
export interface FetchHandler {
  fetch: WebHandler;
}

const NEXT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;
/** Record of per-method handlers expected by a Next.js App Router `route.ts` file. */
export type RouteHandlers = Record<(typeof NEXT_METHODS)[number], WebHandler>;

/** Wrap an {@link App} as a single web-standard fetch handler. */
export function toWebHandler(app: App): WebHandler {
  return (req) => app.fetch(req);
}

/**
 * Build the default `{ fetch }` export expected by Vercel Node.js Functions
 * in the `/api` directory.
 */
export function toFetchHandler(app: App): FetchHandler {
  return { fetch: toWebHandler(app) };
}

/** Backward-compatible alias for {@link toWebHandler}. */
export const toEdgeHandler = toWebHandler;

/**
 * Build the `{ GET, POST, ... }` object expected by Next.js App Router
 * `route.ts` files, so a single catch-all segment can serve every HTTP method.
 */
export function toRouteHandlers(app: App): RouteHandlers {
  const handler = toWebHandler(app);
  const out = {} as RouteHandlers;
  for (const method of NEXT_METHODS) out[method] = handler;
  return out;
}
