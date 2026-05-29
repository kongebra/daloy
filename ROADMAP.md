# DaloyJS Roadmap

Source of truth for what's shipped, what's next, and the order we plan to ship it. Complements the [README](./README.md) (the pitch). Update this file when scope changes — never let it drift behind reality.

> **Release-slice naming.** Each shipped release is identified by its semver tag (e.g. `0.15.0`) plus a short thematic descriptor. The original per-release planning breakdown lives in [`otherdocs/secure-by-default-plan.md`](./otherdocs/secure-by-default-plan.md) for archaeological reference.

## Versioning policy

- Semver with a hard rule: every `0.x` minor bump **may** break the public API; every `1.x` minor bump **must not**.
- Once `1.0.0` ships, deprecations last at least one minor cycle before removal.

## Definition of done (every milestone)

1. Implementation in `src/` with no `any` leaks across public types.
2. Tests added; `pnpm coverage` stays at **≥90% lines / 90% functions**, `pnpm coverage:branches` at **≥90% branches**. Relaxed from 100% — see [AGENTS.md](AGENTS.md) for the pragmatic-escape clause on hard security work (unreachable defensive branches, tsx phantom lines).
3. `pnpm typecheck`, `pnpm test`, `pnpm build`, and CI pass.
4. Security impact considered; `SECURITY.md` or threat notes updated when relevant.
5. Public-facing docs (`website/app/docs/...`) updated.
6. README "Status" table reflects new capability.

---

## Shipped — `0.1.x` foundation

Published to npm as **`@daloyjs/core`** (latest: `0.32.0`).

### Core framework

- Trie router with static fast path, traversal guard, real `405 + Allow`.
- Contract-first `app.route()`, groups, encapsulated plugins, decorators.
- Standard Schema validation (Zod 4 / Valibot / ArkType / TypeBox).
- RFC 9457 problem+json error model with prod-mode redaction.
- OpenAPI 3.1 generator built into the core.
- In-process test client + contract-test runner.
- In-process typed client factory + Hey API codegen integration (`pnpm gen`).
- Adapters: Node / Bun / Deno / Cloudflare Workers / Vercel Edge.
- Pluggable structured logger + request id propagation.
- Graceful shutdown, `app.onClose()`, augmentable `AppState`.
- Mock mode, Scalar + Swagger UI handlers.

### Security primitives (always-on or one-liner opt-in)

- Body limits, content-type allowlist, prototype-pollution-safe JSON, path-traversal rejection, request timeout, header injection guards.
- Middleware: `secureHeaders`, `cors`, `rateLimit`, `requestId`, `bearerAuth`, `timing`, `timingSafeEqual`.

### Supply chain

- pnpm-first distribution with hardened `.npmrc`: `ignore-scripts=true`, `minimum-release-age=1440`, verified store integrity, reproducible lockfile, explicit `allowBuilds` allowlist.
- Hardened CI/CD: no `pull_request_target`, no shared Actions cache, top-level `permissions: {}`, SHA-pinned third-party actions, `step-security/harden-runner`, isolated tag-only npm publish workflow, npm trusted publishing with `--provenance`, CodeQL + Opengrep dual SAST (cosign-verified release binary), OpenSSF Scorecard, zizmor, Dependabot, CODEOWNERS on privileged files.
- Public guidance in [`SECURITY.md`](./SECURITY.md) and `website/docs/security/supply-chain`.

### Quality gates

- **≥90% lines + functions / ≥90% branches** enforced by `pnpm coverage` and `pnpm coverage:branches` (relaxed from 100% — see [AGENTS.md](AGENTS.md)).
- Regression coverage for repo-level security posture and scaffolder `.npmrc` hardening.

---

## Release log — `0.2.x` through `0.32.x`

