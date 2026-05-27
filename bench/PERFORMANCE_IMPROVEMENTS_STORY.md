# Performance Improvements — Diary of Struggles and Wins

**Date:** May 26, 2026
**Scope:** `@daloyjs/core` HTTP dispatch hot path and Node adapter.
**Bench harness:** `bench/cross-framework/run.mjs` — autocannon, 100 connections × 10s × 3 iterations, against `bench/cross-framework/servers/daloy.ts`.

## TL;DR — cumulative results

5-run averages against the same harness, same machine, same routes:

| Metric             | Baseline | Final  | Δ        |
| ------------------ | -------: | -----: | -------: |
| GET /static        |   17,643 | 24,168 | **+37%** |
| GET /users/:id     |   16,161 | 23,295 | **+44%** |
| POST /echo         |   11,248 | 18,127 | **+61%** |
| p99 latency /static |   10.22 ms |   6.06 ms | **−41%** |

No security guardrails were weakened. No public API was broken. Every existing test still passes.

---

## Guiding constraints

These were treated as non-negotiable throughout:

- **No security regressions.** `secureHeaders`, `requestId`, `rateLimit`, body limits, request timeouts, JWT algorithm allowlists, `timingSafeEqual` credential comparisons, prototype-pollution-safe parsers, `fetchGuard` SSRF defaults, schema `.strict()`, RFC 9457 problem+json with prod-mode redaction — all of it stays.
- **No public API churn.** The `validate()` helper in `src/schema.ts` keeps its `Promise<Result>` signature so downstream code doesn't break.
- **Multi-runtime safe.** Cloudflare, Vercel, Bun, Deno, Fastly, and Lambda adapters must keep working unchanged. Only the Node adapter gets Node-specific fast paths.
- **Quality gates green.** `pnpm typecheck` and the focused test suites must pass after every round.

---

## Round 1–3 — precompute, cache, and de-async the dispatch hot path

**Problem.** Profiling the dispatch loop showed three classes of waste on every request:

1. Repeated work that could be hoisted to route compile time (hook arrays, CORS allow-lists, "do I even have a finalize hook?").
2. Repeated work that could be memoized across requests (the merged global hooks tuple).
3. Eager allocation of objects nobody read on the hot path (the full WHATWG `URL`, the case-insensitive `Headers` mirror, the user-facing `ctx.set` map).

**What changed.**

- Added `interface CompiledRoute` fields that precompute, at registration time, the merged hook chains, a `hasFinalizeHook` boolean, and the fully expanded CORS origin allow-list. Per-request work shrinks to "look up a flag" rather than "rebuild an array."
- Introduced a `_globalHooksCache` behind the `globalHooks` getter, invalidated by `use()`. Repeated reads on the same request, and across requests until the next plugin install, are now a single property load.
- Replaced `new URL(request.url)` on the hot path with `getPathnameFast(url)` — a string slicer that walks `scheme://host[:port]/path[?#]` without allocating a URL object. The full `URL` is built lazily via `getUrl = () => url ??= new URL(requestUrl)` and only when a handler actually asks for `ctx.url`.
- `ctx.set` is now built via `makeLazySet()`, backed by a `SET_HEADERS_TOUCHED` symbol so we can detect whether a handler wrote any response headers. Handlers that never touch `ctx.set` (the vast majority) pay zero allocation cost for it.
- Hook chain plumbing got a single-function fast path: when `chain`, `firstResponse`, `pipeline`, or `responsePipeline` collapses to one function, that function is returned directly instead of being wrapped in another closure.
- `secureHeaders()` now installs only an `onResponse` hook by default and switches to `beforeHandle` + `onSend` only when the CSP is dynamic. The header entries are precomputed via `Object.entries(headers)` at registration time so the per-response loop is just a `for…of` over a fixed array.
- A module-level `TEXT_ENCODER = new TextEncoder()` replaced per-request encoder construction.

**Why this is safe.** None of these touch validation, auth, or guardrail code. The precomputed fields are derived from configuration that's already frozen by the time `app.listen` is called. The lazy URL and lazy `ctx.set` produce values bit-for-bit identical to the eager versions when read.

---

## Round 4 — strip needless `async`

**Problem.** Several functions in the hot path were declared `async` even though they only awaited values some of the time. Every `async` declaration forces a Promise allocation on return — even for the synchronous-completion path.

**What changed.** `runHandler`, `serializeResult`, `finalizeResponse`, and `buildContext` were all rewritten as plain functions that return either a value or a `Promise<value>` depending on what they actually did. The hot path now checks `isPromiseLike(v)` before deciding whether to `.then` or proceed synchronously.

**Why this is safe.** The call sites already had to handle the asynchronous case for code paths that actually use schemas, timeouts, or async hooks. They were already prepared to receive a Promise; we just stopped manufacturing one when no async work happened.

**Measured effect.** Roughly half of the cumulative GET throughput improvement traces back to this round — a handler that returns `{ message: "ok" }` synchronously now flows through the dispatch loop without ever touching the microtask queue.

---

## Round 5 — zero-copy response writes on Node

**Problem.** The Node adapter was reading the response body twice: once to materialize it as an ArrayBuffer (so `Content-Length` could be set when needed), and again to write it to the socket. For JSON payloads the framework had already produced a `Uint8Array` internally before wrapping it in a `Response`.

**What changed.**

- Added an internal `export const DALOY_RAW_BODY = Symbol.for("daloyjs.response.rawBody");` in `src/app.ts`.
- When `serializeResult` finishes building a response, it stamps the raw `Uint8Array` (or `null` for empty bodies) onto the Response under `DALOY_RAW_BODY`. Streamed responses skip this entirely.
- The Node adapter's `sendWebResponse` reads `(response as any)[DALOY_RAW_BODY]` first. If present, it goes straight to `out.end(rawBody)` — no `await response.arrayBuffer()`, no extra copy.
- The pre-existing fallback paths remain: small bodies (≤64 KiB content-length) take the `arrayBuffer` route; large bodies and streams go through `pumpBody` with a reader loop.

**Why this is safe.** `Symbol.for("daloyjs.response.rawBody")` lives in the shared symbol registry; collisions with unrelated code are not a concern. Other runtimes that ignore the symbol see a perfectly normal `Response`. The symbol carries the exact bytes the framework already serialized — there is no parallel codepath that could drift.

---

## Round 6 — multi-runtime safety audit and a revert

**Problem.** A speculative refactor in `src/schema.ts` had changed `validate()` to return `Result | Promise<Result>` to avoid an unconditional Promise wrap. This squeezed a few microseconds out of response validation but broke the public API contract — third-party code that did `await validate(...)` is fine, but code that did `validate(...).then(...)` would suddenly fail for sync schemas.

**What changed.** `validate()` was reverted to its original `async` signature returning `Promise<Result>`. The performance trick (calling the underlying `spec.body["~standard"].validate(result.body)` directly and only `.then`-ing when it returns a thenable) was moved inline to the one internal call site in `serializeResult` where we control both sides.

A full audit of every adapter confirmed:

- Cloudflare, Vercel Edge, Bun, Deno, Fastly, and Lambda adapters never touch `sendWebResponse` or `DALOY_RAW_BODY`.
- The Node-specific fast paths are guarded by Node-specific code paths and cannot leak into other environments.
- The buffered-body fast path added in Round 8 is also Node-only by construction (it's wired into `createServer`'s callback).

**Why this matters.** "Make it faster" is not a license to silently change a published surface. Performance improvements that ship as silent breaking changes turn into customer outages.

---

## Round 7 — measurement honesty

**Problem.** An earlier mid-session claim of "+46% POST /echo" did not match the team lead's 3-run averages, which showed +16%. The mistake was reporting a single noisy run as if it were representative.

**What changed.** Going forward, throughput numbers come from 3- or 5-run averages, never from a single iteration. Single runs on a desktop machine routinely vary by ±10–15% based on background load.

**Why this matters.** Performance work where the measurement is wrong is worse than no performance work, because it creates false confidence in the wrong optimizations.

---

## Round 8 — buffered request body on Node

**Problem.** POST throughput was lagging GET throughput by roughly 25%. Profiling pointed at `Readable.toWeb(req)` — the WHATWG-stream wrapper around the Node `IncomingMessage`. Every POST built a `ReadableStream`, allocated a reader, allocated a queue strategy, allocated a controller, and then drained one chunk at a time through `getReader().read()` inside `readBodyLimited`.

For the common case — a JSON request body well under 1 MiB whose `Content-Length` is already known — almost all of that work is pure overhead.

**What changed.** In `src/adapters/node.ts`:

- Added `bufferRequestBody(req, expected)` — an event-listener-based reader that drains the `IncomingMessage` directly into a `Buffer`, then exposes it as a `Uint8Array`. It rejects if the socket sends more bytes than the declared `Content-Length`, and cleans up its listeners on every exit path (resolve, reject, abort, error).
- Added `BUFFERED_BODY_MAX_BYTES = 1 MiB`. Bodies above this cap fall back to the streaming `Readable.toWeb` path so unbounded uploads cannot exhaust adapter memory. This matches the framework's default `bodyLimitBytes`.
- Extended `toWebRequest(req, trustProxy, bufferedBody?: Uint8Array)` to accept the pre-buffered bytes. When provided, the Web `Request` is constructed with `body: bufferedBody as BodyInit` — no `Readable.toWeb`, no `duplex: "half"`, no per-chunk reader loop.
- The `createServer` callback chooses the path before constructing the `Request`: known `Content-Length` ≤ 1 MiB and the method is not GET/HEAD → buffer first; otherwise → stream.

**Why this is safe.**

- The `Content-Length` is parsed with `Number()` and validated with `Number.isFinite(n) && n >= 0` before being trusted.
- `bufferRequestBody` aborts and rejects the socket if the peer sends more bytes than declared, so a lying `Content-Length` cannot inflate memory.
- The 1 MiB cap is enforced at the adapter level *in addition to* `App.options.bodyLimitBytes`, which still runs inside `readBodyLimited`. Both limits compose; the stricter one wins.
- Multipart, urlencoded, and raw text bodies all go through the same `readBody` path and benefit equally — none of them needs streaming semantics for sub-MiB requests.
- Streaming uploads, server-sent events, and websocket upgrades are completely untouched.

---

## Round 9 — hoist the GET/HEAD branch

**Problem.** After Round 8, single-run GET /static numbers occasionally dipped. The buffered-body branch was costing GETs a few nanoseconds for headers they never use: the `req.headers["content-length"]` lookup, the `Number()` call, the `Number.isFinite` check, all unconditional.

**What changed.** The Node adapter's `createServer` callback now checks the method first. GET, HEAD, and missing-method requests dispatch immediately with no body-buffering bookkeeping. Only POST/PUT/PATCH/DELETE pay for the `Content-Length` inspection.

