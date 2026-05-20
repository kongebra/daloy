/**
 * Wave 5 leftover: first-party `jwt()` sign + verify helpers with secure-by-default
 * algorithm discipline and time-claim validation.
 *
 * The framework refuses `alg: "none"` outright, requires an explicit algorithm
 * allowlist on the verifier (no implicit "any RS256" default), refuses
 * symmetric algorithms (`HS*`) when the key source is a JWK / JWKS URL
 * (the classic confused-deputy attack), refuses to issue tokens without an
 * `exp` claim or with an `exp` exceeding the construction-time
 * `maxLifetimeSeconds`, and validates `exp` / `nbf` / `iat` on every verify
 * (with optional `iss` / `aud` checks) — none of which can be silenced in
 * production under `secureDefaults`.
 *
 * Pair with the Wave 1 webhook HMAC helpers in `@daloyjs/core` for body-bound
 * authentication, and with the Wave 5 `requireScopes()` middleware for
 * scope-based authorization on top of a verified JWT.
 *
 * @since 0.21.0
 */

import { assertTemporalClaims, TemporalClaimError } from "./time-claims.js";

/** Algorithms understood by the helper. SHA-1 / `none` are deliberately absent. */
export type JwtAlgorithm =
  | "HS256"
  | "HS384"
  | "HS512"
  | "RS256"
  | "RS384"
  | "RS512"
  | "PS256"
  | "PS384"
  | "PS512"
  | "ES256"
  | "ES384"
  | "ES512"
  | "EdDSA";

const SYMMETRIC: ReadonlySet<JwtAlgorithm> = new Set([
  "HS256",
  "HS384",
  "HS512",
]);

const ASYMMETRIC: ReadonlySet<JwtAlgorithm> = new Set([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
]);

const ALL_ALGS: ReadonlySet<string> = new Set([...SYMMETRIC, ...ASYMMETRIC]);

/**
 * Wave 8 — minimum byte length for an HS* HMAC secret. RFC 7518 §3.2
 * requires HS256 keys to be at least 256 bits (32 bytes). Apply the same
 * floor to HS384 / HS512 because shorter keys do not buy a meaningfully
 * stronger HMAC than HS256-with-a-256-bit-key.
 */
const MIN_HS_KEY_BYTES = 32;

/** Default lifetime cap when none is declared in development (`30d`). */
export const DEFAULT_JWT_MAX_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/** Structured error thrown by every JWT helper. */
export class JwtError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "JwtError";
    this.code = code;
  }
}

/** Result of a successful verify. */
export interface JwtVerified {
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
}

/** Key material accepted by the signer/verifier. */
export type JwtKeyMaterial = CryptoKey | Uint8Array | JsonWebKey;

/** Options for {@link createJwtSigner}. */
export interface JwtSignerOptions {
  alg: JwtAlgorithm;
  key: JwtKeyMaterial;
  /**
   * Maximum allowed `exp - iat` window in seconds. Required: refuse-at-
   * construction when omitted so "default forever" is impossible.
   */
  maxLifetimeSeconds: number;
  /**
   * Opt-out flag for issuing tokens with no `exp` claim. Refused in
   * production under `secureDefaults` (a token that never expires is wrong
   * in every threat model).
   */
  acknowledgeNoExp?: boolean;
  /** Override the resolved environment (defaults to `NODE_ENV`). */
  env?: "production" | "development" | "test";
  /** Set `secureDefaults: false` to skip the production opt-out gate. */
  secureDefaults?: boolean;
  /** Optional extra header fields (`kid`, `typ`, ...). `alg` is always derived. */
  header?: Record<string, unknown>;
}

/** Options for {@link createJwtVerifier}. */
export interface JwtVerifierOptions {
  /** Explicit allowlist — no implicit defaults. Must be non-empty. */
  algorithms: JwtAlgorithm[];
  /** Static key, or a per-token resolver that picks the key by `header.kid`. */
  key: JwtKeyMaterial | ((header: Record<string, unknown>) => JwtKeyMaterial | Promise<JwtKeyMaterial>);
  /** Optional issuer (string or allowlist). */
  issuer?: string | string[];
  /** Optional audience (string or allowlist). */
  audience?: string | string[];
  /** Clock skew tolerance applied to `exp` / `nbf` / `iat`. Default `0`. */
  clockSkewSeconds?: number;
  /**
   * Refuse-to-construct when the algorithm allowlist mixes symmetric (`HS*`)
   * with a JWK / JWKS-shaped resolver. Default: `true`. This closes the
   * documented confused-deputy attack class where a verifier configured for
   * RS256 + JWK silently accepts an HS256 token signed with the public key.
   */
  refuseSymmetricWithJwk?: boolean;
  /** Optional injectable clock for tests. */
  now?: () => number;
}

