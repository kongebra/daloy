/**
 * `fetchGuard()` — SSRF-hardened wrapper around the global `fetch` for
 * outbound calls a handler makes on behalf of a user.
 *
 * The classic SSRF chain documented by the
 * [Aikido write-up](https://www.aikido.dev/blog/how-a-startups-cloud-got-taken-over-by-a-simple-form-that-sends-an-email)
 * starts with a handler that fetches a user-supplied URL (an email avatar,
 * a webhook target, an "import from URL" feature) and ends with the
 * attacker pivoting through the cloud metadata service
 * (`http://169.254.169.254/...` on AWS/Azure/DigitalOcean,
 * `http://100.100.100.200/...` on Alibaba, `http://192.0.0.192/...` on
 * Oracle Cloud) to steal short-lived IAM credentials.
 *
 * `fetchGuard()` rejects requests that resolve to any of the following
 * address ranges unless explicitly opted-in:
 *
 * - Loopback: `127.0.0.0/8`, `::1` (opt in: `allowLoopback`).
 * - RFC1918 private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
 *   (opt in: `allowPrivate`).
 * - Link-local **including every documented cloud metadata IP**:
 *   `169.254.0.0/16`, `fe80::/10` (opt in: `allowLinkLocal`).
 * - Unique-local IPv6: `fc00::/7` (opt in: `allowUniqueLocal`).
 *
 * Plus an always-deny floor that no flag can lift:
 *
 * - `0.0.0.0/8` (this-network), `100.64.0.0/10` (carrier-grade NAT — covers
 *   Alibaba `100.100.100.200`), `192.0.0.0/24` (covers Oracle Cloud
 *   `192.0.0.192`), `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`,
 *   `203.0.113.0/24` (IANA-reserved), `224.0.0.0/4` (multicast),
 *   `240.0.0.0/4` (reserved), `255.255.255.255` (broadcast).
 * - IPv6: `::/128` (unspecified), `ff00::/8` (multicast), IPv4-mapped
 *   `::ffff:0:0/96` is re-checked against the embedded IPv4 address.
 *
 * Redirects are followed **manually** with re-validation at each hop so
 * an attacker cannot bypass the check via a `302 → http://169.254...`.
 * `non-http(s)` protocols (`file:`, `ftp:`, `gopher:`, `data:`) are
 * rejected before any network call.
 *
 * @since 0.34.0
 * @module
 */

import { compileCidrMatcher, matchesMatcher, parseIp } from "./ip-restriction.js";
import type { IpMatcher, ParsedIp } from "./ip-restriction.js";

/**
 * Reason an SSRF guard refused to dispatch a request. Surfaced on
 * {@link SsrfBlockedError.reason} so callers can branch in tests / logs.
 *
 * @since 0.34.0
 */
export type SsrfBlockReason =
  | "protocol-not-allowed"
  | "host-not-allowed"
  | "dns-resolution-failed"
  | "address-not-allowed"
  | "too-many-redirects"
  | "invalid-url";

/**
 * Thrown by {@link fetchGuard} when an outbound request is refused. Never
 * thrown for ordinary network failures — those bubble through unchanged
 * so retry logic can distinguish "we refused" from "the network is sad".
 *
 * @since 0.34.0
 */
export class SsrfBlockedError extends Error {
  readonly url: string;
  readonly reason: SsrfBlockReason;
  readonly address?: string;
  constructor(url: string, reason: SsrfBlockReason, address?: string) {
    const where = address ? ` -> ${address}` : "";
    super(`SSRF blocked: ${url}${where} (${reason})`);
    this.name = "SsrfBlockedError";
    this.url = url;
    this.reason = reason;
    if (address !== undefined) this.address = address;
  }
}

/**
 * Options for {@link fetchGuard}. All defaults bias toward the safe
 * posture: only public IPs reachable over `http:` / `https:` are allowed.
 *
 * @since 0.34.0
 */