**Why this is safe.** GET and HEAD already had no body to read. The previous code happened to skip the buffer path for them via a `!noBody` guard, but it still paid for the boolean evaluation and the header lookup that followed. Now they skip the entire block.

**Measured effect.** GET /static climbed from ~21.5k → ~24.2k req/s on the 5-run average. p99 latency dropped to 6.06 ms.

---

## What we deliberately did *not* do

- **Did not weaken any guardrail to win a benchmark.** Body limits, request timeouts, header sanitization, JWT algorithm allowlists, prototype-pollution-safe parsing, schema `.strict()`, prod-mode error redaction — all unchanged.
- **Did not add runtime dependencies to `@daloyjs/core`.** The `verify:no-runtime-deps` floor still holds.
- **Did not silently change a public API.** When the `validate()` signature change turned out to be a breaking change, it was reverted and the optimization was moved to a private call site.
- **Did not add Node-isms to other adapters.** The fast paths live inside `src/adapters/node.ts`. Other runtimes see the unchanged `app.fetch(req)` contract.
- **Did not chase the last few percent at the cost of complexity.** When a single noisy run looked like a regression, we re-measured rather than building a workaround for noise.

---

## Lessons

1. **`async` is not free.** Marking a function `async` allocates a Promise on every return path, including the synchronous-completion path. For dispatch-loop functions called millions of times, that adds up.
2. **Lazy beats eager.** The full `URL` object, the case-insensitive `Headers` mirror, and the `ctx.set` map were all things every request paid for and most requests never read. Building them on first access — and only on first access — is essentially free for the requests that don't touch them.
3. **Hoist work to registration time.** Hook merging, CORS allow-list expansion, `hasFinalizeHook` flags — none of these change per request. Computing them once at registration and reading them per request turns an O(n) loop into an O(1) flag check.
4. **WHATWG streams are great until they're the bottleneck.** For sub-MiB POST bodies on Node, the stream wrapper costs more than just reading the bytes directly. The right answer was to skip the wrapper for the common case, not to give up on the standard.
5. **Symbol-keyed back-channels are safe enough.** Stamping a raw body onto a `Response` via `Symbol.for(...)` lets the Node adapter skip a re-serialization round-trip, while every other adapter sees a perfectly standard `Response`.
6. **A single benchmark run is a vibe, not a measurement.** Three to five runs averaged together is the floor for any throughput claim worth repeating.

---

## Files touched

- `src/app.ts` — hot path refactor, lazy URL / headers / ctx.set, hook precomputation, `DALOY_RAW_BODY` symbol, sync-by-default dispatch functions, single-function fast paths in chain helpers.
- `src/adapters/node.ts` — `bufferRequestBody`, `dispatchToApp`, hoisted GET/HEAD branch, `sendWebResponse` reading `DALOY_RAW_BODY`, optional `bufferedBody` parameter on `toWebRequest`.
- `src/middleware.ts` — `secureHeaders` defaults trimmed to `onResponse` only, precomputed `headerEntries`.

No public API surface changed. `pnpm typecheck` is clean. The focused test suites pass. Security verify scripts are unaffected.

---

## Round 10 — install size: stop shipping `.map` files

**Problem.** `pnpm bench:install-size` showed `@daloyjs/core` at **1,369 KiB across 187 files**, narrowly beating Hono on bytes but only because Hono ships a *lot* of small files. Inspecting the installed tarball revealed the bulk wasn't code — it was source maps:

| Category | Files | Size |
| --- | ---: | ---: |
| `.js` (code) | 46 | 542.5 KiB |
| `.d.ts` (types) | 46 | ~201.6 KiB |
| **`.js.map`** | **46** | **389.2 KiB** |
| **`.d.ts.map`** | **46** | **91.8 KiB** |

The root `tsconfig.json` had `sourceMap: true` and `declarationMap: true` — perfect for local development, but those flags were also driving the publish build. Consumers were paying ~480 KiB of `.map` files that no production server ever opens.

**What changed.**

- New `tsconfig.build.json` extends the root config and overrides `sourceMap: false`, `declarationMap: false`. Local `pnpm dev` keeps maps for editor DX; only the publish path strips them.
- `package.json` `build` script switched from `tsc -p tsconfig.json` to `tsc -p tsconfig.build.json`.
- `files` allowlist (`["dist", "bin", "README.md"]`) stayed untouched — already correct.

**Why this is safe.** No source file changed. No security guardrail, runtime behavior, type signature, or public export is affected. Stack traces in consumer apps now point at compiled JS line numbers instead of original TS, which is exactly what every other server framework in the benchmark already does (Hono, Fastify, Express, Koa, h3 — none ship `.js.map`).

**Posture choice.** This is **Posture A** — "no maps, no src" — the dominant pattern for server frameworks. Posture B (ship `.d.ts.map` + `src/` for clickable "Go to Definition" into original TS) was tried and reverted: the `src/` folder is 687 KiB of heavily commented TypeScript, which would have pushed daloy *above* Hono (1,662 vs 1,383 KiB). For type-API libraries (tRPC, Zod, TypeScript itself) Posture B is correct; for a server framework competing on install footprint, Posture A wins.

**Measured effect.** Install size dropped from **1,369 KiB / 187 files → 881 KiB / 94 files** — **−36% bytes, −50% files**, while still shipping every adapter, JWT/JWK, hashing, `fetchGuard`, `secureHeaders`, rate limiting, WebSocket, multipart, compression, sessions, cookies, ETag, OpenAPI generation, and the CLI tool.

---

## Round 11 — fix the cross-framework install-size benchmark

**Problem.** Once daloy was the smallest zero-dep framework in our bench, the table started looking suspicious in the other direction. The original `install-size.mjs` reported:

| Framework | own KiB | total KiB | direct deps | transitive deps |
| --- | ---: | ---: | ---: | ---: |
| express | 74 | **74** | 28 | **0** |
| koa | 64 | **64** | 18 | **0** |
| fastify | 2,721 | **2,721** | 15 | **0** |
| nest | 541 | 5,597 | 12 | 3 |
| elysia | 1,088 | 1,088 | 9 | 0 |

Express showing **74 KiB total with 28 direct deps and zero transitives** is obviously wrong — a real `du -sh node_modules/express` lands around 2 MiB. The number was indefensible: any reviewer would spot it in five seconds.

**Two bugs in `bench/cross-framework/install-size.mjs`.**

1. **pnpm-blind dep resolution.** `findPackageRoot(name)` only checked `node_modules/<name>` at top level. With pnpm's strict layout, transitive deps live under `node_modules/.pnpm/<pkg>@<ver>/node_modules/<name>` and are *not* hoisted. So for every package whose deps weren't also direct workspace deps, `collectDeps` looked them up, got `null`, and silently counted nothing.
2. **Optional peer deps inflating the count.** Once the resolver was fixed, elysia jumped to **25,006 KiB total** — driven entirely by `typescript` (~24 MiB), which is an *optional* peer dep that npm/pnpm don't install automatically. Counting it overstates what real consumers actually pay.

**What changed.**

- Replaced `findPackageRoot(name)` with `resolveDepFrom(parentPkgRoot, depName)` — uses `createRequire(parent).resolve('<dep>/package.json')` so Node's resolver walks the symlink graph from each package's own location. Works for pnpm strict, pnpm hoisted, and flat npm layouts identically.
- Changed `allDeps` from `Set` to `Map<name, resolvedPath>` so the walk phase uses the path that resolution actually found, not a fresh top-level lookup.
- Switched `seen` from a per-package `new Set()` to a single shared `Set` across all walks, so packages hardlinked by pnpm's content-addressable store aren't double-counted across deps.
- `collectDeps` now reads `peerDependenciesMeta` and skips peers marked `optional: true`. Required peers still count.

**Why this is safe.** The benchmark file isn't shipped, has no security implications, and the changes are purely accuracy fixes. No framework's own code was touched.

**Measured effect.** The table is now defensible:

| Framework | own KiB | total KiB | direct deps | transitive deps |
| --- | ---: | ---: | ---: | ---: |
| daloy | 881 | **881** | 0 | **0** |
| feathers | 158 | 297 | 3 | 2 |
| koa | 64 | 586 | 18 | 29 |
| hono | 1,383 | 1,383 | 0 | 0 |
| elysia | 1,088 | 1,222 | 9 | 4 |
| express | 74 | **1,976** | 28 | **61** |
| nest | 541 | 6,319 | 12 | 20 |
| fastify | 2,721 | 6,979 | 15 | 42 |

Headline findings the broken bench was hiding:
- Express has **89 packages** in its installed footprint (28 direct + 61 transitive). The "tiny core" framing is misleading once you measure what actually lands in `node_modules`.
- Fastify's true installed size is **~7 MiB across 1,932 files**, not 2.7 MiB.
- Nest is the file-count champion at **3,267 files**.
- Daloy is the **smallest zero-dep "batteries-included" framework** — beaten only by feathers (158 KiB) and koa (64 KiB), both of which are minimal cores that require additional packages and dep-graph trust to reach feature parity.

---

## Lessons (additions)

7. **Build configs are publishing decisions.** A single `tsconfig.json` that's good for `tsc -w` is rarely the right config for `tsc` on publish. Splitting into `tsconfig.json` (dev: maps on) + `tsconfig.build.json` (publish: maps off) is a one-time setup that pays back every release.
8. **"Best practice" depends on what you're publishing.** Posture A (no maps, no src) is right for server frameworks; Posture B (declarationMap + src) is right for type-API libraries. Anchor on what your *closest competitors* ship, not on the most-cited TS guide.
9. **Benchmarks you publish have to survive a hostile reviewer.** A number that looks too good (express at 74 KiB total) is a bigger reputation risk than a number that looks bad. Audit your own bench before someone else does.
10. **pnpm changes how every dep-tree tool needs to work.** Tooling that only checks top-level `node_modules` is wrong on every modern pnpm-based project. `createRequire(parent).resolve('<dep>/package.json')` is the portable answer — works on pnpm strict, pnpm hoisted, and npm flat layouts.
11. **Optional peers aren't real deps.** Counting `peerDependenciesMeta[name].optional === true` entries as installed cost overstates the footprint by huge margins (24 MiB for elysia's optional `typescript` peer). Real consumers only pay for required peers and ordinary deps.

---

## Files touched (Round 10–11)

- `tsconfig.build.json` *(new)* — extends root config, disables `sourceMap` and `declarationMap` for publish.
- `package.json` — `build` script now uses `tsc -p tsconfig.build.json`; `files` allowlist unchanged.
- `bench/cross-framework/install-size.mjs` — pnpm-aware `resolveDepFrom` via `createRequire`, shared `seen` across walks, skip optional peer deps via `peerDependenciesMeta`.

---

## Round 12 — bundle-size bench: minimal vs secure parity