interface ResolvedSigner {
  alg: JwtAlgorithm;
  key: CryptoKey;
  maxLifetimeSeconds: number;
  allowNoExp: boolean;
  header: Record<string, unknown>;
}

interface ResolvedVerifier {
  algorithms: ReadonlySet<JwtAlgorithm>;
  resolveKey: (header: Record<string, unknown>) => Promise<CryptoKey>;
  issuers: ReadonlySet<string> | null;
  audiences: ReadonlySet<string> | null;
  clockSkewSeconds: number;
  now: () => number;
}

function getCrypto(): Crypto {
  const c: Crypto | undefined = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new JwtError(
      "no_webcrypto",
      "jwt(): WebCrypto SubtleCrypto API is unavailable on this runtime.",
    );
  }
  return c;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(input: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) {
    throw new JwtError("invalid_token", "JWT segment is not base64url.");
  }
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function isJsonObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isJsonWebKey(v: unknown): v is JsonWebKey {
  return isJsonObject(v) && typeof (v as { kty?: unknown }).kty === "string";
}

function isCryptoKey(v: unknown): v is CryptoKey {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { type?: unknown }).type === "string" &&
    typeof (v as { algorithm?: unknown }).algorithm === "object"
  );
}

function isProductionEnv(env: JwtSignerOptions["env"]): boolean {
  if (env === "production") return true;
  if (env === "development" || env === "test") return false;
  return (
    typeof process !== "undefined" &&
    typeof process.env !== "undefined" &&
    process.env.NODE_ENV === "production"
  );
}

function algParams(alg: JwtAlgorithm): { name: string; hash?: string; namedCurve?: string; saltLength?: number } {
  switch (alg) {
    case "HS256":
      return { name: "HMAC", hash: "SHA-256" };
    case "HS384":
      return { name: "HMAC", hash: "SHA-384" };
    case "HS512":
      return { name: "HMAC", hash: "SHA-512" };
    case "RS256":
      return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    case "RS384":
      return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" };
    case "RS512":
      return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" };
    case "PS256":
      return { name: "RSA-PSS", hash: "SHA-256", saltLength: 32 };
    case "PS384":
      return { name: "RSA-PSS", hash: "SHA-384", saltLength: 48 };
    case "PS512":
      return { name: "RSA-PSS", hash: "SHA-512", saltLength: 64 };
    case "ES256":
      return { name: "ECDSA", hash: "SHA-256", namedCurve: "P-256" };
    case "ES384":
      return { name: "ECDSA", hash: "SHA-384", namedCurve: "P-384" };
    case "ES512":
      return { name: "ECDSA", hash: "SHA-512", namedCurve: "P-521" };
    case "EdDSA":
      return { name: "Ed25519" };
  }
}

async function importKey(
  alg: JwtAlgorithm,
  material: JwtKeyMaterial,
  usage: "sign" | "verify",
): Promise<CryptoKey> {
  const params = algParams(alg);
  const c = getCrypto();
  if (isCryptoKey(material)) return material;
  if (material instanceof Uint8Array) {
    if (!SYMMETRIC.has(alg)) {
      throw new JwtError(
        "invalid_key",
        `jwt(): raw byte keys are only supported for HS256/HS384/HS512; got ${alg}.`,
      );
    }
    // Wave 8 — refuse HS-shaped secrets shorter than 32 bytes (256 bits).
    // RFC 7518 §3.2 requires HS256 keys to be "of the same size as the hash
    // output (for instance, 256 bits for HS256)" — anything shorter is a
    // known-weak HMAC key that turns the signature into the bottleneck.
    if (material.byteLength < MIN_HS_KEY_BYTES) {
      throw new JwtError(
        "weak_hs_secret",
        `jwt(): ${alg} secret must be at least ${MIN_HS_KEY_BYTES} bytes (RFC 7518 §3.2); got ${material.byteLength}.`,
      );
    }
    return c.subtle.importKey(
      "raw",
      material as BufferSource,
      { name: "HMAC", hash: params.hash! },
      false,
      [usage],
    );
  }
  if (isJsonWebKey(material)) {
    const importAlgorithm =
      params.name === "HMAC"
        ? { name: "HMAC", hash: params.hash! }
        : params.name === "ECDSA"
        ? { name: "ECDSA", namedCurve: params.namedCurve! }
        : params.name === "RSA-PSS"
        ? { name: "RSA-PSS", hash: params.hash! }
        : params.name === "RSASSA-PKCS1-v1_5"
        ? { name: "RSASSA-PKCS1-v1_5", hash: params.hash! }
        : { name: "Ed25519" };
    return c.subtle.importKey("jwk", material, importAlgorithm, false, [usage]);
  }
  throw new JwtError("invalid_key", "jwt(): unsupported key material.");
}

