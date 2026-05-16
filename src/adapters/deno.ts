/**
 * Deno adapter — `Deno.serve` is web-standard fetch.
 *
 * Supports the modern `Deno.serve(options, handler)` signature: HTTPS via
 * `cert`/`key`, an `onListen` callback, an `onError` hook, and signal-based
 * graceful shutdown (also wired to SIGTERM/SIGINT when `handleSignals` is
 * left at the default).
 */
import type { App } from "../app.js";

export interface DenoServeOptions {
  port?: number;
  hostname?: string;
  /** Optional external signal that triggers graceful shutdown. */
  signal?: AbortSignal;
  /** Optional TLS certificate (PEM). When supplied together with `key`, serves HTTPS. */
  cert?: string;
  /** Optional TLS private key (PEM). Pairs with `cert`. */
  key?: string;
  /** Invoked once the server is listening. */
  onListen?: (info: { hostname: string; port: number }) => void;
  /** Invoked when the fetch handler itself throws. Must return a fallback Response. */
  onError?: (err: unknown) => Response | Promise<Response>;
  /** Listen for SIGTERM/SIGINT and shut down. Default: true. */
  handleSignals?: boolean;
  /** Drain timeout for graceful shutdown. Default: 10000. */
  shutdownTimeoutMs?: number;
}

export interface DenoServerHandle {
  shutdown: () => Promise<void>;
}

export function serve(app: App, opts: DenoServeOptions = {}): DenoServerHandle {
  const D = (globalThis as {
    Deno?: {
      serve?: unknown;
      addSignalListener?: (sig: string, fn: () => void) => void;
      removeSignalListener?: (sig: string, fn: () => void) => void;
    };
  }).Deno;
  const denoServe = D?.serve as
    | ((init: Record<string, unknown>, handler: (req: Request) => Response | Promise<Response>) => { shutdown?: () => Promise<void> })
    | undefined;
  if (!denoServe) throw new Error("Deno runtime not detected");

  const controller = new AbortController();
  const init: Record<string, unknown> = {
    port: opts.port ?? 3000,
    hostname: opts.hostname ?? "0.0.0.0",
    signal: controller.signal,
  };
  if (opts.cert && opts.key) {
    init.cert = opts.cert;
    init.key = opts.key;
  }
  if (opts.onListen) init.onListen = opts.onListen;
  if (opts.onError) init.onError = opts.onError;

  const server = denoServe(init, (req) => app.fetch(req));

  const onSignal = () => {
    void shutdown();
  };
  if (opts.handleSignals !== false && typeof D?.addSignalListener === "function") {
    D.addSignalListener("SIGTERM", onSignal);
    D.addSignalListener("SIGINT", onSignal);
  }
  opts.signal?.addEventListener("abort", onSignal, { once: true });

  let stopped = false;
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    opts.signal?.removeEventListener("abort", onSignal);
    if (opts.handleSignals !== false && typeof D?.removeSignalListener === "function") {
      D.removeSignalListener("SIGTERM", onSignal);
      D.removeSignalListener("SIGINT", onSignal);
    }
    await app.shutdown(opts.shutdownTimeoutMs ?? 10_000);
    await server.shutdown?.();
  };

  return { shutdown };
}