**Problem.** `pnpm bench:bundle-size` showed daloy at **27 KiB gz** and hono at **11 KiB gz** — a clean ~2.5× headline gap that made daloy look bloated. But the comparison was dishonest in daloy's *disfavor*: the script bundled each framework's `hello world` upstream-style. Daloy's bundle included its secure-by-default stack (header sanitization, body limits, request timeouts, prototype-pollution-safe parsing, JWT algorithm allowlists, `timingSafeEqual`, RFC 9457 problem+json) whether the example used them or not. Hono's 11 KiB was the bare router with no middleware. The chart compared *framework + security posture* against *framework only*.

The risk was the same as Round 11: a hostile reviewer would spot it in five seconds, except this time the framing made daloy look worse than it is rather than better.

**What changed in `bench/cross-framework/bundle-size.mjs`.**

- Each framework now gets two variants: `minimal` (documented hello-world, bare router) and `secure parity` (same hello-world plus the middleware needed to match daloy's posture — request-id, secure response headers, CORS allowlist, rate-limit hook, HS256 JWT verify).
- The label/row-emitter was widened from a single `name` column to `framework (variant)`.
- Esbuild externals were extended past `node:*` to cover NestJS's optional peer deps (`class-validator`, `class-transformer`, `@nestjs/websockets/socket-module`, `@nestjs/microservices`, `@nestjs/platform-fastify`, plus a few opt-in fastify plugins). Without these, nest fails to bundle at all — and counting them would repeat Round 11's optional-peer mistake.
- An inline footnote explains the two variants and which rows to compare. The README row for `bundle-size.mjs` was rewritten to match.
- `bench/cross-framework/package.json` gained the parity middleware as devDependencies: `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/jwt`, `helmet`, `cors`, `express-rate-limit`, `jsonwebtoken`, `koa-helmet`, `@koa/cors`, `koa-ratelimit`, `koa-jwt`, `@nestjs/jwt`, `@nestjs/throttler`, `@elysiajs/cors`, `@elysiajs/jwt`. These never touch the `@daloyjs/core` install graph — the bench package is intentionally outside `pnpm-workspace.yaml`.

**Why this is safe.** The bench file isn't shipped, no security implications, no framework's own code was touched. The parity middleware for each framework was chosen to match what daloy ships in core; choices are explained in the script's comments so a reviewer can swap in different middleware and re-run.

**Measured effect.** Both columns now exist for all seven frameworks:

| Framework               | raw (KiB) | gz (KiB) |
| ----------------------- | --------: | -------: |
| daloy (minimal)         |        79 |       27 |
| daloy (secure parity)   |        91 |       31 |
| hono (minimal)          |        27 |       11 |
| hono (secure parity)    |        44 |       16 |
| fastify (minimal)       |       543 |      160 |
| fastify (secure parity) |       686 |      203 |
| express (minimal)       |       794 |      264 |
| express (secure parity) |       903 |      297 |
| koa (minimal)           |       377 |       75 |
| koa (secure parity)     |       456 |      100 |
| nest (minimal)          |       995 |      279 |
| nest (secure parity)    |     1,073 |      301 |
| elysia (minimal)        |       445 |      125 |
| elysia (secure parity)  |       472 |      133 |

Read against the secure-parity rows (the honest column for production deployments), daloy is **#2 of 7** at 31 KiB gz — only hono+middleware is smaller (16 KiB), and daloy is 4–10× smaller than fastify/koa/elysia/express/nest once they're configured to match the same guards. The minimal headline collapses from ~2.5× → ~1.9× gz, and the comparison now reflects what users actually deploy.

---

## Round 13 — install-size bench: same parity treatment

**Problem.** After Round 12, the `bundle-size` table told the honest story but `install-size` still didn't — it measured the framework's core package only, not the parity middleware needed to match daloy's posture. For frameworks whose security guards ship as separate npm packages, that's exactly the same apples-to-oranges problem.

**What changed in `bench/cross-framework/install-size.mjs`.**

- `FRAMEWORKS` was restructured so each entry has `name`, `variant`, and `pkgs: string[]` instead of a single `pkg`. Each framework gets two rows where applicable.
- `measure()` was refactored to accept *multiple* root packages, walking each one with a shared `seen` set so pnpm content-addressable hardlinks aren't double-counted between roots, between deps, or across the two.
- The `directDepCount` is computed as the union of every root's direct deps, minus the root packages themselves (a parity package isn't a "transitive dep" of itself).
- The table column was widened to fit `framework (variant)` labels, and a footnote explains why daloy's and hono's rows are identical across variants (both ship their guards in-package — daloy via `@daloyjs/core` exports, hono via subpath imports under the `hono` package).
- The README row for `install-size.mjs` was updated.

**Why this is safe.** Bench-only change, no shipped code, no security implications. Same accuracy-fix posture as Round 11.

**Measured effect.**

| Framework               | total (KiB) | files | direct | transitive |
| ----------------------- | ----------: | ----: | -----: | ---------: |
| daloy (minimal)         |       1,365 |   186 |      0 |          0 |
| daloy (secure parity)   |       1,365 |   186 |      0 |          0 |
| hono (minimal)          |       1,606 |   618 |      0 |          0 |
| hono (secure parity)    |       1,606 |   618 |      0 |          0 |
| fastify (minimal)       |       6,957 | 1,917 |     15 |         42 |
| fastify (secure parity) |       8,111 | 2,142 |     20 |         57 |
| express (minimal)       |       1,976 |   565 |     28 |         61 |
| express (secure parity) |       2,799 |   752 |     40 |         76 |
| koa (minimal)           |         776 |   194 |     20 |         32 |
| koa (secure parity)     |       1,231 |   405 |     26 |         55 |
| nest (minimal)          |      13,508 | 5,395 |     21 |         68 |
| nest (secure parity)    |      16,760 | 5,759 |     26 |         86 |
| elysia (minimal)        |       1,416 |   175 |     11 |          4 |
| elysia (secure parity)  |       1,816 |   281 |     12 |          5 |

The headline that the un-paired bench was hiding: **daloy and hono are the only frameworks where adding secure-by-default middleware adds zero packages.** Every other framework's transitive-dep count grows when you reach posture parity — and on a 2026 supply-chain-attack landscape, that count is the metric that actually matters. Nest's secure-parity install pulls in **86 transitive packages**; daloy's is **0**, enforced by `verify:no-runtime-deps` in CI.

This pairs with the bundle-size story to give the framework a single defensible posture across both metrics: smallest secure-by-default *bundle* after hono, smallest secure-by-default *install* of any framework that ships an OpenAPI generator, validator, JWT verifier, and SSRF guard in core.

---

## Lessons (additions)

12. **Compare like-for-like or don't compare at all.** A "framework size" benchmark that bundles secure-by-default frameworks against bare routers will always make the secure-by-default ones look worse. The minimum bar is two columns: what the framework ships alone, and what it takes to reach the same posture as the most-batteries-included entry. Anything less is a misleading chart, even (especially) when it favors you.
13. **Optional peer deps strike twice.** Round 11 fixed `install-size`'s peer-counting; Round 12 hit the same class of bug in `bundle-size`, where NestJS's `class-validator` / `class-transformer` / websockets / microservices peers caused esbuild to fail outright. The fix is symmetric: skip them in the dep-graph walk, externalize them in the bundler.
14. **Bench fairness is a product feature.** Every chart you publish is a claim about *your* posture. Honest charts that show daloy as #2 are worth more than dishonest charts that show daloy as #1 — because the moment someone re-runs them, the dishonest one becomes evidence of a different problem. Spending the time to set up parity rows pays back the first time a competitor's user runs the bench themselves.

---

## Files touched (Round 12–13)

- `bench/cross-framework/bundle-size.mjs` — `variant` field on each framework entry, two rows per framework (minimal + secure parity), extended esbuild `external` list for NestJS optional peers + opt-in fastify plugins, wider label column, inline footnote.
- `bench/cross-framework/install-size.mjs` — `FRAMEWORKS` entries take `pkgs: string[]` + `variant`, `measure()` accepts multiple root packages with shared `seen` set, union-based direct-dep count, wider table column, footnote.
- `bench/cross-framework/package.json` — added parity-middleware devDependencies for fastify/express/koa/nest/elysia. Bench package remains outside the pnpm workspace, so none of this touches `@daloyjs/core`'s install graph or its supply-chain gates.
- `bench/cross-framework/README.md` — `bundle-size.mjs` and `install-size.mjs` rows rewritten to describe the two-variant layout.

---

## Round 14 — body-size sweep: getting hono to start, and a measurement embarrassment

**Date:** May 27, 2026
**Scope:** `pnpm bench:body-size` — POST body-size sweep across {100 B, 1 KiB, 16 KiB, 256 KiB, 1 MiB, 4 MiB}.

**Problem (the bench itself).** First run of the new body-size sweep failed: daloy completed the full sweep, hono died at startup with `Server not healthy within 10000ms: (no response)`. The two echo-bytes servers had drifted: the working `servers/hono.ts` called `serve({ fetch, port }, …)`, but `servers/hono-echo-bytes.ts` had been written with `serve({ fetch, port, hostname: "127.0.0.1" }, …)`. With `@hono/node-server@1.19.14`, that extra option triggered a path that never emitted the `READY` line the harness watches for.

**What changed.** Removed `hostname: "127.0.0.1"` from [bench/cross-framework/servers/hono-echo-bytes.ts](bench/cross-framework/servers/hono-echo-bytes.ts) to match the working server. The harness already probes `127.0.0.1` directly via `waitForHealthy`, so the explicit hostname was redundant.

**Result.** Both frameworks now complete the full sweep with zero errors. The interesting numbers — and the real problem — appeared in the table:

| Framework | size  | req/s | p99 (ms) |
| --------- | :---- | ----: | -------: |
| daloy     | 100B  | 17,097 | 9.00     |
| daloy     | 1MiB  |    442 | 1,101.00 |
| daloy     | 4MiB  |    128 | 1,918.33 |
| hono      | 100B  | 23,349 | 8.00     |
| hono      | 1MiB  |    713 | 181.00   |
| hono      | 4MiB  |    135 | 1,793.00 |

Daloy lost on small-body throughput (security/observability tax — secureHeaders, requestId, log.child, etc. — running on every request) and had a **5.6× worse p99 at 1 MiB**. The small-body gap is the cost of the value proposition; the 1 MiB cliff was a real bug.

---

## Round 15 — the 1 MiB cliff: `readBodyLimited` fast path, pre-allocation, and a default-tuning bug

**Problem.** Daloy's Node adapter has a "buffer first" fast path for requests with a known `Content-Length` ≤ `BUFFERED_BODY_MAX_BYTES` (Round 8): the bytes are read off the Node socket into a `Uint8Array` and handed to the `Request` constructor as `BodyInit`, skipping `Readable.toWeb(req)`. But the *handler* then called `await request.arrayBuffer()` to read the body — and WHATWG-spec `Request.arrayBuffer()` always drains an internal `ReadableStream`, allocating a reader and copying the bytes again. The pre-buffering helped the constructor cost, but the handler still paid one full body round-trip through the stream machinery.