| Version | Theme | Key additions |
|---|---|---|
| `0.2.x` | Confidence & lifecycle | `onSend` hook, GitHub Actions CI, `SECURITY.md`, OIDC publish w/ provenance, `pnpm create daloy` scaffolder (`node-basic`, `vercel-edge`, `cloudflare-worker`), docs metadata + ORM guides. |
| `0.3.x` | Streaming & observability | `sseStream` / `ndjsonStream` helpers, `otelTracing` hook, OpenAPI extras (`securitySchemes`, `webhooks`, `callbacks`, `discriminator`). |
| `0.4.0` | Input ergonomics | Multipart/form-data (`fileField`, `multipartObject`), CSRF helper (double-submit + same-site). |
| `0.5.0` | Project ops | Bun + Deno scaffolder templates + `--minimal`, `@daloyjs/core/rate-limit-redis` (ioredis + node-redis), `daloy inspect` CLI. |
| `0.6.x` | Plugin lifecycle | `onPluginInstalled`, `onShutdown` events. |
| `0.7.x` | Edge-friendly sessions | Signed-cookie session (`__Host-`, HMAC-SHA256, key rotation), pluggable `SessionStore`, `ctx.state.session`. |
| `0.8.x` | Adapter modernization | Web-standard adapter cleanup. |
| `0.9.x` | Banner + runtime upgrade | Boot banner; Node ≥ 24.15 floor. |
| `0.10.x` | Branch coverage gate | `pnpm coverage:branches` against compiled JS, enforced ≥95% in CI. |
| `0.11.0` | WebSockets | RFC 6455 frame protocol in `src/websocket.ts`, typed `app.ws(path, handler)`, `defineWebSocket()`, Node + Bun adapter wiring, `@daloyjs/core/websocket` subpath. |
| `0.12.0` | CSRF + CSP hardening | CSRF Fetch-Metadata strategy, dual CSRF (`"both"`), CSP nonce + Trusted Types in `secureHeaders()`, `basicAuth()` w/ UTF-8 credential decoding. |
| `0.13.0` | DX polish | `createApp(options)` alias, `daloy dev` watcher with `--runtime <node\|bun\|deno>` override, OpenAPI `info` autofill from `deno.json` / `deno.jsonc`. |
| `0.13.1` | OpenAPI YAML | `GET /openapi.yaml` mounted alongside JSON, `openapiYamlPath` option, dependency-free `openapiToYAML`. |
| `0.14.x` | AI-friendly route metadata | Optional `meta` on routes (examples, summary, tags, `x-*`), schema-validated example pairs, `daloy inspect --ai`, `--yaml` / `--format yaml` output, docs at `website/app/docs/ai-metadata/`. |
| `0.15.0` | Secure-by-default (slice 1) | Log redaction defaults, stripped `Server` / `X-Powered-By`, duplicate `Host` / `Content-Length` rejection, `@daloyjs/core/hashing` (`passwordHash` / `passwordVerify`), `verifyWebhookSignature` / `signWebhookPayload`, explicit `app({ env })` with `NODE_ENV` mismatch warning. |
| `0.16.0` | Secure-by-default (slice 2) | `secureHeaders()` auto-applied, cross-origin state-changing requests → `403` unless `cors()` allows, per-route `accepts` content-type opt-in. |
| `0.17.0` | Secure-by-default (slice 3) | Refuse-to-boot on weak session secrets / `cors({ origin: "*" })` / `session()` + state-changing route without `csrf()`. First-request `500` on unconfigured `X-Forwarded-*`. |
| `0.18.0` | Secure-by-default (slice 4) | Connection-draining shutdown (`Connection: close` on `503` + in-flight), Node idle-close hook, `crashOnUnhandledRejection` default-on in prod, `app.healthcheck()` / `app.readinesscheck()` (bearer-token + per-IP rate limit), prod refuse-to-boot without `acknowledgeUnauthenticated: true`. |
| `0.19.0` | Secure-by-default (slice 5) | `rateLimit({ groupId })` shared buckets, `combine` primitives (`every` / `some` / `except`), `ipRestriction()` w/ CIDR IPv4/IPv6, `internal: true` routes (`404` via `app.fetch`, dispatch via `app.inject`). |
| `0.20.0` | Lifecycle leftovers | `loadShedding()`, `app.cspReportRoute()` + `secureHeaders({ reportingEndpoints, reportTo })`, `disconnectStatusCode: 499` default, `defineConfig({ schema, source })`. |
| `0.21.0` | JWT / scopes / etag | `createJwtSigner()` / `createJwtVerifier()` (`alg`-discipline, `exp`-required sign refusal), `requireScopes()` (RFC 6750 challenge, per-request aggregation), `etag()` helper w/ auto-skip on `Set-Cookie` / `Cache-Control: private \| no-store \| no-cache`. |
| `0.22.0` | Auth cohesion | `jwk()` asymmetric-only JWKS middleware, `bearerAuth({ verify })`, `basicAuth({ onAuthSuccess })`, `Cache-Control: no-store` on auth 401 challenges. |
| `0.23.0` | WebSocket + login throttle | `wsRateLimit()`, `loginThrottle()`, `rotateSession()`, file-upload magic-byte guards, `requirePayloadAuth`, WebSocket safe defaults. |
| `0.24.0` | Production fitness & deploy hardening | `app({ behindProxy })`, adapter-independent `ConnInfo`, `daloy doctor`, container-first `create-daloy` templates (`HEALTHCHECK`, `STOPSIGNAL SIGTERM`, non-root, `tini`), PSL-aware `subdomains()`, lazy `info.remote`, plugin `dependencies: string[]` refuse-to-boot, namespace-protected decorators, plugin extension `before` / `after` ordering w/ cycle detection, `defineDependency()`, scheme-aware `ctx.state.auth`, plugin lifecycle default `local`, required `name` + optional `seed` for stateful plugins. |
| `0.25.0` | Compression | `compression()` middleware on `CompressionStream` (`br` > `gzip` > `deflate`), BREACH-aware always-on guards (skip `Set-Cookie` / `Authorization` / session-or-CSRF cookie / already-compressed types), `minimumSize: 1024` + negative-ratio post-check, no `compressLevel: 9` opt-in, always-on `Vary: Accept-Encoding`, strong → weak ETag downgrade (RFC 9110). |
| `0.26.0` | Secure-by-default (slice 6) | `secureDefaults: false` production acknowledgement + audit log, JWT HS-secret length refusal, `secureHeaders()` dual framing-defense refusal, mandatory 2FA release-audit docs. |
| `0.27.0` | `secureDefaults` SSoT bake-ins | Cookie/time-claim SSoT helpers, `__Secure-` cookie refusal, zero-runtime-deps + secret-comparison CI gates. |
| `0.28.0` | Parity audit suite | `scripts/verify-parity-audits.ts` static gates → `pnpm verify:parity-audits`, `daloy doctor --audit-defaults` live-config audits. |
| `0.29.0` | Governance audit | `SECURITY-CONTACTS.md` rotation file, `scripts/verify-governance-audits.ts` → `pnpm verify:governance-audits`, release workflow contributor-rotation refusal, plugin-prerequisite + `topoSortExtensions` cycle-detection reaffirm, documented governance floor with `SECURITY.md` waiver-required removal. |
| `0.30.0` | Runtime parity bake-ins | Auth-failure `Cache-Control: no-store` (`UnauthorizedError` / `ForbiddenError` / `TooManyRequestsError`), CSP report receiver hardening (`application/json` → `415`, `maxBodyBytes > 64 KiB` refused at construction, prod sink omits report body unless `logCspReportBodies: true`), `cors()` `allowMethods` default narrowed to `[GET, HEAD, POST]` (refuse `methods: ['*']` at construction), reverse-proxy helper absence audit, compression skip-already-encoded reaffirm — wired into CI as `pnpm verify:runtime-parity-audits`. |
| `0.31.0` | Mature-Node second-pass bake-ins | Semicolon-delimiter refusal audit, error-handler-override refusal audit, `requestId()` trust-default audit, `addHttpMethod` RFC-method runtime allowlist + audit, draining `Connection: close` reaffirm audit. |
| `0.32.0` | WebSocket header immutability + httpError merge | WebSocket post-upgrade header immutability + pre-upgrade auth refuse-at-registration, `httpError({ res })` state-mutating-header refusal + Context-aware merge, middleware-order header-conflict refusal via `responseHeaders[]`. |

