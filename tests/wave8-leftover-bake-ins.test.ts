/**
 * Wave 8 — single-source-of-truth bake-in regression coverage.
 *
 * Validates the four SSoT surfaces shipped in 0.27.0:
 *
 *   1. {@link assertCookieAttributes} / {@link serializeCookie} / {@link readRequestCookie}
 *      from `src/cookie.ts` — the only place Daloy validates cookie attributes.
 *   2. {@link assertTemporalClaims} / {@link TemporalClaimError} from
 *      `src/time-claims.ts` — the only place Daloy validates JWT-style
 *      `exp` / `nbf` / `iat` claims.
 *   3. The `__Secure-` production refuse-to-boot guard added to
 *      `session()` and `csrf()`.
 *   4. The CI grep gates in `scripts/verify-no-runtime-deps.ts` and
 *      `scripts/verify-secret-comparisons.ts`.
 *
 * @since 0.27.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertCookieAttributes,
  readRequestCookie,
  serializeClearCookie,
  serializeCookie,
} from "../src/cookie.js";
import {
  TemporalClaimError,
  assertTemporalClaims,
} from "../src/time-claims.js";
import { session } from "../src/session.js";
import { csrf } from "../src/middleware.js";
import { findForbiddenRuntimeDependencies } from "../scripts/verify-no-runtime-deps.js";
import { findForbiddenSecretComparisons } from "../scripts/verify-secret-comparisons.js";

// ---------- cookie.ts ----------

test("assertCookieAttributes accepts a plain RFC 6265 cookie", () => {
  assert.doesNotThrow(() =>
    assertCookieAttributes({
      scope: "cookie",
      name: "session",
      attributes: { secure: true, path: "/", sameSite: "Lax", httpOnly: true },
    }),
  );
});

test("assertCookieAttributes rejects malformed names", () => {
  assert.throws(
    () => assertCookieAttributes({ scope: "cookie", name: "bad name", attributes: {} }),
    /cookie name/,
  );
  assert.throws(
    () => assertCookieAttributes({ scope: "cookie", name: "bad;name", attributes: {} }),
    /cookie name/,
  );
  assert.throws(
    () => assertCookieAttributes({ scope: "cookie", name: "", attributes: {} }),
    /cookie name/,
  );
});

test("assertCookieAttributes enforces __Host- contract", () => {
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "__Host-x",
        attributes: { secure: false, path: "/" },
      }),
    /__Host-/,
  );
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "__Host-x",
        attributes: { secure: true, path: "/api" },
      }),
    /__Host-/,
  );
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "__Host-x",
        attributes: { secure: true, path: "/", domain: "example.com" },
      }),
    /__Host-/,
  );
});

test("assertCookieAttributes enforces __Secure- contract", () => {
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "__Secure-x",
        attributes: { secure: false },
      }),
    /__Secure-/,
  );
  assert.doesNotThrow(() =>
    assertCookieAttributes({
      scope: "cookie",
      name: "__Secure-x",
      attributes: { secure: true },
    }),
  );
});

test("assertCookieAttributes refuses __Secure- without secure in production", () => {
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "__Secure-x",
        attributes: { secure: false },
        isProduction: true,
      }),
    /silently drop|production|HTTP/i,
  );
});

test("assertCookieAttributes enforces SameSite=None requires Secure", () => {
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "x",
        attributes: { sameSite: "None", secure: false },
      }),
    /SameSite/i,
  );
});

test("assertCookieAttributes enforces path starts with /", () => {
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "x",
        attributes: { path: "api" },
      }),
    /path must start/,
  );
});

test("serializeCookie round-trips through readRequestCookie", () => {
  const cookieLine = serializeCookie("session", "abc 123", {
    httpOnly: true,
    secure: true,
    path: "/",
    sameSite: "Lax",
    maxAgeSeconds: 60,
  });
  assert.match(cookieLine, /^session=abc%20123;/);
  assert.match(cookieLine, /HttpOnly/);
  assert.match(cookieLine, /Secure/);
  assert.match(cookieLine, /SameSite=Lax/);
  assert.match(cookieLine, /Max-Age=60/);

  // Simulate a browser sending the cookie back.
  const header = "other=value; session=abc%20123; trailing=1";
  assert.equal(readRequestCookie(header, "session"), "abc 123");
});

test("serializeCookie validates attributes through the shared cookie guard", () => {
  assert.throws(
    () => serializeCookie("bad;name", "value"),
    /cookieName/,
  );
  assert.throws(
    () => serializeCookie("__Secure-x", "value", { secure: false }),
    /__Secure-/,
  );
});

test("serializeClearCookie emits Max-Age=0", () => {
  const cleared = serializeClearCookie("session", { path: "/", secure: true });
  assert.match(cleared, /^session=;/);
  assert.match(cleared, /Max-Age=0/);
});

test("readRequestCookie returns null for missing or absent input", () => {
  assert.equal(readRequestCookie(null, "x"), null);
  assert.equal(readRequestCookie("", "x"), null);
  assert.equal(readRequestCookie("a=1; b=2", "missing"), null);
});

// ---------- time-claims.ts ----------

test("assertTemporalClaims accepts a valid token window", () => {
  const now = 1_700_000_000;
  assert.doesNotThrow(() =>
    assertTemporalClaims(
      { iat: now - 10, nbf: now - 5, exp: now + 60 },
      { now },
    ),
  );
});

test("assertTemporalClaims rejects expired tokens", () => {
  const now = 1_700_000_000;
  assert.throws(
    () => assertTemporalClaims({ exp: now - 1 }, { now }),
    (err) => err instanceof TemporalClaimError && err.code === "token_expired",
  );
});

test("assertTemporalClaims rejects nbf in future", () => {
  const now = 1_700_000_000;
  assert.throws(
    () => assertTemporalClaims({ nbf: now + 60 }, { now }),
    (err) => err instanceof TemporalClaimError && err.code === "token_not_yet_valid",
  );
});

test("assertTemporalClaims rejects iat in future", () => {
  const now = 1_700_000_000;
  assert.throws(
    () => assertTemporalClaims({ iat: now + 60 }, { now }),
    (err) => err instanceof TemporalClaimError && err.code === "iat_in_future",
  );
});

test("assertTemporalClaims rejects non-finite numeric claims", () => {
  const now = 1_700_000_000;
  assert.throws(
    () => assertTemporalClaims({ exp: "soon" as unknown as number }, { now }),
    (err) => err instanceof TemporalClaimError && err.code === "invalid_exp",
  );
  assert.throws(
    () => assertTemporalClaims({ nbf: Number.NaN }, { now }),
    (err) => err instanceof TemporalClaimError && err.code === "invalid_nbf",
  );
  assert.throws(
    () => assertTemporalClaims({ iat: Number.POSITIVE_INFINITY }, { now }),
    (err) => err instanceof TemporalClaimError && err.code === "invalid_iat",
  );
});

test("assertTemporalClaims honors clockSkewSeconds at both ends", () => {
  const now = 1_700_000_000;
  // exp just past, but inside skew window — accepted.
  assert.doesNotThrow(() =>
    assertTemporalClaims({ exp: now - 5 }, { now, clockSkewSeconds: 10 }),
  );
  // nbf just ahead, but inside skew window — accepted.
  assert.doesNotThrow(() =>
    assertTemporalClaims({ nbf: now + 5 }, { now, clockSkewSeconds: 10 }),
  );
});

// ---------- __Secure- refuse-to-boot on session() and csrf() ----------

test('session() refuses "__Secure-" cookie name without secure:true', () => {
  assert.throws(
    () =>
      session({
        secret: "x".repeat(48),
        cookieName: "__Secure-foo",
        cookieOptions: { secure: false },
      }),
    /__Secure-/,
  );
});

test('session() accepts "__Secure-" cookie when secure:true and path:/', () => {
  assert.doesNotThrow(() =>
    session({
      secret: "x".repeat(48),
      cookieName: "__Secure-foo",
      cookieOptions: { secure: true, path: "/" },
    }),
  );
});

test('csrf() refuses "__Secure-" cookie name without secure:true', () => {
  assert.throws(
    () =>
      csrf({
        cookieName: "__Secure-foo",
        cookieOptions: { secure: false },
      }),
    /__Secure-/,
  );
});

// ---------- CI gates ----------

test("verify-no-runtime-deps treats an empty dependencies block as clean", () => {
  assert.deepEqual(findForbiddenRuntimeDependencies({ dependencies: {} }), []);
  assert.deepEqual(findForbiddenRuntimeDependencies({}), []);
});

test("verify-no-runtime-deps flags any non-empty dependencies block", () => {
  const found = findForbiddenRuntimeDependencies({ dependencies: { lodash: "^4" } });
  assert.deepEqual([...found], ["lodash"]);
});

test("verify-secret-comparisons flags forbidden equality on header-derived values", () => {
  const sample = [
    '// safe: comparing scheme name',
    'if (scheme === "Bearer") return true;',
    '// safe: OpenAPI enum comparison, not a header-derived cookie secret',
    'if (options.in !== "header" && options.in !== "query" && options.in !== "cookie") fail();',
    "",
    "// unsafe: comparing the actual secret",
    "if (authorizationToken === provided) return true;",
    "",
    "// unsafe: hardcoded API key literal is still a secret comparison",
    'if (apiKey === "dev-secret") return true;',
    "",
    "// unsafe: direct header read compared with strict equality",
    'if (ctx.request.headers.get("authorization") !== expected) return false;',
    "",
    "// unsafe: cookie value",
    "if (cookieValue !== expectedCsrfToken) reject();",
  ].join("\n");
  const findings = findForbiddenSecretComparisons("sample.ts", sample);
  // The static `"Bearer"` and OpenAPI enum lines are allowed; the four
  // actual secret comparisons fail.
  assert.equal(findings.length, 4);
  assert.match(findings[0]!.text, /authorizationToken/);
  assert.match(findings[1]!.text, /apiKey/);
  assert.match(findings[2]!.text, /headers\.get/);
  assert.match(findings[3]!.text, /cookieValue/);
});

test("verify-secret-comparisons accepts the audited source files", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const files = ["src/session.ts", "src/security.ts", "src/security-schemes.ts", "src/middleware.ts"];
  let total = 0;
  for (const f of files) {
    const text = await readFile(path.resolve(process.cwd(), f), "utf8");
    total += findForbiddenSecretComparisons(f, text).length;
  }
  assert.equal(total, 0, "audited files must remain free of forbidden secret comparisons");
});