function buildSignAlgorithm(alg: JwtAlgorithm): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  const params = algParams(alg);
  if (params.name === "RSA-PSS") return { name: "RSA-PSS", saltLength: params.saltLength! };
  if (params.name === "ECDSA") return { name: "ECDSA", hash: params.hash! };
  if (params.name === "Ed25519") return { name: "Ed25519" };
  return { name: params.name };
}

/**
 * Create a JWT signer locked to one algorithm + key. The returned `sign()`
 * function refuses payloads without an `exp` claim (unless
 * `acknowledgeNoExp: true` was set at construction outside production) and
 * refuses payloads whose `exp - (iat | now)` exceeds `maxLifetimeSeconds`.
 *
 * @since 0.21.0
 */
export function createJwtSigner(opts: JwtSignerOptions): { sign(payload: Record<string, unknown>): Promise<string> } {
  if (!opts || typeof opts !== "object") {
    throw new JwtError("invalid_options", "jwt(): signer options object is required.");
  }
  const { alg } = opts;
  if ((alg as unknown) === "none") {
    throw new JwtError("alg_none_refused", 'jwt(): alg "none" is refused.');
  }
  if (!ALL_ALGS.has(alg)) {
    throw new JwtError(
      "invalid_alg",
      `jwt(): unknown algorithm "${String(alg)}". Allowed: ${[...ALL_ALGS].sort().join(", ")}.`,
    );
  }
  if (
    SYMMETRIC.has(alg) &&
    opts.key instanceof Uint8Array &&
    opts.key.byteLength < MIN_HS_KEY_BYTES
  ) {
    throw new JwtError(
      "weak_hs_secret",
      `jwt(): ${alg} secret must be at least ${MIN_HS_KEY_BYTES} bytes (RFC 7518 §3.2); got ${opts.key.byteLength}.`,
    );
  } 
  if (typeof opts.maxLifetimeSeconds !== "number" || !Number.isFinite(opts.maxLifetimeSeconds) || opts.maxLifetimeSeconds <= 0) {
    throw new JwtError(
      "missing_max_lifetime",
      "jwt(): maxLifetimeSeconds is required and must be a positive number — a token that never expires is wrong in every threat model.",
    );
  }
  if (opts.acknowledgeNoExp === true && isProductionEnv(opts.env) && opts.secureDefaults !== false) {
    throw new JwtError(
      "ack_no_exp_refused_in_production",
      "jwt(): acknowledgeNoExp: true is refused in production under secureDefaults — every issued JWT must carry an exp claim.",
    );
  }

  const resolved: Promise<ResolvedSigner> = (async () => {
    const key = await importKey(alg, opts.key, "sign");
    return {
      alg,
      key,
      maxLifetimeSeconds: opts.maxLifetimeSeconds,
      allowNoExp: opts.acknowledgeNoExp === true,
      header: opts.header && isJsonObject(opts.header) ? { ...opts.header } : {},
    };
  })();

  return {
    async sign(payload: Record<string, unknown>): Promise<string> {
      if (!isJsonObject(payload)) {
        throw new JwtError("invalid_payload", "jwt().sign(): payload must be a plain object.");
      }
      const r = await resolved;
      const now = Math.floor(Date.now() / 1000);
      const iat = typeof payload.iat === "number" ? payload.iat : now;
      const expRaw = payload.exp;
      if (expRaw === undefined) {
        if (!r.allowNoExp) {
          throw new JwtError(
            "missing_exp",
            "jwt().sign(): payload is missing the exp claim. Set payload.exp = unix seconds, or construct the signer with acknowledgeNoExp: true outside production.",
          );
        }
      } else {
        if (typeof expRaw !== "number" || !Number.isFinite(expRaw)) {
          throw new JwtError("invalid_exp", "jwt().sign(): payload.exp must be a finite number of seconds since the Unix epoch.");
        }
        const lifetime = expRaw - iat;
        if (lifetime > r.maxLifetimeSeconds) {
          throw new JwtError(
            "exp_exceeds_max_lifetime",
            `jwt().sign(): payload.exp - iat (${lifetime}s) exceeds maxLifetimeSeconds (${r.maxLifetimeSeconds}s).`,
          );
        }
        if (lifetime <= 0) {
          throw new JwtError(
            "exp_in_past",
            "jwt().sign(): payload.exp must be strictly greater than iat.",
          );
        }
      }
      const header = { ...r.header, alg: r.alg, typ: "JWT" };
      const headerB64 = b64urlEncode(ENC.encode(JSON.stringify(header)));
      const payloadB64 = b64urlEncode(ENC.encode(JSON.stringify(payload)));
      const signingInput = `${headerB64}.${payloadB64}`;
      const sig = new Uint8Array(
        await getCrypto().subtle.sign(buildSignAlgorithm(r.alg), r.key, ENC.encode(signingInput) as BufferSource),
      );
      return `${signingInput}.${b64urlEncode(sig)}`;
    },
  };
}