export interface FetchGuardOptions {
  /**
   * URL schemes the guard will permit. Defaults to
   * `["http:", "https:"]`. Anything else (`file:`, `data:`, `ftp:`,
   * `gopher:`, `dict:`, `ldap:`) is rejected with
   * `protocol-not-allowed`.
   */
  allowProtocols?: readonly string[];
  /**
   * IP literals, IPv4/IPv6 addresses, or CIDR ranges that bypass the
   * deny defaults. Use this for an explicit allowlist of public
   * upstreams. Hostnames are matched case-insensitively against the
   * post-DNS address set — pass an IP / CIDR, not a domain name.
   *
   * @example `["198.51.100.42", "2001:db8::/32"]`
   */
  allowAddresses?: readonly string[];
  /**
   * Hostnames that bypass DNS-based checks entirely. Useful when the
   * caller already verified the target out of band (e.g. internal
   * services on a known DNS name). Compared case-insensitively against
   * the URL hostname.
   */
  allowHosts?: readonly string[];
  /**
   * Extra IP / CIDR matchers to deny on top of the default floor.
   * Always wins against `allowAddresses`.
   */
  denyAddresses?: readonly string[];
  /**
   * Allow loopback addresses (`127.0.0.0/8`, `::1`). Default `false`.
   * Enable only for local-dev fixtures.
   */
  allowLoopback?: boolean;
  /**
   * Allow RFC1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`,
   * `192.168.0.0/16`). Default `false`.
   */
  allowPrivate?: boolean;
  /**
   * Allow link-local ranges (`169.254.0.0/16`, `fe80::/10`). Default
   * `false`. **Leaving this off blocks every documented cloud
   * metadata service IP** (AWS/Azure/DigitalOcean `169.254.169.254`,
   * GCP `metadata.google.internal`).
   */
  allowLinkLocal?: boolean;
  /**
   * Allow IPv6 unique-local addresses (`fc00::/7`). Default `false`.
   */
  allowUniqueLocal?: boolean;
  /**
   * Maximum number of redirects to follow with re-validation. Default
   * `5`. Set `0` to refuse all redirects (returns the 3xx response
   * directly).
   */
  maxRedirects?: number;
  /**
   * Underlying fetch implementation. Defaults to `globalThis.fetch`.
   * Useful for tests or for layering on top of an instrumented client.
   */
  fetch?: typeof fetch;
  /**
   * DNS resolver. Defaults to `node:dns/promises.lookup(host, { all: true })`.
   * Provide a custom resolver on non-Node runtimes (Workers, Deno
   * without `--allow-net`) or to enforce an in-memory test fixture.
   */
  resolve?: (hostname: string) => Promise<readonly string[]>;
}

// Always-on deny matchers. No option flips these.
const ALWAYS_DENY: readonly string[] = [
  "0.0.0.0/8", // "this network"
  "100.64.0.0/10", // CGNAT (Alibaba metadata 100.100.100.200)
  "192.0.0.0/24", // IANA reserved (Oracle metadata 192.0.0.192)
  "192.0.2.0/24", // TEST-NET-1
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved (includes 255.255.255.255)
  "::/128", // unspecified
  "ff00::/8", // IPv6 multicast
];

const LOOPBACK = ["127.0.0.0/8", "::1/128"];
const LINK_LOCAL = ["169.254.0.0/16", "fe80::/10"];
const PRIVATE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
const UNIQUE_LOCAL = ["fc00::/7"];

/**
 * Wrap `fetch` with an SSRF-hardened guard. The returned function has
 * the same call signature as the global `fetch` and throws
 * {@link SsrfBlockedError} when an outbound request would target a
 * dangerous internal address.
 *
 * @example
 * ```ts
 * import { fetchGuard } from "@daloyjs/core";
 *
 * const safeFetch = fetchGuard();
 *
 * app.route({
 *   method: "POST", path: "/import", operationId: "import",
 *   request: { json: z.object({ url: z.string().url() }) },
 *   responses: { 200: { description: "ok" } },
 *   handler: async ({ request }) => {
 *     const { url } = await request.json();
 *     const upstream = await safeFetch(url); // refuses 169.254.169.254
 *     return { status: 200 as const, body: await upstream.text() };
 *   },
 * });
 * ```
 *
 * @since 0.34.0
 */
