/**
 * Security primitives. Used by the App core and the public middleware.
 *
 * - readBodyLimited: streaming read with a hard byte cap (DoS protection).
 * - safeJsonParse: JSON parser that strips __proto__ / constructor / prototype
 *   keys to prevent prototype-pollution attacks.
 * - sanitizeHeaderName / sanitizeHeaderValue: prevent CRLF header injection.
 * - timingSafeEqual: constant-time string comparison for token checks.
 * - randomId: cryptographically strong request id.
 */

import {
  PayloadTooLargeError,
  BadRequestError,
} from "./errors.js";

/**
 * Read a `Request` body to a `Uint8Array` while enforcing a hard byte cap.
 *
 * The cap is checked first against the declared `Content-Length` (so the
 * fast-path rejects oversize bodies without reading any bytes), then against
 * the actual streamed total. Either trigger throws
 * {@link PayloadTooLargeError} (mapped to `413`). DaloyJS calls this for
 * every request automatically; use it directly only from custom plugins
 * that need raw bytes.
 *
 * @param req - Standard `Request` to drain.
 * @param limit - Maximum number of bytes to accept.
 * @returns Fulfills with the body as a `Uint8Array`.
 * @throws {PayloadTooLargeError} When the declared or actual size exceeds `limit`.
 * @throws {BadRequestError} When `Content-Length` is present but invalid.
 * @since 0.1.0
 */
export async function readBodyLimited(
  req: Request,
  limit: number
): Promise<Uint8Array> {
  // Trust Content-Length when present — fail fast.
  const cl = req.headers.get("content-length");
  if (cl) {
    const n = Number(cl);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestError("Invalid Content-Length");
    if (n > limit) throw new PayloadTooLargeError(limit);
  }

  if (!req.body) return new Uint8Array(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new PayloadTooLargeError(limit);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Parse a JSON string while stripping the dangerous keys `__proto__`,
 * `constructor`, and `prototype` from every nested object. Throws
 * {@link BadRequestError} on invalid JSON — the message is intentionally
 * generic to avoid revealing parser internals to attackers.
 *
 * @param text - The JSON text to parse. Empty string returns `undefined`.
 * @returns The parsed value with prototype-pollution keys removed.
 * @throws {BadRequestError} When the input is not valid JSON.
 * @since 0.1.0
 */
export function safeJsonParse(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text, (key, value) => {
      if (FORBIDDEN_KEYS.has(key)) return undefined;
      return value;
    });
  } catch {
    throw new BadRequestError("Invalid JSON");
  }
}

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Validate a candidate HTTP header name against RFC 7230 token grammar and
 * return its lowercased form (Headers normalize to lowercase). Useful when
 * accepting header names from user/config input.
 *
 * @param name - The header name to validate.
 * @returns The lowercased header name.
 * @throws {BadRequestError} When `name` contains illegal characters.
 * @since 0.1.0
 */
export function sanitizeHeaderName(name: string): string {
  if (!HEADER_NAME_RE.test(name)) {
    throw new BadRequestError(`Invalid header name: ${name}`);
  }
  return name.toLowerCase();
}

/**
 * Reject HTTP header values containing CR, LF, or NUL bytes — the classic
 * header / response-splitting vector. Returns the value untouched on
 * success.
 *
 * @param value - The header value to validate.
 * @returns The same `value` if it is safe to write to a header.
 * @throws {BadRequestError} When `value` contains `\r`, `\n`, or `\0`.
 * @since 0.1.0
 */
export function sanitizeHeaderValue(value: string): string {
  // Block CRLF + NUL — the classic header / response splitting vector.
  if (/[\r\n\0]/.test(value)) {
    throw new BadRequestError("Invalid header value");
  }
  return value;
}

/**
 * Constant-time string comparison resistant to timing attacks. Use whenever
 * comparing secrets such as CSRF tokens, HMAC signatures, or API keys; never
 * use `===` for those comparisons.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns `true` when the strings have the same length and contents.
 * @since 0.1.0
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

/**
 * Generate a cryptographically strong, URL-safe identifier (~22 chars).
 *
 * Uses Web Crypto's `crypto.randomUUID()` when available, falling back to
 * 16 random bytes via `crypto.getRandomValues()`. The last-resort fallback
 * (timestamp + `Math.random()`) only triggers in environments without
 * WebCrypto, which is none of Node 20+/Bun/Deno/Cloudflare Workers/Vercel
 * Edge.
 *
 * Suitable for request ids, session ids, and short-lived correlation tokens.
 * Do not use for long-lived secrets unless you also sign or wrap them.
 *
 * @returns A random URL-safe id string.
 * @since 0.1.0
 */
export function randomId(): string {
  const c: Crypto | undefined = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const buf = new Uint8Array(16);
    c.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Last-resort fallback (should never trigger on Node 20+/Bun/Deno/Workers).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