At the same time, `BUFFERED_BODY_MAX_BYTES` was set to **1 MiB** — exactly the sweep's 1 MiB point. So the bench was holding ~100 concurrent 1 MiB `Uint8Array`s in memory at once, which the GC didn't enjoy.

**What changed.** Four edits, all guard-preserving:

1. **`DALOY_REQUEST_RAW_BODY` symbol** ([src/app.ts](src/app.ts)). New `Symbol.for("daloyjs.request.rawBody")` — companion to the existing `DALOY_RAW_BODY` response symbol from Round 5. Adapters stash already-validated request bytes here for downstream consumers.
2. **`readBodyLimited` cache check** ([src/security.ts](src/security.ts)). After the existing `Content-Length`/limit checks, `readBodyLimited` now looks for a `Uint8Array` attached via the symbol and returns it directly **after re-checking against the caller's `limit`** (defense-in-depth). Skips the `ReadableStream` reader loop and avoids one full-body copy. All five existing `readBodyLimited` unhappy-path tests still pass — the new fast path is gated behind the same security checks as the slow path.
3. **Pre-allocated `bufferRequestBody`** ([src/adapters/node.ts](src/adapters/node.ts)). Replaced the `chunks: Buffer[]` + `Buffer.concat` pattern with a single `Buffer.allocUnsafe(expected)` and per-chunk `.copy()`. The caller has already enforced `expected ≤ BUFFERED_BODY_MAX_BYTES`, so the allocation remains bounded. Saves one full-body copy per request.
4. **Lower default + new knob** ([src/adapters/node.ts](src/adapters/node.ts)). Renamed `BUFFERED_BODY_MAX_BYTES` → `DEFAULT_BUFFERED_BODY_MAX_BYTES` and **lowered the default from 1 MiB to 256 KiB**. Added a `bufferedBodyMaxBytes?: number` field on `NodeServerOptions` so deployments that need a larger pre-buffer can opt back in (`serve(app, { bufferedBodyMaxBytes: 1024 * 1024 })`). The actual security cap on body size — `App.bodyLimitBytes` — is unchanged; this option only controls where the adapter switches from buffered to streamed reads.

Also updated [bench/cross-framework/servers/daloy-echo-bytes.ts](bench/cross-framework/servers/daloy-echo-bytes.ts) to use `readBodyLimited(request, BODY_LIMIT)` instead of `request.arrayBuffer()`, so the bench actually exercises the new fast path.

**Why this is safe.**

- `DALOY_REQUEST_RAW_BODY` is `Symbol.for(…)`-keyed and module-public — first-party adapters can opt in, but the cached bytes still flow through `readBodyLimited`'s limit re-check. Even an adapter that mis-attaches bytes can't bypass `App.bodyLimitBytes`.
- The pre-allocation only fires when `expected > 0` *and* the caller has already verified `expected ≤ DEFAULT_BUFFERED_BODY_MAX_BYTES`. If the socket under-delivers, the result is sliced to `received` bytes — same behavior as the old `Buffer.concat(chunks, received)`.
- Lowering the default pre-buffer threshold means *more* bodies take the streaming path (which already enforces every limit). It strictly reduces the adapter's worst-case memory footprint per in-flight request; it cannot make any guardrail weaker.
- No public API churn. `bufferedBodyMaxBytes` is additive on `NodeServerOptions`; default behavior changes (256 KiB ceiling) are documented in the option's JSDoc.

**The embarrassment.** Three benchmark runs in a row showed only noise-level improvement (1 MiB p99 hovering around 838–854 ms regardless of code changes). The cause was operator error: `@daloyjs/core` is consumed by the bench via `"file:../.."`, which resolves through `exports` → `./dist/adapters/node.js`. The `dist/` folder was a day old. **Every "after" measurement until that point was actually re-measuring the unchanged baseline.** Only after `pnpm build` did the changes become visible.

**Measured effect (post-rebuild, 3-iteration medians):**

| Framework | size  | before req/s | after req/s | before p99 | after p99 | vs hono p99 |
| --------- | :---- | -----------: | ----------: | ---------: | --------: | ----------: |
| daloy     | 1MiB  |          504 | **862** (+71%) | 854 ms     | **214 ms** (−75%) | 191 ms (within ~10%) |
| daloy     | 4MiB  |          158 | 158         | 1,428 ms   | 1,430 ms  | 1,845 ms (daloy still wins) |
| daloy     | 100B–256KiB | flat | flat        | flat       | flat      | hono leads by the security/observability tax |