export function fetchGuard(options: FetchGuardOptions = {}): typeof fetch {
  const allowProtocols = new Set(
    (options.allowProtocols ?? ["http:", "https:"]).map((s) => s.toLowerCase()),
  );
  const denyMatchers: IpMatcher[] = [];
  const allowMatchers: IpMatcher[] = [];
  const allowHosts = new Set((options.allowHosts ?? []).map((h) => h.toLowerCase()));
  const maxRedirects = options.maxRedirects ?? 5;
  const baseFetch = options.fetch ?? (globalThis.fetch as typeof fetch);
  if (typeof baseFetch !== "function") {
    throw new Error("fetchGuard(): no global fetch available; pass options.fetch.");
  }
  const resolveFn = options.resolve ?? createDefaultResolver();

  for (const c of ALWAYS_DENY) denyMatchers.push(compileCidrMatcher(c));
  if (!options.allowLoopback) for (const c of LOOPBACK) denyMatchers.push(compileCidrMatcher(c));
  if (!options.allowPrivate) for (const c of PRIVATE) denyMatchers.push(compileCidrMatcher(c));
  if (!options.allowLinkLocal) for (const c of LINK_LOCAL) denyMatchers.push(compileCidrMatcher(c));
  if (!options.allowUniqueLocal) {
    for (const c of UNIQUE_LOCAL) denyMatchers.push(compileCidrMatcher(c));
  }
  for (const c of options.denyAddresses ?? []) denyMatchers.push(compileCidrMatcher(c));
  for (const c of options.allowAddresses ?? []) allowMatchers.push(compileCidrMatcher(c));

  function isAddressAllowed(parsed: ParsedIp): boolean {
    if (allowMatchers.some((m) => matchesMatcher(parsed, m))) return true;
    return !denyMatchers.some((m) => matchesMatcher(parsed, m));
  }

  async function validateUrl(url: URL): Promise<void> {
    const proto = url.protocol.toLowerCase();
    if (!allowProtocols.has(proto)) {
      throw new SsrfBlockedError(url.toString(), "protocol-not-allowed");
    }
    // URL.hostname strips brackets from IPv6 literals — perfect for parseIp.
    const hostname = url.hostname;
    if (!hostname) {
      throw new SsrfBlockedError(url.toString(), "invalid-url");
    }
    if (allowHosts.has(hostname.toLowerCase())) return;
    const literal = parseIp(hostname);
    if (literal) {
      if (!isAddressAllowed(literal)) {
        throw new SsrfBlockedError(url.toString(), "address-not-allowed", hostname);
      }
      return;
    }
    let addrs: readonly string[];
    try {
      addrs = await resolveFn(hostname);
    } catch {
      throw new SsrfBlockedError(url.toString(), "dns-resolution-failed", hostname);
    }
    if (!addrs.length) {
      throw new SsrfBlockedError(url.toString(), "dns-resolution-failed", hostname);
    }
    for (const a of addrs) {
      const p = parseIp(a);
      if (!p) {
        throw new SsrfBlockedError(url.toString(), "dns-resolution-failed", a);
      }
      if (!isAddressAllowed(p)) {
        throw new SsrfBlockedError(url.toString(), "address-not-allowed", a);
      }
    }
  }

  const guarded: typeof fetch = async (input, init) => {
    let request = new Request(input as RequestInfo, init);
    const userRedirect = (init?.redirect ?? request.redirect) as RequestRedirect;
    // Always dispatch underlying calls with redirect: "manual" so we can
    // re-validate each Location ourselves.
    let currentUrl: URL;
    try {
      currentUrl = new URL(request.url);
    } catch {
      throw new SsrfBlockedError(String(input), "invalid-url");
    }
    for (let hop = 0; ; hop++) {
      await validateUrl(currentUrl);
      const dispatchInit: RequestInit = { redirect: "manual" };
      const dispatchReq = new Request(request, dispatchInit);
      const res = await baseFetch(dispatchReq);
      if (!isRedirect(res.status)) return res;
      if (userRedirect === "error") {
        throw new TypeError("fetchGuard: redirect refused (redirect: error)");
      }
      if (userRedirect === "manual" || maxRedirects === 0) return res;
      if (hop >= maxRedirects) {
        throw new SsrfBlockedError(currentUrl.toString(), "too-many-redirects");
      }
      const loc = res.headers.get("location");
      if (!loc) return res;
      let next: URL;
      try {
        next = new URL(loc, currentUrl);
      } catch {
        throw new SsrfBlockedError(loc, "invalid-url");
      }
      // Per fetch spec: 303 (and 301/302 for non-GET/HEAD in practice) downgrade to GET.
      const method = request.method.toUpperCase();
      const shouldDowngrade =
        res.status === 303 ||
        ((res.status === 301 || res.status === 302) && method !== "GET" && method !== "HEAD");
      request = shouldDowngrade
        ? new Request(next, {
            method: "GET",
            headers: stripBodyHeaders(request.headers),
            redirect: "manual",
            credentials: request.credentials,
            referrerPolicy: request.referrerPolicy,
          })
        : new Request(next, request);
      currentUrl = next;
    }
  };
  return guarded;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function stripBodyHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  out.delete("content-length");
  out.delete("content-type");
  out.delete("content-encoding");
  out.delete("content-language");
  out.delete("content-location");
  return out;
}

function createDefaultResolver(): (host: string) => Promise<readonly string[]> {
  let lookupPromise: Promise<((h: string, opts: { all: true; verbatim: true }) => Promise<Array<{ address: string }>>) | null> | null = null;
  return async (host) => {
    if (!lookupPromise) {
      lookupPromise = import("node:dns/promises")
        .then((m) => m.lookup as unknown as (h: string, opts: { all: true; verbatim: true }) => Promise<Array<{ address: string }>>)
        .catch(() => null);
    }
    const lookup = await lookupPromise;
    if (!lookup) {
      throw new Error(
        "fetchGuard: no DNS resolver available on this runtime. Pass options.resolve.",
      );
    }
    const results = await lookup(host, { all: true, verbatim: true });
    return results.map((r) => r.address);
  };
}
