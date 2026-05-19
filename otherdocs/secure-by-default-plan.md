# Secure-by-default initiative — plan

Status: **Wave 1 shipped in `@daloyjs/core@0.15.0`; later waves remain planned.**

Origin: `security_task.txt` (May 18, 2026). The brief argues that NestJS wins on *documented* security because it tells developers what to do, while DaloyJS should win by **doing it for them**. This plan converts that thesis into shippable waves with explicit breaking-change boundaries.

---

## Guiding rule

> If there is exactly **one** correct answer and no legitimate policy reason to choose otherwise, the framework picks it. If there are multiple correct answers (JWT vs. session, RBAC vs. ABAC, bcrypt vs. argon2 cost factor), the framework stays out and documents the choice instead.

This is consistent with Daloy's existing posture (proto-pollution-safe JSON in core, path-traversal rejection, default 5xx redaction, body/timeout limits as core options) and with the framework's stated threat model in `SECURITY.md`.

---

## What already ships (do not re-implement)

Confirmed in `src/` as of `@daloyjs/core@0.12.0`:

- `secureHeaders()` middleware with HSTS, X-Frame-Options, X-Content-Type-Options, CSP with nonce, Trusted Types, COOP/COEP/CORP. **Opt-in.**
- `cors()` middleware. **Opt-in, no default deny posture.**
- `csrf()` middleware including Fetch-Metadata and dual strategies. **Opt-in.**
- `session()` with signed cookies (`__Host-` prefix, HMAC-SHA256, rotation). **Opt-in.**
- `rateLimit()` with in-memory + Redis store. **Opt-in.**
- `bearerAuth()`, `basicAuth()`, `timingSafeEqual()`. **Opt-in.**
- Body limits, content-type allowlist, request timeout, header-injection guards, `safeJsonParse` (strips `__proto__` / `constructor` / `prototype`), path-traversal rejection. **On by default.**
- Production-mode 5xx redaction. **On by default.**
- Supply-chain hardening (blocked install scripts, release-age cooldown, SHA-pinned CI, OIDC provenance). **On by default.**

The initiative is **mostly about flipping defaults**, not building from scratch. Exceptions called out per item below.

---

## Scope decisions: items kept, reshaped, or dropped

### Kept as written

Headers (preload HSTS, nosniff, frame-deny, referrer strict, strip `Server` / `X-Powered-By`), cookie defaults (Secure + HttpOnly + SameSite=Lax), CORS deny cross-origin state-changing methods unless allowlisted, a password hashing helper with no exposed knobs, weak-secret refuse-to-boot, logging redaction defaults, per-content-type body caps, duplicate `Host` / `Content-Length` rejection, connection-draining shutdown, crash-on-unhandled-rejection in prod, rate-limited + auth-required health/readiness primitive, opt-in one-liners (WS/GraphQL rate-limit adapters, webhook HMAC verify, login slow-down preset, session rotation on privilege change, file-upload magic-byte guard, static server hardening).

### Reshaped

1. **"Auto-enable CSRF when cookie sessions detected"** → **Refuse-to-boot if `session()` is registered and any route accepts a state-changing method without `csrf()` registered.** Auto-enabling CSRF on every cookie surprises SPA + bearer-token apps that legitimately set non-session cookies, and silent middleware insertion is the wrong shape for a contract-first framework. A boot-time error with a one-line opt-out (`app({ csrf: "off" })`) gets the same safety without the surprise.

2. **"Auto-detect production (don't rely on NODE_ENV)"** → **Read `NODE_ENV` *and* accept `app({ env: "production" })`; loudly warn when signals disagree.** Inventing a new detection oracle from runtime env vars (`AWS_LAMBDA_FUNCTION_NAME`, `VERCEL`, `DENO_DEPLOYMENT_ID`, …) trades one heuristic for many. The clean primitive is an explicit constructor option; ambient detection becomes a *warning surface*, not a security boundary.

3. **"Refuse to boot if `X-Forwarded-*` present without trust-proxy configuration"** → kept, but **scoped to the first request, not boot**, because Daloy supports zero-config serverless adapters where you cannot know proxy headers at boot time. First request with `X-Forwarded-For` and no `trustProxy` config → 500 with a clear `problem+json` (rather than silent IP spoofing in the rate limiter). One-line opt-out: `app({ trustProxy: false })` to explicitly say "do not trust".