function looksLikeJwkSource(key: JwtVerifierOptions["key"]): boolean {
  if (typeof key === "function") return true; // resolver — assume JWKS
  return isJsonWebKey(key);
}

function normalizeStringSet(value: string | string[] | undefined): ReadonlySet<string> | null {
  if (value === undefined) return null;
  const arr = typeof value === "string" ? [value] : value;
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new JwtError(
      "invalid_string_set",
      "jwt(): issuer/audience option must be a non-empty string or string[].",
    );
  }
  for (const v of arr) {
    if (typeof v !== "string" || v.length === 0) {
      throw new JwtError(
        "invalid_string_set",
        "jwt(): issuer/audience entries must be non-empty strings.",
      );
    }
  }
  return new Set(arr);
}

/**
 * Create a JWT verifier locked to an explicit algorithm allowlist. Validates
 * `exp` / `nbf` / `iat` on every call (clock skew configurable). Refuses
 * `alg: "none"` and any token whose header `alg` is not in the allowlist;
 * refuses-at-construction when a symmetric algorithm (`HS*`) is mixed with
 * a JWK / JWKS-shaped key source (the documented confused-deputy attack).
 *
 * @since 0.21.0
 */
export function createJwtVerifier(opts: JwtVerifierOptions): { verify(token: string): Promise<JwtVerified> } {
  if (!opts || typeof opts !== "object") {
    throw new JwtError("invalid_options", "jwt(): verifier options object is required.");
  }
  if (!Array.isArray(opts.algorithms) || opts.algorithms.length === 0) {
    throw new JwtError(
      "missing_algorithms",
      "jwt(): verifier requires an explicit, non-empty algorithms allowlist — no implicit defaults.",
    );
  }
  const allow = new Set<JwtAlgorithm>();
  for (const alg of opts.algorithms) {
    if ((alg as unknown) === "none") {
      throw new JwtError("alg_none_refused", 'jwt(): alg "none" cannot appear in the allowlist.');
    }
    if (!ALL_ALGS.has(alg)) {
      throw new JwtError(
        "invalid_alg",
        `jwt(): unknown algorithm "${String(alg)}" in allowlist.`,
      );
    }
    allow.add(alg);
  }
  const hasSym = [...allow].some((a) => SYMMETRIC.has(a));
  if (
    hasSym &&
    opts.key instanceof Uint8Array &&
    opts.key.byteLength < MIN_HS_KEY_BYTES
  ) {
    throw new JwtError(
      "weak_hs_secret",
      `jwt(): HS* secret must be at least ${MIN_HS_KEY_BYTES} bytes (RFC 7518 §3.2); got ${opts.key.byteLength}.`,
    );
  }
  if (
    hasSym &&
    opts.refuseSymmetricWithJwk !== false &&
    looksLikeJwkSource(opts.key)
  ) {
    throw new JwtError(
      "sym_with_jwk_refused",
      "jwt(): symmetric algorithms (HS*) mixed with a JWK / JWKS key source are refused — this is the documented JWKS confused-deputy attack. Use asymmetric algorithms (RS/PS/ES/EdDSA), or pass refuseSymmetricWithJwk: false to override (not recommended).",
    );
  }
  if (opts.clockSkewSeconds !== undefined) {
    if (typeof opts.clockSkewSeconds !== "number" || !Number.isFinite(opts.clockSkewSeconds) || opts.clockSkewSeconds < 0) {
      throw new JwtError(
        "invalid_clock_skew",
        "jwt(): clockSkewSeconds must be a non-negative finite number.",
      );
    }
  }
  const issuers = normalizeStringSet(opts.issuer);
  const audiences = normalizeStringSet(opts.audience);

  const keyCache = new Map<string, CryptoKey>();
  async function resolveKey(header: Record<string, unknown>): Promise<CryptoKey> {
    const algRaw = header.alg;
    if (typeof algRaw !== "string" || !allow.has(algRaw as JwtAlgorithm)) {
      throw new JwtError(
        "alg_not_allowed",
        `jwt(): token alg "${String(algRaw)}" is not in the allowlist.`,
      );
    }
    const alg = algRaw as JwtAlgorithm;
    const material =
      typeof opts.key === "function" ? await opts.key(header) : opts.key;
    if (typeof opts.key !== "function") {
      const cacheKey = alg;
      const cached = keyCache.get(cacheKey);
      if (cached) return cached;
      const imported = await importKey(alg, material, "verify");
      keyCache.set(cacheKey, imported);
      return imported;
    }
    return importKey(alg, material, "verify");
  }

  const resolved: ResolvedVerifier = {
    algorithms: allow,
    resolveKey,
    issuers,
    audiences,
    clockSkewSeconds: opts.clockSkewSeconds ?? 0,
    now: opts.now ?? (() => Math.floor(Date.now() / 1000)),
  };

  return {
    async verify(token: string): Promise<JwtVerified> {
      return verifyInternal(token, resolved);
    },
  };
}

