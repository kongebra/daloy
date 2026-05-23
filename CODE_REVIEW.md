# Code review checklist

This document is the checklist maintainers use when reviewing a pull
request into `daloyjs/daloy`. It is published in the repo so that:

1. Reviewers have a single reference and don't have to re-derive the
   review rules from memory or from scattered notes in [AGENTS.md](./AGENTS.md),
   [SECURITY.md](./SECURITY.md), and [CONTRIBUTING.md](./CONTRIBUTING.md).
2. Forkers and downstream users of `@daloyjs/core` can adopt (or audit)
   the same checklist for their own apps without guessing what we
   actually look at.

It is informed by widely-shared code-review guidance — including the
Aikido write-up on
[code review best practices](https://www.aikido.dev/blog/code-review-best-practices)
— mapped onto the specific quality gates and threat model documented in
[AGENTS.md](./AGENTS.md) and [SECURITY.md](./SECURITY.md). Where an
item is already enforced by an automated gate, the gate is named — a
reviewer should treat a green gate as evidence, not as a substitute for
reading the diff.

## Scope and policy

- Pull requests are accepted only from invited collaborators. External
  PRs are closed by
  [.github/workflows/close-external-prs.yml](.github/workflows/close-external-prs.yml).
  See [CONTRIBUTING.md](./CONTRIBUTING.md) for the reasoning.
- Workflow files, release tooling, lockfiles, `package.json`, and
  security policy require a maintainer approval per
  [.github/CODEOWNERS](.github/CODEOWNERS). A reviewer who is **not** a
  CODEOWNER on a touched path cannot single-handedly approve it.
- Reviewers should keep PRs small and focused. A PR that touches more
  than a few hundred changed lines, or mixes a feature with an
  unrelated refactor, should be split before review starts.

## Reviewer checklist

Each numbered group is a thing a reviewer must actively check; the
indented bullets are the questions to ask. The goal is "read every
line", not "trust CI".

### 1. Correctness and tests

- Does the PR include happy-path **and** unhappy-path tests for the new
  behaviour, as required by [AGENTS.md](./AGENTS.md)?
- For bug fixes, is there a regression test that fails without the fix?
- Are tests asserting observable behaviour, not just that a function
  was called? Prefer black-box assertions against the HTTP boundary.
- Did `pnpm typecheck` and `pnpm coverage` actually run, and are
  coverage numbers above the gate (90% lines, 90% functions, 90%
  branches on the compiled-JS run) — or, if not, is the deviation
  justified in `PROJECT_HISTORY.md` per the AGENTS.md guidance?

### 2. Security review (highest priority)

Treat anything in `src/security.ts`, `src/jwt.ts`, `src/hashing.ts`,
`src/cookie.ts`, `src/jwk.ts`, `src/fetch-guard.ts`, `src/ip-restriction.ts`,
`src/rate-limit-redis.ts`, `src/load-shedding.ts`, `src/logger.ts`,
`src/multipart.ts`, `src/router.ts`, and `src/app.ts` as security-relevant
by default.

- **Input validation at the boundary.** Every new route handler or
  parser must validate inputs with a Zod schema (or an equivalent
  typed parser). Validation cannot be skipped because "the caller
  always sends the right shape".
- **Prototype pollution.** Any new code that walks an untrusted object
  must honour `isForbiddenObjectKey` (see [`src/app.ts`](src/app.ts)
  and [`src/jwt.ts`](src/jwt.ts)) and use `safeJsonParse` instead of
  bare `JSON.parse` for untrusted JSON.
- **Secret handling.** Secret comparisons must use `timingSafeEqual`
  via the helpers in [`src/hashing.ts`](src/hashing.ts); plain `===`
  on tokens is rejected by `pnpm verify:secret-comparisons`. New
  redaction surfaces must extend the lists in [`src/logger.ts`](src/logger.ts)
  rather than duplicating logic.
- **Authentication / authorisation.** New endpoints that touch
  identity, sessions, JWTs, CSRF, or admin-only routes must wire
  through the existing guards in [`src/jwt.ts`](src/jwt.ts) and
  related modules. A reviewer should be able to point at the line that
  enforces the check.
- **Error messages.** Errors raised from security paths must use
  fixed-string `reason` codes (see the `JwtError` / `TemporalClaimError`
  pattern in [`src/jwt.ts`](src/jwt.ts) and `src/time-claims.ts`) and
  must not echo attacker-controlled input.
- **Algorithm allowlists.** Any change to a JWT algorithm list, a
  hashing algorithm, a TLS option, or a cookie attribute must be
  reviewed against the static gates `pnpm verify:parity-audits`,
  `pnpm verify:governance-audits`, `pnpm verify:runtime-parity-audits`,
  and `pnpm verify:routing-hardening-audits`, all of which run in CI.
- **Supply-chain surface.** New runtime dependencies are forbidden by
  `pnpm verify:no-runtime-deps`; new lifecycle scripts by
  `pnpm verify:no-lifecycle-scripts`; new network calls in build
  scripts by `pnpm verify:no-registry-exfiltration` and
  `pnpm verify:no-remote-exec`. A reviewer who sees one of these gates
  silenced or `// eslint-disable`'d must block the PR.
- **Hidden payloads.** Encoded or invisible-unicode payloads in source
  or docs are caught by `pnpm verify:no-encoded-payloads` and
  `pnpm verify:no-invisible-unicode`. If those gates are touched, the
  PR needs explicit maintainer sign-off.
- **CodeQL / Opengrep / DAST / Secret-scan / Scorecard / Zizmor.**
  CI runs all of these on every PR (see [.github/workflows](.github/workflows)).
  Any new finding must be triaged in the PR conversation; suppressions
  require a comment explaining why the finding is a false positive.

### 3. API design and stability

- Does the public surface change? If yes, is the change reflected in
  `src/index.ts`, the generated OpenAPI snapshot, the typed client
  (`pnpm gen`), and the docs under `website/`?
- Is the change additive, or does it break an existing signature?
  Breaking changes require a major-version bump and a coordinated
  release per the "Release Coordination" section of [AGENTS.md](./AGENTS.md).
- Are new options sensibly defaulted to the **secure** value, so that
  consumers who don't read the docs still get the safe behaviour?

### 4. Performance and resource safety

- Are new per-request allocations bounded? Watch for unbounded `Map` /
  `Set` growth, regex catastrophic backtracking, and synchronous loops
  over user-controlled input.
- Are new timers, sockets, file handles, and subprocesses cleaned up
  on shutdown? The graceful-shutdown contract in [`src/app.ts`](src/app.ts)
  must keep passing.
- Did the change touch a hot path (router, middleware chain, JSON
  parser)? If so, the relevant entry in [`bench/router.bench.ts`](bench/router.bench.ts)
  should be re-run and the result noted in the PR.

### 5. Observability and operability

- New errors must flow through the existing `errors.ts` / `logger.ts`
  pipeline so they are redacted and structured consistently.
- New log statements must not include credentials, tokens, cookies,
  authorization headers, or other secret material — `redactRecord()`
  in [`src/logger.ts`](src/logger.ts) is the safety net, not the design.
- New metrics or trace points should be documented in the relevant
  page under `website/`.

### 6. Documentation and release coordination

- Every user-visible change updates the docs under `website/` and the
  "Status" table in [README.md](./README.md), per [AGENTS.md](./AGENTS.md).
- Blog posts and marketing pages follow the rules in
  [website/AGENTS.md](./website/AGENTS.md) (voice, dates, sitemap entry,
  nav entry).
- A bump of `@daloyjs/core` must be paired with the matching bump and
  template / fallback updates for `create-daloy` listed in the
  "Release Coordination" section of [AGENTS.md](./AGENTS.md).
- `SECURITY.md` is updated when the change has security implications,
  even if the implication is "this gate is now stricter".

### 7. Style and craft

These do not block a security or correctness review, but reviewers are
expected to flag them.

- Names match the surrounding module's style; abbreviations are not
  introduced for their own sake.
- Comments explain **why**, not **what**. Code that needs a comment to
  explain what it does should usually be rewritten.
- New helpers are introduced only when they are reused or when they
  isolate a hard-to-test slice. One-shot abstractions are rejected
  per the `<implementationDiscipline>` rule in
  [`.github/copilot-instructions.md`](./.github/copilot-instructions.md).

## What automation already does for you

A reviewer should know what they do **not** have to manually check,
because CI does it on every PR:

- Typecheck, unit tests, coverage gates — [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
- CodeQL static analysis — [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml).
- Opengrep rules — [`.github/workflows/opengrep.yml`](.github/workflows/opengrep.yml).
- DAST against the example server — [`.github/workflows/dast.yml`](.github/workflows/dast.yml).
- Secret scanning — [`.github/workflows/secret-scan.yml`](.github/workflows/secret-scan.yml).
- Dependency vulnerability scanning — [`.github/workflows/vuln-scan.yml`](.github/workflows/vuln-scan.yml).
- OpenSSF Scorecard — [`.github/workflows/scorecard.yml`](.github/workflows/scorecard.yml).
- Workflow hardening (zizmor) — [`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml).
- All `pnpm verify:*` governance scripts in [`scripts/`](./scripts).
- Auto-close of uninvited external PRs — [`.github/workflows/close-external-prs.yml`](.github/workflows/close-external-prs.yml).

A reviewer's job is the part those tools cannot do: read every changed
line, reason about the threat model, and refuse to merge anything that
relies on the reader being clever.

## For users of `@daloyjs/core` (downstream apps)

If you ship a Daloy app, the same checklist scales down. The minimum
review discipline we recommend for any app built on the framework:

1. **Two-pair-of-eyes rule for security-touching code.** Anything that
   reads auth headers, issues tokens, validates webhooks, redacts
   logs, or talks to a payment / identity provider should require a
   second reviewer.
2. **Run the same `pnpm verify:*` gates that the framework ships
   with.** The scaffold from `create-daloy` wires the most important
   ones into your CI by default; do not remove them.
3. **Keep PRs small, schema validation at the boundary, and secrets
   out of logs.** These three rules alone catch the majority of issues
   that would otherwise reach production.
4. **Treat a CI failure as a review blocker, not a flake.** If a gate
   reports a finding, triage it in the PR; do not re-run until green.

If you adopt this checklist verbatim in your own repo, please update
the paths to point at your own files — the value is in the discipline,
not in the link targets.
