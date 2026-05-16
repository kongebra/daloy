/**
 * Bun adapter — `Bun.serve` already speaks web-standard fetch,
 * so this is the smallest possible wrapper. The adapter passes through the
 * commonly-needed modern `Bun.serve` options (`idleTimeout`, `tls`,
 * `development`, `unix`) and exposes the server's `url` for ergonomic logging.
 */
import type { App } from "../app.js";

export interface BunTLSOptions {
  /** PEM certificate. */
  cert: string;
  /** PEM private key. */
  key: string;
  /** Optional passphrase for the key. */
  passphrase?: string;
  /** Optional CA bundle. */
  ca?: string;
}

export interface BunServeOptions {
  port?: number;
  hostname?: string;
  /** Maximum request body bytes (Bun-level cap). Default: 16 MiB. */
  maxRequestBodySize?: number;
  /** Seconds before an idle connection is closed. Default: Bun default (10). */
  idleTimeout?: number;
  /** When true, Bun enables development-mode error pages and verbose output. */
  development?: boolean;
  /** Optional unix socket path; when set, TCP `port`/`hostname` are not passed to Bun. */
  unix?: string;
  /** When supplied, Bun.serve listens on HTTPS. */
  tls?: BunTLSOptions;
}

export interface BunServerHandle {
  port: number;
  url: URL | undefined;
  stop: () => Promise<void>;
}

export function serve(app: App, opts: BunServeOptions = {}): BunServerHandle {
  const Bun = (globalThis as { Bun?: { serve?: (cfg: Record<string, unknown>) => { port: number; url?: URL; stop: (force?: boolean) => void } } }).Bun;
  if (!Bun?.serve) throw new Error("Bun runtime not detected");

  const cfg: Record<string, unknown> = {
    maxRequestBodySize: opts.maxRequestBodySize ?? 16 * 1024 * 1024,
    fetch: (req: Request) => app.fetch(req),
    error: (err: Error) =>
      new Response(
        JSON.stringify({
          type: "https://daloyjs.dev/errors/internal",
          title: "Internal Server Error",
          status: 500,
          detail: err.message,
        }),
        { status: 500, headers: { "content-type": "application/problem+json" } }
      ),
  };
  if (opts.unix === undefined) {
    cfg.port = opts.port ?? 3000;
    cfg.hostname = opts.hostname ?? "0.0.0.0";
  }
  if (opts.idleTimeout !== undefined) cfg.idleTimeout = opts.idleTimeout;
  if (opts.development !== undefined) cfg.development = opts.development;
  if (opts.unix !== undefined) cfg.unix = opts.unix;
  if (opts.tls) cfg.tls = opts.tls;

  const server = Bun.serve(cfg);
  return {
    port: server.port,
    url: server.url,
    stop: async () => {
      await app.shutdown();
      server.stop(true);
    },
  };
}