async function verifyInternal(token: string, r: ResolvedVerifier): Promise<JwtVerified> {
  if (typeof token !== "string" || token.length === 0) {
    throw new JwtError("invalid_token", "jwt(): token must be a non-empty string.");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new JwtError("invalid_token", "jwt(): token must have three dot-separated segments.");
  }
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(DEC.decode(b64urlDecode(headerB64))) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof JwtError) throw err;
    throw new JwtError("invalid_token", "jwt(): header is not valid JSON.");
  }
  try {
    payload = JSON.parse(DEC.decode(b64urlDecode(payloadB64))) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof JwtError) throw err;
    throw new JwtError("invalid_token", "jwt(): payload is not valid JSON.");
  }
  if (!isJsonObject(header) || !isJsonObject(payload)) {
    throw new JwtError("invalid_token", "jwt(): header and payload must be JSON objects.");
  }
  const algRaw = header.alg;
  if (algRaw === "none") {
    throw new JwtError("alg_none_refused", 'jwt(): token alg "none" is refused.');
  }
  if (typeof algRaw !== "string" || !r.algorithms.has(algRaw as JwtAlgorithm)) {
    throw new JwtError(
      "alg_not_allowed",
      `jwt(): token alg "${String(algRaw)}" is not in the allowlist.`,
    );
  }
  const alg = algRaw as JwtAlgorithm;
  const key = await r.resolveKey(header);
  const sig = b64urlDecode(sigB64);
  const signingInput = ENC.encode(`${headerB64}.${payloadB64}`);
  let ok: boolean;
  try {
    ok = await getCrypto().subtle.verify(buildSignAlgorithm(alg), key, sig as BufferSource, signingInput as BufferSource);
  } catch {
    throw new JwtError("invalid_signature", "jwt(): signature verification threw.");
  }
  if (!ok) {
    throw new JwtError("invalid_signature", "jwt(): signature verification failed.");
  }

  const now = r.now();
  try {
    assertTemporalClaims(payload as { exp?: unknown; nbf?: unknown; iat?: unknown }, {
      now,
      clockSkewSeconds: r.clockSkewSeconds,
    });
  } catch (err) {
    if (err instanceof TemporalClaimError) {
      throw new JwtError(err.code, `jwt(): ${err.message}`);
    }
    throw err;
  }
  if (r.issuers) {
    const iss = payload.iss;
    if (typeof iss !== "string" || !r.issuers.has(iss)) {
      throw new JwtError("invalid_issuer", "jwt(): payload.iss does not match the expected issuer(s).");
    }
  }
  if (r.audiences) {
    const aud = payload.aud;
    if (typeof aud === "string") {
      if (!r.audiences.has(aud)) {
        throw new JwtError("invalid_audience", "jwt(): payload.aud does not match the expected audience(s).");
      }
    } else if (Array.isArray(aud)) {
      const matched = aud.some((a) => typeof a === "string" && r.audiences!.has(a));
      if (!matched) {
        throw new JwtError("invalid_audience", "jwt(): payload.aud does not match the expected audience(s).");
      }
    } else {
      throw new JwtError("invalid_audience", "jwt(): payload.aud is missing or not a string / string[].");
    }
  }
  return { header, payload };
}