### Dropped from this initiative

- Auto-CSRF-on-cookie-detection (replaced above).
- Auto-prod-detection beyond `NODE_ENV` + explicit option (replaced above).

---

## Waves

Each wave ships independently. **Quality gate per `AGENTS.md`:** every wave runs `pnpm coverage` (100% lines + functions), `pnpm typecheck`, `pnpm test`, `pnpm build`, plus `cd website && pnpm typecheck && pnpm build` when docs change. Every wave also updates the README Status table.

### Wave 1 — non-breaking additions (shipped in `0.15.0`)

| Item | Surface | Status |
| --- | --- | --- |
| Logging redaction defaults (authorization, cookie, set-cookie, x-api-key, password, token, OAuth-style keys, JWT-shaped strings) | `src/logger.ts` — `createLogger({ redact })`, `DEFAULT_REDACT_KEYS` | ✅ shipped |
| Strip `Server` and `X-Powered-By` from every response | `src/app.ts` `finalizeResponse` (opt-out: `stripServerHeaders: false`) | ✅ shipped |
| Reject duplicate `Host` and duplicate `Content-Length` headers | `src/security.ts` `assertNoDuplicateSingletonHeaders` + `SMUGGLING_SINGLETON_HEADERS`, called in `App.fetch` before user hooks | ✅ shipped |
| Password hashing helper with no knobs (scrypt, OWASP params; argon2id deferred to keep `dependencies: {}`) | `src/hashing.ts` exported as `@daloyjs/core/hashing` (`passwordHash` / `passwordVerify`; fixed PHC params enforced on verify) | ✅ shipped |
| Webhook HMAC verify helper with constant-time comparison | `src/security.ts` `verifyWebhookSignature` + `signWebhookPayload` (SHA-256/384/512 only; mismatched / SHA-1 prefixes rejected) | ✅ shipped |
| `app({ env: "production" })` explicit option; warn on `NODE_ENV` mismatch | `src/app.ts` (`env`, `warnOnEnvMismatch`, `isProduction`) | ✅ shipped |

Breaking? **No.** All additions or stricter behavior on already-malformed input. Test coverage: see `tests/wave1-secure-defaults.test.ts` + `tests/hashing.test.ts` (36 new tests; `pnpm coverage` still passes at the 99.9% line / 100% function gate).

### Wave 2 — flip defaults (shipped in `0.16.0`, breaking)

Every flip ships with a **single escape hatch**: `app({ secureDefaults: false })` restores pre-0.16 behavior wholesale. Per-feature opt-outs (`app({ secureHeaders: false })`, `app({ corsCrossOriginGuard: false })`) also work.

| Item | Today | After | Status |
| --- | --- | --- | --- |
| `secureHeaders()` | Opt-in middleware | Auto-applied with preload HSTS, frame-deny, nosniff, strict referrer. User-installed `secureHeaders(...)` replaces the auto-installed instance via the new `SECURE_HEADERS_MARKER` symbol so user overrides win instead of being shadowed | ✅ shipped in `0.16.0` |
| Cookie defaults | Caller-specified | `session()` and `csrf()` already issue `Secure; HttpOnly; SameSite=Strict; __Host-` cookies — no behavioral change needed | ✅ shipped (already met) |
| CORS state-changing methods | Permitted if no `cors()` registered | **Rejected cross-origin with `403 problem+json` unless the matched route's `cors()` policy allows the request origin** (detected via the new `CORS_HOOK_MARKER` and `CORS_ORIGIN_ALLOW_MARKER` symbols). Read-only methods, same-origin, missing `Origin`, and `Origin: null` all pass through. Malformed `Origin` returns `403` | ✅ shipped in `0.16.0` |
| Content-Type allowlist | Permissive | Per-route `route({ accepts: [...] })` field overrides the global `allowedContentTypes` allowlist so legacy form-encoded handlers can opt in without loosening the default for the rest of the app. Global default unchanged (kept permissive to avoid silently breaking existing apps; further tightening tracked for later patches) | ✅ shipped in `0.16.0` (per-route opt-in only) |

Migration guide required. `create-daloy` templates updated in the same release per the release-coordination rule in `AGENTS.md`. Test coverage: `tests/wave2-secure-defaults.test.ts` (23 tests; `pnpm coverage` passes the 99.9% line / 100% function gate).