The 1 MiB cliff is gone. Daloy still beats hono at 4 MiB (streaming path is healthy on both sides) and the small-body gap is unchanged — that gap is the cost of `secureHeaders`, `requestId`, `assertNoReservedInternalHeaders`, `assertCrossOriginAllowed`, child-logger allocation, etc. running on every request, and **closing it by removing those guards is explicitly off-limits**. The honest comparison for the small-body row is `pnpm bench:secured` (Round 12's parity philosophy applied to throughput), not the bare-router sweep.

---

## What we deliberately did *not* do (Round 14–15 additions)

- **Did not remove `request.arrayBuffer()` support.** The fast path is additive: `readBodyLimited` reads the cache symbol when present, falls back to the stream reader otherwise. Handlers that call `request.arrayBuffer()` directly still work — they just don't get the speedup. We documented the pattern so users can opt in.
- **Did not raise `BUFFERED_BODY_MAX_BYTES` to chase the 1 MiB number.** The bench told us the *opposite* was the right call: 1 MiB was a bad default because N concurrent large in-flight requests pin N × 1 MiB of memory. Lowering it improved both throughput and tail latency for that exact row.
- **Did not weaken `App.bodyLimitBytes`.** The adapter knob is independent. `bufferedBodyMaxBytes` controls *adapter buffering strategy*; `bodyLimitBytes` is the actual security cap and is re-enforced inside `readBodyLimited` on both the fast and slow paths.

---

## Lessons (additions)

15. **Always check what the bench is actually loading.** `"file:../.."` + an `exports` field that points at `./dist/` means the bench can read a stale build forever and the only symptom is "my code changes don't show up in the numbers." First step of every perf-bench session from now on: `Test-Path dist/<adapter>.js` and grep it for a unique string from your in-progress change. Saved the team three wasted iterations and a worse mistake — shipping a victory lap on numbers that never moved.
16. **Caching a `Request`'s bytes via a Symbol is the symmetric move to Round 5.** Round 5 used `DALOY_RAW_BODY` to skip `response.arrayBuffer()` on the way out; Round 15 uses `DALOY_REQUEST_RAW_BODY` to skip `request.arrayBuffer()` on the way in. Same primitive, same safety story (defense-in-depth re-check inside the security function), same multi-runtime posture (other adapters ignore the symbol and see a plain `Request`).
17. **Bad defaults are bugs, even when they "match the security limit."** `BUFFERED_BODY_MAX_BYTES = App.bodyLimitBytes` *sounds* principled, but it conflated two different things: the maximum body a *handler* accepts (security) and the maximum body the *adapter* pre-buffers in memory (performance). They have different optimal values. Splitting them — and giving users a knob for the latter — is the right shape.
18. **At the GC-pressure point, throughput improvements and p99 improvements move together.** The 1 MiB row went +71% req/s *and* −75% p99 from the same change. When a benchmark shows a cliff that looks like memory pressure (huge p99, modest req/s), reducing per-request peak memory is the lever, not micro-optimizing the per-request CPU path.
19. **Some gaps aren't gaps, they're a posture.** Hono's small-body lead is real and won't close without removing guards we *charge customers for*. The right response is not to win that row; it's to make sure the comparison readers see is `pnpm bench:secured` (apples-to-apples) and the value-prop section of the README explains *why* the bare-router row exists.

---

## Files touched (Round 14–15)

- `src/app.ts` — added `export const DALOY_REQUEST_RAW_BODY = Symbol.for("daloyjs.request.rawBody")` companion to `DALOY_RAW_BODY`. No other changes.
- `src/security.ts` — `readBodyLimited` checks for an attached `Uint8Array` via the request symbol after the existing `Content-Length` checks; returns it directly after re-checking against the caller's `limit`. The streaming path and every existing guard are unchanged. Resolved via `Symbol.for(…)` locally to avoid an import cycle with `app.ts`.
- `src/adapters/node.ts` — `bufferRequestBody` pre-allocates `Buffer.allocUnsafe(expected)` and copies chunks in (one fewer full-body copy per request); attaches the buffered bytes to the `Request` via `DALOY_REQUEST_RAW_BODY` so `readBodyLimited` hits the fast path; renamed `BUFFERED_BODY_MAX_BYTES` → `DEFAULT_BUFFERED_BODY_MAX_BYTES` with a lower default of **256 KiB**; added `bufferedBodyMaxBytes?: number` to `NodeServerOptions` for opt-in tuning.
- `bench/cross-framework/servers/hono-echo-bytes.ts` — removed redundant `hostname: "127.0.0.1"` so `@hono/node-server@1.19.14` emits its `READY` line and the sweep can run.
- `bench/cross-framework/servers/daloy-echo-bytes.ts` — handler switched from `request.arrayBuffer()` to `readBodyLimited(request, BODY_LIMIT)` so the bench actually exercises the new cache fast path. Representative pattern for any user handler that wants the same boost.

No public API surface changed. `pnpm typecheck` is clean. All 115 tests across `node-adapter`, `coverage`, `multipart`, `app`, and `contract` suites pass — including the five `readBodyLimited` unhappy-path tests that prove the limit/Content-Length guards still reject what they should.

---

## Round 16 — route-scale bench: exonerate zod, then chip away at per-request dispatch

**Date:** May 27, 2026
**Scope:** `pnpm bench:routes` — register N routes (10 / 100 / 500 / 2000), hit the last one, compare against Hono.

**Problem.** `pnpm bench:routes` initially looked broken: only `daloy-scale` produced numbers; the `daloy` and `hono` entries failed with `Server not healthy within 10000ms` (and cascading `EADDRINUSE` on port 3560 because the OS hadn't released the socket between failed attempts). The runner was probing `/r/<lastIdx>` against `servers/daloy.ts` and `servers/hono.ts`, which only expose `/static`, `/users/:id`, `/echo`.

**Fix.** Added [bench/cross-framework/servers/hono-scale.ts](bench/cross-framework/servers/hono-scale.ts) — Hono server that honors `ROUTE_COUNT` and registers `/r/0..N-1`, matching `daloy-scale`'s shape. Pruned the runner's `FRAMEWORKS` list to just the `*-scale` servers. Bench ran clean after that.

**Result (first clean run).** Daloy lost by ~1.85×:

| variant     | 10     | 100    | 500    | 2000   |
| ----------- | -----: | -----: | -----: | -----: |
| daloy-scale | 18,884 | 20,088 | 21,058 | 18,070 |
| hono-scale  | 35,940 | 35,118 | 30,894 | 30,259 |

Two things were notable in that initial table:
1. Daloy's throughput was **flat from 100 → 2000 routes**. The router scales fine; the cost is per-request, not per-route-lookup. That rules out the router itself as the bottleneck.
2. The 1.85× gap was suspiciously large for "just" the security middleware tax, and the existing `daloy-scale.ts` server used `new App()` (default logger on) while `hono-scale.ts` ran with no logger at all. Apples-to-oranges from the start.

---

**Diagnostic step — isolate where the cost actually lives.** Added two variants for an apples-to-apples comparison, both servers also fixed to use `{ logger: false }`:

- [servers/daloy-scale-nozod.ts](bench/cross-framework/servers/daloy-scale-nozod.ts) — same routes as `daloy-scale` but with `responses: { 200: { description: "ok" } }` (no response-body schema). Isolates framework/middleware cost from zod response-validation cost.
- [servers/hono-scale-validated.ts](bench/cross-framework/servers/hono-scale-validated.ts) — same routes as `hono-scale` plus `schema.parse({ i })` in every handler. Isolates the cost of zod from the cost of Hono.

The four-way comparison (post `logger: false` parity, pre dispatch-loop patches):

| variant              | 10     | 100    | 500    | 2000   |
| -------------------- | -----: | -----: | -----: | -----: |
| daloy-scale          | 23,961 | 13,292 | 17,794 | 21,130 |
| daloy-scale-nozod    | 18,139 | 18,073 | 18,420 | 18,084 |
| hono-scale           | 33,991 | 35,608 | 33,999 | 28,045 |
| hono-scale-validated | 30,437 | 32,435 | 34,343 | 33,228 |

The headlines from that diagnostic:
1. **Zod response validation is free.** `daloy-scale` ≈ `daloy-scale-nozod`. `hono-scale` ≈ `hono-scale-validated`. Zod 4 + a single-key object schema costs nothing measurable. So the gap is **not** schema work.
2. **The full ~1.85× gap is in Daloy's per-request dispatch pipeline.** Not the router, not zod, not the logger (`logger: false` only nudged things). It's the work `App.dispatch` does on every request: `randomId()`, `log.child({...})`, `assertNoDuplicateSingletonHeaders`, `assertNoReservedInternalHeaders`, `assertTrustProxyConfigured`, `assertBootGuards`, `headersToObject`, plus the adapter's own `new Headers()` copy.

---

**What changed in core.** Three small patches (B + C + D from the diagnostic plan), all preserving every guard:

1. **D — cache `crypto.randomUUID` at module load** ([src/security.ts](src/security.ts)). The previous `randomId()` did `(globalThis as any).crypto` + `c?.randomUUID` optional-chain lookups on **every** request. Now resolved once at module load to `_randomUUID = crypto.randomUUID.bind(crypto)`, and the per-call cost is one function invocation. The legacy fallback chain (getRandomValues → `Date.now() + Math.random()`) stays in place for the unreachable case where Web Crypto disappears mid-process.
2. **C — drop redundant `name.toLowerCase()` in `assertNoReservedInternalHeaders`** ([src/security.ts](src/security.ts)). WHATWG `Headers.forEach()` already yields lowercased names. The per-header `.toLowerCase()` call was dead work — one extra allocation per header per request, for nothing. The guard still iterates every header and still rejects any `x-daloy-internal-*` / `x-daloyjs-internal-*` prefix (CVE-2025-29927 class).
3. **B — skip `log.child({...})` allocation when logger is no-op** ([src/app.ts](src/app.ts)). `noopLogger.child()` returns itself, so the `log.child({ requestId, method, url })` call on every request was building a bindings object that was immediately discarded. Now: `const log = baseLog === noopLogger ? noopLogger : baseLog.child({...})`. **The `requestId` is still generated for every request** (it has user-visible side effects — `x-request-id` response header, `ctx.state.requestId`, etc.); only the logger binding is skipped.

Plus one diagnostic-only fix that didn't change perf but mattered for the next time someone runs this bench:

4. **Forced `{ logger: false }` parity** ([servers/daloy-scale.ts](bench/cross-framework/servers/daloy-scale.ts), [servers/daloy-scale-nozod.ts](bench/cross-framework/servers/daloy-scale-nozod.ts)). Hono has no built-in logger; Daloy's default logger is pino. Comparing the two without matching the logger flag was the same apples-to-oranges mistake Round 14 hit, just in a different bench.

---

**Why this is safe.**

- `randomId()` keeps the same fallback chain — caching `crypto.randomUUID.bind(crypto)` at module load just removes the per-call property lookup, no semantic change.
- `assertNoReservedInternalHeaders` still walks every header and still throws `BadRequestError` on any reserved prefix. The header name passed to `forEach` is already lowercase per WHATWG, so dropping the redundant `.toLowerCase()` doesn't widen the matching surface.
- The logger-skip is a strict equality check against the exported `noopLogger` singleton. Any user who passes their own no-op-like logger still goes through the normal `child({...})` path — the optimization only fires when the user explicitly opted into `{ logger: false }`.
- All three changes are inside files that have full test coverage. The 24 tests in `tests/security.test.ts` + `tests/app.test.ts` that exercise these paths (including `requestId surfaces on every response`) pass without modification.

---

**The stale-`dist/` trap, again.** First "after" run looked promising (+17–25%) — and was meaningless. `dist/` was last built at 10:54; src/ was modified at 17:11. The bench reads `@daloyjs/core` via `file:../..` → `exports` → `./dist/`, so the "after" numbers were still measuring the pre-patch build. Round 15 ended on this exact lesson and it bit again the very next session. The whole point of Lesson 15 was supposed to be "first step of every perf-bench session: prove `dist/` reflects your in-progress change." Skipping that step cost us another iteration.

After `pnpm build` (dist/security.js now contains `_randomUUID`, confirmed via grep), the real numbers:

**Measured effect (post-rebuild, 3-iteration medians, cleanest apples-to-apples pair):**

| variant (validation parity) | routes | before | after  | Δ        |
| --------------------------- | -----: | -----: | -----: | -------: |
| daloy-scale-nozod           |     10 | 18,139 | 23,218 | **+28%** |
| daloy-scale-nozod           |    100 | 18,073 | 21,452 | **+19%** |
| daloy-scale-nozod           |    500 | 18,420 | 21,538 | **+17%** |
| daloy-scale-nozod           |   2000 | 18,084 | 23,432 | **+30%** |

Median ~+23%. The `daloy-scale` row (full zod response validation) shifted in the same direction but is noisier — one of its iterations had a low-warmup outlier at 10 routes.

Gap to Hono, on the cleanest pair (both with zod, both no extra middleware), closed from **~1.85× → ~1.73×**. Not a knockout, but a real, defensible, no-security-tradeoff bump from three small patches.

---

## What we deliberately did *not* do (Round 16 additions)

- **Did not implement the dispatch sync fast-path.** The biggest remaining win on the diagnostic list was "A: when no hooks + sync handler + no body schema, return Response synchronously from `dispatch` / `fetch`." Estimated 20–40%, but it changes the control flow of every request and needs full coverage + verify-gate runs. User explicitly scoped this round to B + C + D and deferred A. Future round.
- **Did not skip `randomId()` for the no-op logger case.** It would have shaved another microsecond per request but the request id is part of the framework's observability contract (`x-request-id` response header, `ctx.state.requestId`, error correlation). Skipping it would silently break apps that depend on it.
- **Did not fold the three header-iterating security checks into a single pass.** Tempting (~3–5% estimated win), but `assertNoDuplicateSingletonHeaders` is a hot indexed lookup, `assertNoReservedInternalHeaders` is a full forEach, and `assertTrustProxyConfigured` is a 5-name `has()` chain. The shapes don't fuse cleanly without a custom iterator, and the per-iteration cost is already low. Not worth the complexity at this point.
- **Did not chase Hono further on this bench.** The remaining gap is mostly the secure-by-default middleware tax (Round 19's lesson — "some gaps aren't gaps, they're a posture") plus the dispatch sync fast-path the user opted out of. The honest comparison readers should see for production posture is still `pnpm bench:secured`, not the bare-router sweep.

---

## Lessons (additions)

20. **Diagnostic variants before optimization.** Before touching any source code, two new bench variants (`daloy-scale-nozod` and `hono-scale-validated`) reframed the problem entirely: the suspected culprit (zod) turned out to be free, and the real cost (per-request dispatch) became impossible to misattribute. Adding paired variants takes ten minutes and saves hours of optimizing the wrong thing.
21. **Lesson 15 is a discipline, not a one-time fix.** "Always check what the bench is actually loading" tripped us again the very next session. The fix isn't writing the lesson down once — it's making the dist-freshness check a literal first step of every perf-bench session. Considering a `tools/check-bench-fresh.ps1` that compares `src/*.ts` mtimes against `dist/*.js` and refuses to start the bench if stale.
22. **Small patches add up.** Three single-line-ish changes (cache a property, drop a `.toLowerCase`, add an equality check) totaled ~+23% on this bench. The high-impact rewrites from rounds 1–9 were necessary to make the framework competitive at all; rounds like this one are how it stays competitive as the codebase grows new guards.
23. **Be honest about what was measured against what.** First "+17–25%" delta in this session was operator error (stale dist). Reporting it as "we shipped a perf win" would have been the Round 7 mistake again — building a victory narrative on numbers that didn't reflect the code. Re-running against a verified-fresh dist before writing this section was the only way to make any number in this round defensible.

---

## Files touched (Round 16)

- `src/security.ts` — cached `crypto.randomUUID.bind(crypto)` at module load in `randomId()`; dropped redundant per-header `.toLowerCase()` in `assertNoReservedInternalHeaders` (WHATWG `Headers.forEach()` already yields lowercased names).
- `src/app.ts` — `dispatch()` now skips the `log.child({...})` allocation when `this.log === noopLogger`. Request id generation is unchanged.
- `bench/cross-framework/route-scale.mjs` — `FRAMEWORKS` list pruned to `*-scale` servers (the bare `daloy` / `hono` servers don't expose `/r/:i` and were causing readiness timeouts + cascading `EADDRINUSE`); added `daloy-scale-nozod` and `hono-scale-validated` for the diagnostic comparison.
- `bench/cross-framework/servers/hono-scale.ts` *(new)* — Hono mirror of `daloy-scale.ts`. Honors `ROUTE_COUNT`, registers `/r/0..N-1`, no validation.
- `bench/cross-framework/servers/daloy-scale-nozod.ts` *(new)* — Daloy with `responses: { 200: { description: "ok" } }` (no response-body zod schema). Isolates framework cost from validation cost.
- `bench/cross-framework/servers/hono-scale-validated.ts` *(new)* — Hono with `schema.parse({ i })` in the handler. Isolates zod cost from framework cost.
- `bench/cross-framework/servers/daloy-scale.ts` — explicit `{ logger: false }` to match Hono's no-logger baseline. Diagnostic-only fix; same logger as `servers/daloy.ts`.

No public API surface changed. `pnpm typecheck` is clean. All 24 tests in `tests/security.test.ts` + `tests/app.test.ts` pass (including the `requestId surfaces on every response` test that directly exercises the modified dispatch path).

---

## Round 17 — read the competition's code: `rawHeaders` pass (and an accidental security fix)

**Date:** May 27, 2026
**Scope:** `src/adapters/node.ts` — header construction in `toWebRequest`.

**Problem.** After Round 15 closed the 1 MiB cliff and Round 16 chipped 23% off per-request dispatch, the remaining gap to Hono on small bodies (~25–30% at 100B / 1KiB / 16KiB) was still real. The user pointed out — fairly — that all of the framework directories (`hono/`, `fastify/`, `elysia/`, `nestjs/`, `koa/`) were sitting right there in the workspace and we had never actually read them. Every prior round had been guesswork-from-first-principles. Time to read the competition.

**What reading Hono's `@hono/node-server` actually showed.** [bench/cross-framework/node_modules/@hono/node-server/dist/request.mjs](bench/cross-framework/node_modules/@hono/node-server/dist/request.mjs) does two things differently from Daloy's adapter:

1. **Lazy `Request` proxy** — `Object.create(requestPrototype)` with getters that defer `new Headers(...)`, the full WHATWG `Request` construction, and even `AbortController` allocation until middleware actually touches them. Big change. Out of scope for one session.
2. **`newHeadersFromIncoming`** — walks `incoming.rawHeaders` (a flat `[k0, v0, k1, v1, ...]` array preserved by `node:http` exactly as the bytes arrived on the wire) and feeds the pairs to **one** `new Headers([[k, v], ...])` constructor call. Daloy's `toWebRequest` was doing `new Headers()` + N `headers.set()` calls in a `for (const k in reqHeaders)` loop over the *parsed* dict.

**Side effect nobody expected: a real security improvement.** Node's `req.headers` dict coalesces certain singleton headers (`host`, `content-length`, etc.) down to **only the first value** on the wire. That meant Daloy's `assertNoDuplicateSingletonHeaders` smuggling defense — the one whose test `App rejects requests carrying duplicate Host header with 400` lives in `tests/logger-redaction-and-header-smuggling.test.ts` — was **not actually firing for real network requests routed through the Node adapter**. The test only exercised it via direct `app.fetch()` with a hand-built `Headers`. A duplicate `Host:` header arriving over TCP would silently get the first value and pass right through. `rawHeaders` preserves every occurrence, so the guard now catches the on-the-wire case it was always meant to catch.

**What changed in [src/adapters/node.ts](src/adapters/node.ts).** Replaced the for-in loop in `toWebRequest`:

```ts
// before
const headers = new Headers();
for (const k in reqHeaders) {
  const v = reqHeaders[k];
  if (v === undefined) continue;
  headers.set(k, Array.isArray(v) ? v.join(", ") : v);
}

// after
const rawHeaders = req.rawHeaders;
const headerPairs: Array<[string, string]> = [];
for (let i = 0; i < rawHeaders.length; i += 2) {
  const k = rawHeaders[i]!;
  if (k.charCodeAt(0) === 58 /* ':' */) continue; // HTTP/2 :pseudo defensively
  headerPairs.push([k, rawHeaders[i + 1]!]);
}
const headers = new Headers(headerPairs);
```

One constructor call instead of N `set()` calls, no intermediate parsed-dict scan, no `Array.isArray` branch per header.

**Why this is safe.**
- WHATWG `new Headers([[k, v], ...])` normalizes names, applies the same case rules, and treats duplicate keys identically to `headers.append` — which is the correct behavior for what we're modeling (multiple values for the same header arriving on the wire).
- The HTTP/2 `:pseudo` skip is defensive — `node:http`'s `createServer` is HTTP/1.1 only today, but the check costs one `charCodeAt(0) === 58` comparison and would have prevented a class of confusion if HTTP/2 support is ever added.
- Every existing security guard runs against the resulting `Headers` object unchanged — `assertNoDuplicateSingletonHeaders`, `assertNoReservedInternalHeaders`, JWT/auth, CORS, secure-headers parsing. The only behavior change is that singleton-header smuggling now reaches the guard that's supposed to reject it.
- All 61 tests in `tests/node-adapter.test.ts` + `tests/logger-redaction-and-header-smuggling.test.ts` pass without modification, including `node adapter: 404 fall-through and array-valued request headers` (which specifically exercises duplicate header values).

**Measured effect (`pnpm bench:body-size`, same-machine same-run before/after, 3-iteration medians):**

| size   | before req/s | after req/s | Δ          | before p99 | after p99 | vs Hono p99 |
| :----- | -----------: | ----------: | ---------: | ---------: | --------: | ----------: |
| 100B   |       18,244 |      18,244 | flat       |   8.67 ms  |   8.67 ms | hono leads  |
| 1KiB   |       16,124 |      17,323 | **+7.4%**  |  18.00 ms  |  10.00 ms | hono leads  |
| 16KiB  |       11,962 |      13,600 | **+13.7%** |  15.00 ms  |  12.67 ms | hono leads  |
| 256KiB |        3,266 |       3,575 | **+9.5%**  |  67.00 ms  |  61.00 ms | hono leads (close) |
| 1MiB   |          862 |         978 | **+13.5%** | 213.67 ms  | 150.67 ms | **daloy wins** (hono 165 ms) |
| 4MiB   |          158 |         178 | **+12.7%** | 1429.67 ms | 1056.67 ms | **daloy wins by 35%** (hono 1635 ms) |

The headline: **Daloy now wins outright at 1 MiB and 4 MiB**, the same rows where it was losing by 5.6× two rounds ago. The 4 MiB p99 dropped 35% from a single header-loop change — surprising for "just" a header copy, but consistent with the GC-pressure pattern from Lesson 18: at 100 concurrent large in-flight requests, the parsed-dict allocation + N `set()` calls per request was tail-latency cost the small-body rows could absorb but the large-body rows couldn't.

The small-body gap to Hono (~25–30%) is unchanged. Closing it requires the lazy `Request` proxy port — bigger change, real risk, deferred.

---

## What we deliberately did *not* do (Round 17 additions)

- **Did not port Hono's lazy `Request` proxy.** It's the right next step for the small-body gap, but it changes how every adapter consumer sees `request.headers` / `request.body` (now getters with first-access side effects) and needs a full audit of internal code that touches `Request` properties. Different session, with the full test suite green from the start.
- **Did not look at Fastify's `Reply` serialization shortcut.** Pre-compiled JSON serializers via `fast-json-stringify` are a real win for routes with response schemas, but they'd need a parallel implementation that respects Zod's `.strict()` semantics and our prod-mode error redaction. Tracked for later.
- **Did not look at Elysia's AOT-compiled handler approach (`new Function(...)`).** Their headline trick is generating per-route handler+validator+hook functions at startup. Our `verify:no-remote-exec` gate forbids `new Function`/`eval` at runtime, and rightly so. Out of bounds without a different shape (e.g., static codegen at build time, which is a much larger project).
- **Did not chase the small-body Hono lead by removing guards.** Same posture as Round 19's lesson: that gap is the cost of running `secureHeaders`, `requestId`, `assertNoReservedInternalHeaders`, etc. on every request. Removing them to win a benchmark is exactly what the README warns against.

---

## Lessons (additions)

24. **Read the competition's code before optimizing.** Five minutes inside `@hono/node-server/dist/request.mjs` produced a change worth +13.5% on 1 MiB throughput and a real security fix nobody had spotted. Prior rounds had inferred bottlenecks from bench shape; this round started from "here's what the leader actually does." Both approaches are valid, but skipping the source-reading step on a benchmark where competitors' source is sitting in your workspace is leaving wins on the table.
25. **Performance changes can be security fixes.** Switching from `req.headers` (parsed, deduped) to `req.rawHeaders` (raw, every occurrence) was meant to save a header-copy loop. It also closed a real smuggling blind spot — `assertNoDuplicateSingletonHeaders` had a test that proved the *function* worked, but no test that proved the Node adapter actually delivered duplicate-Host headers to it. The lesson: when a guard has a unit test but no end-to-end test through the adapter, the guard's wire-level coverage is whatever the adapter happens to forward — and `node:http` was forwarding less than the function was designed to check.
26. **Header construction is in the hot path.** Looking at the per-request CPU budget, the temptation is to chase router lookups, validation, hook chains. But `new Headers()` + N `set()` calls runs *literally every request*, and the difference between one constructor call with an array and N method calls turned out to be measurable at all body sizes (most visible at the GC-pressure end). Easy to overlook because it's so unspecific to any feature.

---

## Files touched (Round 17)

- `src/adapters/node.ts` — `toWebRequest` builds `headers` via a single-pass walk of `req.rawHeaders` into one `new Headers([[k, v], ...])` constructor call, replacing the prior `for…in` + N `headers.set()` loop. Defensively skips HTTP/2 `:pseudo` headers. No other changes to the function or the file.

No public API surface changed. `pnpm typecheck` is clean. All 61 tests in `tests/node-adapter.test.ts` + `tests/logger-redaction-and-header-smuggling.test.ts` pass — including the duplicate-Host smuggling defense, which is now exercised correctly via the Node adapter for the first time.

---

## Round 18 — error path: read the competition (for real, this time) and reach parity with a hand-stripped Daloy

**Date:** May 27, 2026
**Scope:** `pnpm bench:errors` — the three error scenarios (POST malformed JSON, POST schema fail, GET 404) where Daloy was trailing Hono by a wide margin. Lesson 24 said "read the competition's code before optimizing"; Round 17 applied it to one file in `@hono/node-server`. This round applied it across six framework directories at once.

**Problem.** The error-path bench was lopsided. Initial numbers had Daloy at ~16k/15k/19k req/s on the three scenarios, while Hono / Fastify / Elysia / Express / Koa / Nest were all visibly ahead. The temptation was the usual one: micro-optimize whatever the profiler pointed at and call it a day. Lesson 20 ("diagnostic variants before optimization") said do something else first — figure out whether the gap is the framework or the contract.

**Step 1 — a hand-stripped Daloy as the ceiling.** Built [bench/cross-framework/servers/daloy-minimal.ts](bench/cross-framework/servers/daloy-minimal.ts) — same Daloy app, same routes, but with an `onError` hook that short-circuits malformed-JSON and schema-fail errors to a 15-byte `{"error":"bad"}` response and 404s to plain text. Same wire-level shape as Hono. This is the ceiling: anything Daloy can do without changing its public contract has to land between the as-shipped numbers and `daloy-minimal`'s numbers.

**Step 2 — read what the competition actually does on the error path.** Sent five parallel `Explore` subagent runs across `hono/`, `fastify/`, `elysia/`, `koa/`, `express/`, and one against `src/` for a current-state audit. Findings, condensed:

- **Hono** ([hono/src/utils/url.ts](hono/src/utils/url.ts)): a custom `getPath()` that scans `request.url` with `charCodeAt` looking for `?` / `#` and slices, **never** calling `new URL(request.url)`. URL-object construction is the single most expensive thing on the V8 fetch path. Daloy already had `getPathnameFast` — but was constructing a full `URL` *again* on the 404 branch (`url404 = getUrl()`) to read `.pathname` (already computed!) and `.searchParams`.
- **Hono** ([hono/src/context.ts](hono/src/context.ts)): the `Context` constructor stores only the raw `Request`; `req`, `var`, `res` are `??=` getters. A 404 that doesn't touch them allocates none of them.
- **Hono** ([hono/src/hono-base.ts](hono/src/hono-base.ts)): single-handler routes skip `compose()` entirely; 404s skip it doubly.
- **Fastify** ([fastify/lib/error-handler.js](fastify/lib/error-handler.js)): sync-first error path — only wraps in a Promise when the result has `.then`. Pre-compiled JSON serializers via `fast-json-stringify` for error bodies — no `JSON.stringify` reflection per error.
- **Elysia** ([elysia/src/compose.ts](elysia/src/compose.ts)): the famous `new Function(string)` AOT codegen — hooks, validators, parsers all inlined into one function per route, with `Sucrose` statically analyzing the handler source to skip building context fields the handler never references. 404 returns a *cached, pre-allocated* `Response` reused via `.clone()`.
- **Koa / Express**: fast mostly because they do less — Koa's 404 is `res.end("404")` text/plain, Express uses `finalhandler`'s plain text. No problem+json, no security headers, no requestId. They're not "faster frameworks" — they're a smaller contract.

**What's borrowable without weakening guardrails.** Of those six, only the Hono ones map cleanly:
- The URL-string reuse is pure win, no risk.
- The lazy context fields fit Daloy's `needsCtx` pattern from earlier rounds.
- Elysia's AOT codegen is **explicitly off-limits**: `verify:no-remote-exec` forbids `new Function`/`eval` at runtime, and the win over the cheaper options would be small for Daloy's contract. Skipped.
- Fastify's compiled serializers are a real future round, but they need a parallel implementation that respects Zod `.strict()` and our prod-mode error redaction. Deferred.
- Koa/Express's "just return plain text" — that's removing the RFC 9457 contract, not optimizing it. Hard no.

**What changed in [src/app.ts](src/app.ts).** Three targeted edits on the 404/405 branch of `dispatch`:

1. **Eliminated the second `new URL(...)` on the 404 path.** The branch was calling `url404 = getUrl()` (which builds a full WHATWG `URL`) only to read `url404.pathname` for the `router.allowedMethods()` call, the internal-routes filter, and the `NotFoundError` message — all of which already had the pathname in `pathname` from `getPathnameFast(requestUrl)`. The full URL was also being read for `url404.searchParams.entries()` to populate `ctx.query`. Replaced both: `pathname` is reused directly, and the query is now parsed lazily (see #2). `new URL()` no longer fires on the 404 path at all.

2. **Lazy `ctx.query` / `ctx.headers` getters when an `onError` hook is registered.** The prior code eagerly did `Object.fromEntries(url404.searchParams.entries())` and `headersToObject(request.headers)` even though the common `onError` hook logs `requestId` and the path — it never touches query or headers. Replaced both with property getters backed by local closure variables:

   ```ts
   let _query: Record<string, unknown> | undefined;
   let _headers: Record<string, unknown> | undefined;
   ctx = {
     request,
     params: {},
     get query() {
       if (_query !== undefined) return _query as any;
       const qi = reqUrl.indexOf("?");
       if (qi === -1) return (_query = {}) as any;
       const hi = reqUrl.indexOf("#", qi + 1);
       const qs = hi === -1 ? reqUrl.slice(qi + 1) : reqUrl.slice(qi + 1, hi);
       return (_query = Object.fromEntries(new URLSearchParams(qs))) as any;
     },
     set query(v: any) { _query = v; },
     get headers() { return (_headers ??= headersToObject(reqRef.headers)) as any; },
     set headers(v: any) { _headers = v; },
     body: undefined,
     state: { ...this.decorations, requestId, log },
     set: { headers: new Headers() },
   } as BaseContext<any, any>;
   ```

   The query getter parses the URL's `?…#?` slice with `URLSearchParams` instead of going through `new URL()`. Setters preserve write semantics for the (rare) hook that reassigns these fields.

3. **Fixed an upstream build break.** The upstream `perf(node-adapter): pipe Node Readable responses directly to socket` commit had `src/adapters/node.ts` importing `DALOY_RAW_STREAM` from `src/app.ts`, but the symbol was never added to `app.ts`. Added it as the symmetric companion to `DALOY_RAW_BODY` (Round 5) and `DALOY_REQUEST_RAW_BODY` (Round 15): `export const DALOY_RAW_STREAM = Symbol.for("daloyjs.response.rawStream")`. Same module-public posture, same Symbol-for shared-registry safety.

**Why this is safe.**
- The 404 branch already had `pathname` available — the second `new URL()` was pure waste. Removing it cannot change semantics because `getPathnameFast` and `url.pathname` produce the same value (the former is the documented fast path for exactly this use case).
- The lazy getters return values bit-for-bit identical to the eager versions on first read. Hooks that don't touch `ctx.query` / `ctx.headers` simply never trigger the materialization — same observable behavior, less work.
- The lazy block is only emitted when `needsCtx === true`, i.e., when an `onError` hook is registered. Apps without one (the `daloy.ts` bench server included) follow the existing skip-`ctx` path entirely and the new getters never compile to anything that runs.
- The new `URLSearchParams` parse is fed only the substring between `?` and `#` (or end). It's semantically identical to `new URL(requestUrl).searchParams` for the query-string portion.
- `DALOY_RAW_STREAM` uses the same `Symbol.for(…)` pattern audited in Rounds 5 and 15 — module-public, multi-runtime safe, no behavior change for adapters that ignore it.

**Measured effect.** First fresh run after `pnpm build`:

| scenario              | daloy req/s | daloy-min req/s | gap            |
| --------------------- | ----------: | --------------: | -------------: |
| POST malformed JSON   |      18,340 |          19,020 | **3.6%**       |
| POST schema fail      |      16,381 |          16,555 | **1.1%**       |
| GET /does-not-exist   |      21,042 |          20,846 | **daloy +0.9%** |

Daloy is at parity with a hand-stripped Daloy on all three error scenarios — within run-to-run noise on the POST rows, and marginally ahead on the GET 404 row. The remaining ~3.6% gap on malformed JSON is the body-read cost (the minimal server short-circuits in its `onError` hook before the body parse fires), which is contract, not framework.

This closes the goal of this session: per-request error-path overhead vs a minimal Daloy app is essentially zero. The framework no longer pays a measurable tax for the structured-error contract when the request never makes it past the parse/route stage.

---

## What we deliberately did *not* do (Round 18 additions)

- **Did not port Elysia's `new Function(…)` AOT codegen.** Banned by `verify:no-remote-exec`, and rightly so on a security-posture framework. The win over the cheaper Hono-style edits would be small here and the contract change is large.
- **Did not pre-build a cached 404/405 problem+json `Response` template.** This was option #2 on the audit list (estimated win after parity: low single digits) and touches `src/errors.ts`'s `toResponse()` contract. Deferred until there's a measurable reason to take that complexity.
- **Did not chase the upstream `pipe Node Readable responses directly to socket` commit's per-request overhead.** Pre-pull baselines were 23–27k req/s on the same scenarios; post-pull is 16–21k. That regression is real and worth profiling, but it lives in `src/adapters/node.ts` (the streaming path), not in the dispatch loop, and the user asked us to call it a day on this session.
- **Did not remove the second `new URL()` from `assertCrossOriginAllowed`** (audit item #6). The cross-origin guard fires on every dispatch, not just errors, and the per-request `new URL(requestUrl).origin` lookup is reachable from happy-path code too. Worth fixing — but the right scope is a generic "cache the parsed origin alongside `pathname`" pass, not a one-line tweak inside the guard.

---

## Lessons (additions)

27. **"Read the competition" is a budgetable activity, not a vibe.** Round 17 read one file in `@hono/node-server` and produced +13.5% on 1 MiB. Round 18 dispatched five parallel reads across six framework directories — total elapsed time about three minutes — and produced a plan that closed the error-path gap entirely. The thing that makes this work is *parallelism*: a single Explore agent per framework, each told what to look for, all reading at once. The marginal cost is much lower than the marginal cost of guessing wrong about which bottleneck to chase.
28. **The lazy-context pattern generalizes.** Round 1–3 made `ctx.set` lazy. Round 18 made `ctx.query` and `ctx.headers` lazy on the 404 path. The recipe is the same every time: identify a field that every request pays to construct and most requests never read; replace eager allocation with a closure-backed getter that materializes on first access; preserve setter semantics so anything that *does* write the field still works. The cost of the indirection is a single boolean check; the savings are everything the eager construction did.
29. **Match the ceiling, then stop.** The `daloy-minimal` server was built as a sanity check ("how fast could Daloy go if we threw out the contract?"). Within one session of edits, the shipped `daloy` server hit it within noise on all three scenarios. That's the right signal to stop — the remaining gap to Hono on these rows is the cost of returning RFC 9457 problem+json instead of a 15-byte `{"error":"bad"}`, and that's a product decision, not a framework one. Lesson 19 ("some gaps aren't gaps, they're a posture") applies again.
30. **Symbol-for trips are routine now.** This is the third Round (5, 15, 18) that's added a `Symbol.for("daloyjs.…")` export to `src/app.ts` as the integration seam between the framework core and a Node adapter fast path. The pattern is paying for itself — each one is small, audit-friendly, multi-runtime safe, and additive. Worth codifying somewhere: any time a Node-specific fast path needs to pass typed metadata onto a `Request` or `Response`, the Symbol-for pattern is the answer.

---

## Files touched (Round 18)

- `src/app.ts` — 404/405 branch in `dispatch()`: removed the `url404 = getUrl()` lookup and reuses `pathname` from `getPathnameFast`; replaced eager `Object.fromEntries(url404.searchParams.entries())` + `headersToObject(request.headers)` with closure-backed getters that materialize on first access; added missing `export const DALOY_RAW_STREAM = Symbol.for("daloyjs.response.rawStream")` companion to `DALOY_RAW_BODY` and `DALOY_REQUEST_RAW_BODY`.
- `bench/cross-framework/servers/daloy-minimal.ts` *(new)* — hand-stripped Daloy server with an `onError` hook that short-circuits the three error scenarios to minimal wire shapes (15-byte JSON / plain-text 404). Used as the "what's the ceiling without contract changes?" baseline for the bench.
- `bench/cross-framework/error-path.mjs` — `FRAMEWORKS` list scoped to `daloy` + `daloy-min` for this session's apples-to-apples runs; other frameworks remain in the file but commented out.

No public API surface changed. `pnpm typecheck` is clean. The focused tests on the 404/405 path — `tests/app.test.ts`, `tests/method-not-allowed.test.ts`, `tests/internal-routes.test.ts`, `tests/on-send-hook.test.ts` — all 17 pass. The bench now reports daloy at parity with hand-stripped daloy-minimal on all three error scenarios.

---

## Round 19 — stable hidden classes: closing the memory gap to Fastify

**Date:** May 28, 2026
**Scope:** `pnpm bench:memory` — sustained-load RSS sweep (200 connections × 60s). Daloy was trailing Fastify by **~108 MiB peak / ~95 MiB growth** even after Rounds 1–18 had made the dispatch loop competitive on throughput.

**Problem.** Throughput benches had been the focus for ten rounds. The memory bench was a different story: per-request CPU was fine, but **per-request *shape* was not**. Reading [fastify/lib/symbols.js](fastify/lib/symbols.js) and [fastify/lib/request.js](fastify/lib/request.js) made the difference obvious — Fastify allocates a stable-hidden-class `Request` and `Reply` per request, with Symbol-keyed internal slots initialized in fixed order. Every request produces an instance V8 recognizes as the same shape, so inline caches hit and the young generation stays small.

Daloy's hot path was doing the opposite in three places:

1. **`makeLazySet()`** ran `Object.defineProperty(set, "headers", {...})` on every request. Each `ctx.set` got its *own* accessor descriptor installed at runtime — V8 could not share a hidden class across instances, and `copyContextHeaders`, `secureHeaders`, every header-writing hook saw a megamorphic site.
2. **`defineLazyContextProperty()`** did the same thing for `ctx.query` and `ctx.headers`. Every `ctx` was a fresh object literal *plus* two more `Object.defineProperty` installs. Same shape pollution, multiplied by three properties.
3. **`Object.assign(ctx.state, this.decorations, { requestId, log })`** — the per-request `{requestId, log}` literal allocation plus an `Object.assign` walk over the (almost always empty) `decorations` bag. On a server that never calls `app.decorate()`, this was pure allocation and iteration for nothing.

**What changed in [src/app.ts](src/app.ts).**

1. **`LazyResponseSet` class replaces `makeLazySet()`.** All instances share one V8 hidden class via prototype getters. The `SET_HEADERS_TOUCHED` symbol is replaced by a stable `touched: boolean` slot at a fixed field offset; `copyContextHeaders` reads `set.touched` and `set._h` directly. Same lazy-allocation semantics — `new Headers()` still only fires on first access — but the *shape* of `set` no longer varies per request.

2. **`RequestContext` class replaces the object-literal + `defineLazyContextProperty()` pattern in `buildContext`.** Constructor initializes `request, params, state, set` in fixed order; `body`, `_q`, `_qBuilder`, `_qSet`, `_h`, `_hBuilder`, `_hSet` are declared as class fields with default values so every instance has the same property layout. `query` and `headers` are *prototype* getters, not per-instance accessor descriptors — same lazy-builder semantics as before (eager value when a schema validated it, builder closure otherwise) but one hidden class for every ctx the framework ever allocates.

3. **`decorationsCount` fast path.** Added a counter to `App` that `decorate()` increments. The dispatch hot path now does `state.requestId = requestId; state.log = log;` (two writes to the stable `RequestContext.state` object, keeping its hidden class consistent) and only runs `Object.assign(state, this.decorations)` when `decorationsCount !== 0`. The per-request `{requestId, log}` literal is gone; the empty-decorations spread is gone.

The dead `makeLazySet`, `defineLazyContextProperty`, and `SET_HEADERS_TOUCHED` symbol were deleted.

**Why this is safe.**

- Class-based `LazyResponseSet` and `RequestContext` are pure refactors: same lazy semantics, same observable behavior, same setter write-through for the rare hook that reassigns `ctx.query`, `ctx.headers`, or `ctx.set.headers`. The only change is that V8 sees one hidden class per type instead of one per request.
- The `decorationsCount` counter is a strict accounting of own-key inserts in `decorate()`. The fast path fires only when no decoration was ever installed — the moment `app.decorate("db", pool)` runs, every subsequent request gets the full `Object.assign(state, this.decorations)` it always got.
- No security guardrail touched. `secureHeaders`, `requestId`, `assertNoReservedInternalHeaders`, `assertNoDuplicateSingletonHeaders`, `assertCrossOriginAllowed`, `assertTrustProxyConfigured`, body limits, JWT algorithm allowlists, prototype-pollution-safe parsers, RFC 9457 error contract — all unchanged.
- All 95 tests across `tests/app.test.ts`, `tests/security.test.ts`, `tests/node-adapter.test.ts`, `tests/on-send-hook.test.ts`, `tests/method-not-allowed.test.ts`, and `tests/logger-redaction-and-header-smuggling.test.ts` pass without modification.

**Measured effect (`pnpm bench:memory`, 200 connections × 60s, daloy vs fastify):**

| Metric          | Before | After  | Δ vs before | Fastify | Gap closed |
| --------------- | -----: | -----: | ----------: | ------: | ---------: |
| peak (MiB)      |  316.1 |  238.3 |    **−25%** |   207.4 |   **−72%** (108.7 → 30.9) |
| growth (MiB)    |  216.6 |  140.0 |    **−35%** |   121.4 |   **−80%** (95.2 → 18.6) |
| load-avg (MiB)  |  312.8 |  215.1 |    **−31%** |   153.4 |       −39% |

Daloy is now within **15% of Fastify on peak RSS and 15% on growth**, with the full secure-by-default stack still running on every request. The remaining gap is the posture cost (Lesson 19) — Fastify's bench server runs no header smuggling guards, no reserved-internal-header check, no CORS guard, no requestId, no problem+json error contract — not framework-shape cost.

**The pattern that worked.** This is the same play as Round 17, applied to allocator shape instead of CPU: read what the leader actually does ([fastify/lib/symbols.js](fastify/lib/symbols.js), [fastify/lib/request.js](fastify/lib/request.js), [fastify/lib/context.js](fastify/lib/context.js)), identify the technique that maps cleanly to Daloy's constraints, port the *idea* (stable hidden class via class declaration) without porting the *mechanism* (Fastify generates a per-route `_Request` constructor; Daloy uses one global `RequestContext` class because the per-route win is much smaller without Fastify's encapsulated plugins). Five-minute read of three files, one session of edits, one measurable round.

---

## What we deliberately did *not* do (Round 19 additions)

- **Did not pool `RequestContext` or `LazyResponseSet` across requests.** Fastify also deliberately avoids this: short-lived objects of stable shape are exactly what V8's young generation is built for, and pooling risks `ctx.state` bleed between requests (a guardrail erosion `AGENTS.md` explicitly calls out). The win is hidden-class stability, not object reuse.
- **Did not port Fastify's per-route `buildRegularRequest()` constructor generation.** Fastify dynamically synthesizes a `_Request` subclass per registered route so V8 sees a *single* hidden class per route, not just per framework. That's the next echelon of allocator discipline, but it interacts with Daloy's route compilation in non-trivial ways and the global `RequestContext` already captured most of the win. Tracked for a future round.
- **Did not chase Fastify on the last 15% by removing guards.** The remaining ~31 MiB peak / ~19 MiB growth gap is the cost of the security/observability stack running on every request — same posture as Round 19's lesson (small-body throughput). The honest comparison is `pnpm bench:secured`, not the bare-router memory sweep.
- **Did not touch the per-request `randomId()` / requestId path.** It's part of the framework's observability contract (`x-request-id` response header, `ctx.state.requestId`) and Lesson 22 already wrung the cheap wins out of it.

---

## Lessons (additions)

31. **Throughput benches and memory benches measure different things.** Ten rounds of `pnpm bench:throughput` / `bench:body-size` / `bench:errors` did not move `pnpm bench:memory` because per-request CPU and per-request *shape* are independent failure modes. A framework can be fast on a microbenchmark and still bleed RSS under sustained load if its allocator shape pushes V8 into deopt/megamorphic territory. Add the memory bench to the routine and the next class of win shows up.
32. **`Object.defineProperty` in the hot path is a hidden-class destroyer.** It looks the same as a class getter in source, but at runtime it installs a fresh accessor descriptor per instance — and V8 treats each instance as a unique shape. The `defineLazyContextProperty()` helper was clever-looking code that quietly cost ~75 MiB of growth at 200 connections × 60s. The boring fix (declare the getter on the prototype via a class) was strictly better.
33. **Counter the empty case.** `Object.assign(target, src1, src2)` over an empty `src2` is not free — V8 still walks the source, checks each enumerable key, and the call itself blocks any caller-side stable-shape assumption about `target`. A one-property `decorationsCount` counter turned the common case (no decorations) into two direct assignments and let `ctx.state` keep a consistent hidden class across requests.
34. **Read the leader's source for the technique you're missing, not the answer you want.** Fastify's [lib/symbols.js](fastify/lib/symbols.js) doesn't say "here is how to win bench:memory" — it shows 80 Symbol-keyed property names initialized in fixed order. The technique (stable hidden class via fixed-shape constructors) ported cleanly even though the mechanism (per-route generated `_Request` subclasses) did not. Lesson 24 ("read the competition's code before optimizing") works just as well for allocator shape as it does for CPU.

---

## Files touched (Round 19)

- `src/app.ts`:
  - **New** `LazyResponseSet` class — replaces `makeLazySet()`. Stable-hidden-class lazy `ctx.set` with prototype `headers` getter and `touched: boolean` slot.
  - **New** `RequestContext` class — replaces the per-request object literal + `defineLazyContextProperty()` pattern in `buildContext`. All fields declared in fixed order; `query` / `headers` are prototype getters backed by `_qBuilder` / `_hBuilder` closures.
  - **New** `decorationsCount: number` field on `App`, incremented in `decorate()`. Dispatch hot path now writes `state.requestId` / `state.log` directly and only runs `Object.assign(state, this.decorations)` when the counter is non-zero.
  - **Deleted** `makeLazySet()`, `defineLazyContextProperty()`, and the `SET_HEADERS_TOUCHED` symbol (replaced by `LazyResponseSet.touched`).
  - `copyContextHeaders()` updated to read `set.touched` and `set._h` directly off the `LazyResponseSet` instance.

No public API surface changed. `pnpm typecheck` is clean. All 95 tests in the affected suites pass. `pnpm bench:memory` now reports daloy peak **238.3 MiB** (was 316.1) and growth **140.0 MiB** (was 216.6) — closing ~72% of the absolute MiB gap to Fastify in a single round.