---

## In flight — `0.10.0` ratchet (carry-over)

Branch coverage gate is shipped at ≥95%. Remaining work:

- [ ] **Ratchet `pnpm coverage:branches` to ≥98%** — incrementally test uncovered branches in `lambda`, `openapi`, `client`, `cli`, `streaming` and bump `--test-coverage-branches` in `package.json` as the floor rises.

---

## Stabilization — `1.0.0` ("public API freeze")

Target ship date: when all of these are simultaneously true. We'd rather delay `1.0.0` than freeze the wrong API.

- [ ] No breaking change in two consecutive `0.x` minors.
- [ ] At least three production users on file (internal + external).
- [ ] Public benchmark suite published with reproducible numbers.
- [ ] Migration guide from the most-used Node frameworks.
- [ ] Security policy and disclosure process have been exercised at least once.
- [ ] Branch coverage has a stable high-confidence gate; ignored branches have documented runtime / source-map reasons. *(Gate shipped; ratchet to ≥98% is the open `0.10.0` subtask above.)*

---

## Later — researching

Items we want but don't yet have a concrete design for. Fair game to prototype; nothing here blocks `1.0.0`.

- [ ] **Portable `pnpm verify:supply-chain` umbrella** — single script callable from any CI host (GitLab, Bitbucket, Azure Pipelines, Jenkins, Drone, on-prem) that runs the non-GitHub-Actions-specific supply-chain checks: `pnpm verify:lockfile`, `pnpm audit --prod`, `pnpm verify:sbom` (when generated), zero-runtime-dep gate. Makes the portable half of the marketing claim *runnable*, not just documented.
- [ ] HTTP/2 + HTTP/3 adapters (Node h2; explore Workers AutoHTTP/3).
- [ ] Pluggable serialization (CBOR, MessagePack) gated by `Accept`.
- [ ] First-class background-job interface (queue-agnostic).

---

## Out of scope (intentional)

Avoiding scope creep is part of the design. Explicit non-goals:

- A built-in ORM or query builder.
- A bundled UI / view layer.
- Project-wide DI containers.
- Anything that requires patching `globalThis` or monkey-patching `Request` / `Response`.

---

## How to propose a roadmap change

1. Open an issue titled `roadmap: <change>`.
2. Describe the user-visible problem first; design comes second.
3. Reference the milestone you'd like the work to land in and why.
4. If accepted, open a PR that updates this file in the same change as the implementation.

The maintainers explicitly reserve the right to defer or drop items based on real usage signal — the roadmap is a plan, not a contract.