### Wave 3 — boot-time and first-request guards (target: `0.17.x`)

| Item | Behavior | Status |
| --- | --- | --- |
| Weak HMAC/JWT secret check | Refuse to boot in prod when session/CSRF/JWT secrets are `< 32 bytes` of entropy, default values, or known weak strings | ✅ shipped in `0.17.0` (session() only; JWT helper out of scope until Wave 5) |
| Trust-proxy unconfigured | First request with `X-Forwarded-*` and `trustProxy` unset → 500 problem+json. Opt-out: `app({ trustProxy: false })` explicitly | ✅ shipped in `0.17.0` |
| Session + state-changing route without CSRF | Refuse to boot. Opt-out: `app({ csrf: "off" })` | ✅ shipped in `0.17.0` |
| `cors({ origin: "*" })` in prod | Refuse to boot | ✅ shipped in `0.17.0` |

### Wave 4 — lifecycle and health (target: `0.18.x`)

| Item | Notes |
| --- | --- |
| Connection-draining shutdown | Extend existing graceful shutdown; track in-flight requests; refuse new ones with `503 problem+json` carrying `Connection: close` + `Retry-After: 5`; in-flight responses gain `Connection: close`; Node adapter calls `server.closeIdleConnections()` immediately | ✅ shipped in `0.18.0` |
| Crash-on-unhandled-rejection in prod | `app({ crashOnUnhandledRejection })` defaults on in production; logs `fatal` then `process.exit(1)` on both `unhandledRejection` and `uncaughtException`. No-op on Workers / Edge / Fastly | ✅ shipped in `0.18.0` |
| Health/readiness primitive | `app.healthcheck()` and `app.readinesscheck()` — bearer-token auth (`timingSafeEqual`) + per-IP rate limit (60/min) by default; refuse-to-boot in production without `token` or `acknowledgeUnauthenticated: true`; readiness returns `503` while draining or while plugins are still pending | ✅ shipped in `0.18.0` |

### Wave 5 — opt-in one-liners (target: `0.18.x` patch line, additive)

- `wsRateLimit()` adapter and `graphqlRateLimit()` adapter (sub-exports).
- `loginThrottle()` preset (per-IP + per-username slow-down + lockout).
- `rotateSession()` helper invokable on privilege change.
- File-upload guard: MIME + magic-byte + size in one call on the multipart pipeline.
- Static server hardening (only if/when Daloy ships a static server — currently it does not, so this is **deferred** until that ships).

---

## Out of scope for this initiative

- JWT / JWK / OAuth2 / OIDC / Passport equivalents — these are policy. Documented as recipes only.
- RBAC / CASL — policy. Documented as recipes only.
- AES encryption recipe / bcrypt recipe — superseded by the first-party scrypt helper for password hashing; AES is policy (key management, IV scheme, AAD) and stays as a documented recipe.
- DI guards/interceptors/pipes/filters model — architectural decision separate from security, do not bundle.

---

## Risk register

| Risk | Mitigation |
| --- | --- |
| Wave 2 silently breaks production deployments | `secureDefaults: false` master switch; loud changelog; migration guide; `create-daloy` templates bumped same release; warn for one minor before flip — actually, **do not** warn-for-a-cycle: that's a half-measure that lets unsafe apps stay unsafe. Ship the flip in `0.14.0` with the escape hatch and migration guide |
| Trust-proxy first-request 500 surprises serverless users | Adapter docs called out per platform (Vercel, Cloudflare, Lambda); zero-config templates set `trustProxy` to the right value for the platform |
| Refuse-to-boot creates outages in CI/staging that don't have prod secrets | Boot-check honors `app({ env })`; only fires in `production` env |
| Coverage gate blocks release | Each wave authored with tests first; phantom-line risk per user memory note (`testing.md`) — collapse JSDoc if needed |
| Coordination drift between `@daloyjs/core` and `create-daloy` | Follow the release-coordination block in `AGENTS.md` verbatim for every wave that bumps `@daloyjs/core` |

---

## Suggested first move when this initiative starts

Wave 1 in a single PR series. It's purely additive, exercises the test pipeline for every new module, and produces immediate marketing material ("Daloy now redacts secrets in logs by default; here's the diff vs. NestJS/Fastify/Hono"). Wave 2 then has a known-good baseline to flip from.
