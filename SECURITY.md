# Security Policy

DaloyJS is a backend framework, so security issues are treated as release-blocking
work. Please report suspected vulnerabilities privately before opening public
issues or pull requests.

## Supported Versions

DaloyJS is currently pre-1.0. Security fixes target the latest published `0.x`
release and `main`.

| Version | Supported |
| --- | --- |
| Latest `0.x` | Yes |

## Reporting a Vulnerability

Use GitHub's private vulnerability reporting for this repository when available:

<https://github.com/daloyjs/daloy/security/advisories/new>

If that link is unavailable, open a minimal public issue asking for a private
security contact without sharing exploit details.

Please include:

- Affected version or commit.
- Runtime and adapter involved, if any.
- Reproduction steps or a small proof of concept.
- Expected impact and any known mitigations.

## Response Target

- Initial acknowledgement: within 3 business days.
- Triage decision: within 7 business days.
- Fix release: as soon as practical, prioritized ahead of normal roadmap work.

## Scope

Security reports are especially useful for:

- Request parsing, body limits, and content-type bypasses.
- Prototype pollution or unsafe JSON handling.
- Header injection and response splitting.
- Path traversal or router confusion.
- Authentication, timing, CORS, rate limit, and secure header middleware issues.
- Adapter-specific behavior that changes security guarantees across runtimes.

Please do not use destructive tests against systems you do not own.

---

## Threat model

DaloyJS is designed for the threat model of an **internet-facing HTTP API
running on a trusted runtime** (Node, Bun, Deno, or a managed serverless edge).
The framework assumes the runtime is not actively malicious; the network and
every HTTP client (browser, mobile, CLI, attacker) are untrusted.

### In scope (the framework MUST defend)

| Class | Built-in defense |
| --- | --- |
| Body-size DoS | Core-enforced streamed body read with hard cap (default 1 MiB); `Content-Length` rejected pre-read when oversize. |
| Prototype pollution via JSON | Core `safeJsonParse` strips `__proto__` / `constructor` / `prototype` via reviver. |
| Header/response splitting | Core `sanitizeHeaderName` / `sanitizeHeaderValue` reject CRLF + NUL. |
| Path traversal | Router rejects `..` and `//` before walking. |
| Method confusion | Real **405** with `Allow` header. |
| Slow handlers / runaway loops | Core `requestTimeoutMs` aborts handlers (30 s default); Node adapter sets `requestTimeout` + `headersTimeout` + `maxHeaderSize`. |
| 5xx info disclosure | Production mode strips `detail` from 5xx problem+json automatically. |
| CRLF in user-controlled headers | All built-in middleware that emit headers from config (`basicAuth` realm, `csrf` cookie name, etc.) reject CRLF at construction time. |
| Credential timing attacks | First-party `timingSafeEqual()` plus `basicAuth()` verifier hooks designed for constant-time password checks. |
| Cross-origin forgery (CSRF) | First-party `csrf()` with two strategies (double-submit cookie + Fetch-Metadata, see [docs](https://daloyjs.dev/docs/security/csrf)). |
| Cross-Site WebSocket Hijacking (CSWSH) | `app.ws()` refuses-at-registration in production unless the route sets `allowedOrigins` (`"same-origin"`, a string allowlist, or a predicate) or explicitly opts in via `acknowledgeCrossOriginUpgrade: true`. The Origin check runs **before** `beforeUpgrade`, so an attacker's drive-by `new WebSocket(...)` is rejected with `403` before any cookie-bearing handler runs. Closes the Storybook [CVE-2026-27148](https://www.aikido.dev/blog/storybooks-websockets-attack) class of bug. |
| Clickjacking / MIME sniffing / cross-origin leakage | First-party `secureHeaders()` (CSP, HSTS, COOP, CORP, `X-Frame-Options`, `X-Content-Type-Options`, Permissions-Policy; CSP nonce + Trusted Types). |
| Trusted-proxy header spoofing | `rateLimit({ trustProxyHeaders })` and `requestId({ trustIncoming })` default OFF; key generators must be explicit. |
| Supply chain | pnpm strict isolation + `ignore-scripts` + `minimum-release-age` + verified store; SHA-pinned CI; OIDC publishing with provenance (see Supply-chain section below). |

### Explicitly out of scope (the framework will NOT defend)

- **DOS at the network layer** (SYN floods, amplification). Place DaloyJS
  behind a reverse proxy, WAF, or DDoS mitigation service.
- **Insecure handler code.** The framework cannot stop a route that constructs
  SQL via string concatenation, leaks secrets in error messages, or trusts
  unvalidated client input passed to the OS shell.
- **Credential storage and rotation.** DaloyJS provides `bearerAuth`,
  `basicAuth`, and signed-cookie `session`. Hashing, key rotation, JWT verification,
  and OAuth flow correctness are the application's responsibility (use `jose`,
  `argon2`, or a dedicated identity provider).
- **TLS termination.** Production deployments must run behind HTTPS; the Node
  adapter speaks plain HTTP.
- **Runtime compromise.** If the underlying Node/Bun/Deno binary or the host
  is compromised, no framework can protect application data.

### Trust boundaries

```
[ Untrusted client ] --HTTPS--> [ Trusted reverse proxy / edge ]
          |
          v
        [ DaloyJS App.fetch ]   <- request/header sanitization,
          |                  body-size cap, timeouts,
          v                  problem+json
        [ User handlers ]
          |
          v
        [ Trusted data store ]   <- caller's responsibility
```

### Hardening roadmap (tracked, not yet shipped)

These improvements are on the security roadmap. They are listed publicly so
operators can plan around them and contributors can pick them up. Items that
have shipped are kept here briefly with a `(shipped)` marker so the history
remains auditable.

- **First-party JWT verification** — `createJwtVerifier` / `createJwtSigner`
  with a mandatory algorithm allowlist (no `none`, no `alg` from header),
  configurable `issuer`/`audience`/`clockTolerance`, and first-party JWKS
  resolution via `jwk()`. **(shipped)**
- **Under-pressure auto-shedding** in the Node adapter (event-loop lag, RSS,
  heap), returning `503` before the runtime hangs. Exposed as `loadShedding()`
  with the `LOAD_SHEDDING_MARKER` integration hook. **(shipped)**
- **First-party WebAuthn / passkeys** via a thin wrapper over a vetted library.
- **SSRF guard** (`fetchGuard()`) blocking outbound `fetch` to RFC1918,
  loopback, link-local, and metadata-service IPs unless explicitly allowlisted.
- **Per-route capability-based body limits** derived from the route schema
  (override the global cap when the schema implies a tighter ceiling).
- **SLSA build-level-3 attestations** and **CycloneDX SBOM** generated and
  attested per release, beyond the existing npm provenance attestation.
- **`npm audit signatures`** (or equivalent registry-signature verification)
  enforced in CI for every install.
- **Continuous fuzzing** of the JSON parser, header sanitizers, router, and
  multipart parser via Jazzer.js + OSS-Fuzz.
- **Third-party audit** of the core once the public API stabilizes around
  `1.0`, with the report linked from this file.
- **Public bug bounty** through huntr.dev (or equivalent) once the audit ships.

---

## Supply-chain security (how DaloyJS is built and published)

We treat the package supply chain as an attack surface. The controls below are
specifically designed against the patterns documented in
[`otherdocs/security-incidence.md`](otherdocs/security-incidence.md), most
recently the TanStack 2026-05-11 worm
([postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem),
[follow-up](https://tanstack.com/blog/incident-followup)) and the
chalk/debug/node-ipc phishing campaigns.

### CI/CD

- **No `pull_request_target` anywhere in the repo.** Fork PRs run with the
  default `pull_request` trigger and have no access to repo secrets, the GitHub
  Actions cache scope shared with `main`, or any token capable of publishing.
- **Top-level `permissions: {}`** in every workflow; jobs opt in to the
  minimum scopes they need.
- **`actions/checkout` runs with `persist-credentials: false`** so the workflow
  token is not left on disk for later steps to scrape.
- **Third-party GitHub Actions are SHA-pinned.** Workflows execute immutable
  commits instead of mutable version tags, which removes the retagging class of
  supply-chain attack from CI.
- **`step-security/harden-runner`** monitors and (on the publish job) blocks
  egress to anything other than the npm registry, GitHub, and the Sigstore
  endpoints needed for provenance.
- **No GitHub Actions cache** in the standard CI workflow. Cache scope is
  shared between fork PRs and pushes to `main`, which is the cache-poisoning
  vector that bridged TanStack's PR pipeline into its release pipeline.
- **`zizmor`** statically analyses every workflow on every PR
  (`.github/workflows/zizmor.yml`).
- **CodeQL** runs JavaScript/TypeScript and `actions` queries
  (`.github/workflows/codeql.yml`).
- **OpenSSF Scorecard** publishes a continuous scorecard
  (`.github/workflows/scorecard.yml`).
- **Dependabot** keeps actions and npm dependencies up to date weekly
  (`.github/dependabot.yml`).
- **`CODEOWNERS`** requires a maintainer to approve any change under
  `.github/`, `package.json`, the lockfile, or `.npmrc`.

### npm publishing

- **Releases are isolated.** The publish workflow
  (`.github/workflows/release.yml`) is triggered only by a signed tag push or
  manual maintainer dispatch. It never runs from a PR, never runs from a
  branch, and never shares a runner with code that came from a fork.
- **Core and CLI releases are intentionally split.** Pushing a signed `v*` tag
  publishes `@daloyjs/core` after verification and protected-environment
  approval. `create-daloy` is published by manually dispatching
  `release.yml` with `package=create-daloy` (or `package=all`) so the CLI is
  not released accidentally on every core tag.
- **`id-token: write` is granted only to the publish job**, only after a
  protected GitHub Environment (`npm-publish`) requires explicit maintainer
  approval. There is no long-lived `NPM_TOKEN` in repo secrets.
- **Publishes use `--provenance`.** Every tarball is bound to its source
  commit and workflow run via npm trusted publishing (OIDC) and Sigstore.
- **Tag/version match is verified** before `pnpm publish` runs.
- **No third-party install scripts run during publish.** Install uses
  `--ignore-scripts`; the few packages that legitimately need to build are
  allowlisted via `pnpm.onlyBuiltDependencies` in `package.json`.

### Maintainer accounts

- **Hardware-backed 2FA is mandatory on npm and GitHub** for every account
  with write access to the `daloyjs/daloy` repository AND every npm account
  with publish rights to `@daloyjs/core` or `create-daloy`. SMS factors are
  not permitted. 2FA enforcement is configured at the GitHub organization
  level (`Settings → Authentication security → Require two-factor
  authentication`) and at the npm registry level (`npm access 2fa-required`
  on each published package), so an account without 2FA cannot push to
  `main`, approve the `npm-publish` GitHub Environment, or run
  `npm publish`. Maintainers should rotate credentials immediately after any
  ecosystem-wide phishing campaign (e.g. `npmjs.help`-style lookalikes).
- **Removal of an account is part of the off-boarding checklist.** Whenever
  a contributor with publish access leaves rotation, the maintainer
  off-boarding step revokes their GitHub organization membership, their npm
  publish grant, and any granular tokens scoped to `@daloyjs/*` packages
  before their last day.
- **Granular npm access tokens only**, scoped to a single package, with IP
  allowlists where the maintainer's network supports it.
- **No publishing from a developer machine.** All published artifacts come
  from `release.yml`.
- **Signed commits and signed tags** for every release.

### Release checklist

1. Commit the prepared version/docs changes to `main`.
2. Create and push a signed `v*` tag for the core package version.
3. Approve the pending `npm-publish` environment for the tag-triggered core release.
4. Manually dispatch `release.yml` with `package=create-daloy` when the CLI version also needs publishing.
5. Confirm every contributor who approved the `npm-publish` Environment for
   this release has hardware-backed 2FA enabled at both the GitHub
   organization level and the npm registry level. (Mandatory-2FA
   audit gate.)
6. Confirm the GitHub actor on the publish run is listed in the ACTIVE block
   of [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md). The release
   gate refuses to publish otherwise.

### Mapping to the 5 pillars of a Secure SDLC

Operators occasionally ask how Daloy maps onto the generic Secure-SDLC
checklists that show up in vendor blog posts (e.g. Aikido's
["Secure SDLC for Engineering Teams"](https://www.aikido.dev/blog/secure-sdlc)
five-pillar model: Visibility, Early Feedback, Developer Adoption,
Consistency, Actionability). We are an open-source backend framework, not an
organization with a security program, so the mapping is necessarily narrower
than an internal SSDLC — but every pillar has a concrete control or a
documented out-of-scope boundary. We list them here so the answer is one
link, not a guessing game.

| Pillar | What Daloy ships | What is out of scope (and why) |
| --- | --- | --- |
| **Visibility** | Public source tree, public [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) changelog, `@daloyjs/core`'s **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts)) so the transitive tree is exactly the dev/test deps in [`pnpm-lock.yaml`](pnpm-lock.yaml). Every published tarball carries an npm **provenance attestation** (Sigstore + OIDC) that binds the bytes to the source commit and the `release.yml` run. `pnpm audit --prod` runs on every PR and every publish. Roadmap: CycloneDX SBOM attested per release (see roadmap above). | Inventorying the *consumer's* applications, cloud assets, or running deployments. That is an operator-side ASPM concern (Aikido, Snyk, Wiz, etc.) and the framework cannot do it for them. |
| **Early Feedback** | Security feedback runs **inside the PR**, not at release time: `zizmor` ([`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)) statically rejects unsafe workflow patterns; CodeQL ([`.github/workflows/codeql.yml`](.github/workflows/codeql.yml)) runs JavaScript/TypeScript and `actions` queries; OpenSSF Scorecard ([`.github/workflows/scorecard.yml`](.github/workflows/scorecard.yml)) publishes a continuous score; `pnpm verify:wave9-audits` / `verify:wave10-audits` / `verify:wave11-audits` / `verify:wave12-audits` / `verify:secret-comparisons` / `verify:no-runtime-deps` / `verify:lockfile` enforce the documented security floor on every PR; Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) opens PRs weekly for actions and npm deps. CODEOWNERS ([`.github/CODEOWNERS`](.github/CODEOWNERS)) requires a maintainer to approve any change under `.github/`, `package.json`, `pnpm-lock.yaml`, or `.npmrc`. | Author-time IDE feedback (SAST in the editor). We do not bundle a proprietary scanner — operators who want that should layer Snyk / Aikido / Semgrep / GitHub Advanced Security on top, none of which conflict with our gates. |
| **Developer Adoption** | Security gates live in the same commands developers already run: `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm coverage:branches`, and the `verify:*` family are documented in [`AGENTS.md`](AGENTS.md) as the quality gate for every change. The list is short and reused for human contributors, CI, and AI agents — there is no separate "security checklist" that drifts out of sync. The scaffolded templates ([`packages/create-daloy/templates/`](packages/create-daloy/templates)) inherit the same defaults (`.npmrc` with `ignore-scripts=true` and `minimum-release-age=1440`, `_gitignore` excluding `.env*`, etc.) so consumer apps start with the framework's security posture, not a stripped-down one. | Adoption inside the *consumer's* org. That is a cultural change owned by the consumer's engineering leadership; the most we can do is ship safe defaults and document them. |
| **Consistency** | The **governance floor** (above) is enforced by [`pnpm verify:wave10-audits`](scripts/verify-wave10-audits.ts) on every PR: it refuses to merge a change that removes top-level `permissions:`, `persist-credentials: false`, a SHA-pin on a third-party action, `step-security/harden-runner` on workflows that use third-party actions, a runtime dep on `@daloyjs/core`, [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md), or [`.github/CODEOWNERS`](.github/CODEOWNERS). Removal of any control requires a documented `SECURITY.md` entry and maintainer-quorum sign-off. The same `verify:*` family runs identically in `ci.yml` and the pre-publish `verify` job in `release.yml`, so a PR cannot pass CI under one rule set and be published under a weaker one. | Enforcing the same rules across *consumer* repositories. We document the recommended posture (see § Supply-chain security and the per-incident tables above) and ship the same defaults in scaffolded templates, but we cannot police a downstream project's CI. |
| **Actionability** | When an incident in the broader ecosystem matches a Daloy-relevant attack pattern, we publish a step-by-step mapping table (see the `shopsprint`, `node-ipc 2026-05-14`, GitHub VS Code-extension, and ToxicSkills tables above) that says, per attack step, which Daloy control catches it and which steps are explicitly out of scope. The recurring quarterly **disclosure exercise** (above) verifies that the private-report inbox, the active maintainer rotation, the `npm-publish` Environment, the `verify:wave10-audits` gate, and every active contact's recovery-email domain are still working — a missed quarter fails CI loud. [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) records the date and outcome of each exercise. | Prioritizing findings *inside the consumer's* application. Daloy does not bundle an ASPM dashboard; consumers who need one should pair the framework with their existing AppSec stack. |

If an SSDLC checklist surfaces an item that maps onto a class of attack the
framework should defend against and currently does not, treat the gap as a
release-blocking bug and open a private advisory.

### Mapping to Aikido Package Health (consumer-facing scoring rubric)

Aikido's 2026-02-03
[Package Health Score](https://www.aikido.dev/blog/introducing-aikido-package-health)
rates an npm package on **five weighted categories** — *Dependencies*,
*Maintainer Stability*, *Maturity*, *Supply-Chain Scripts*, *Attestations* —
that a consumer can look up at <https://intel.aikido.dev/packages> before
installing. Operators occasionally ask which Daloy controls back each
category so the answer is one link, not guesswork. The mapping below is
explicit, and every claim either points at a file in this repo or at a
governance gate that runs in CI.

| Aikido category | What it measures | DaloyJS control |
| --- | --- | --- |
| **Dependencies** | "How stable the dependency tree is between versions." Penalises churn in the transitive tree. | `@daloyjs/core` declares **zero runtime dependencies** ([`package.json`](package.json)). [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) and the governance floor refuse a PR that adds one. There is no transitive runtime tree to churn — installing `@daloyjs/core` adds the bytes of the package itself, nothing more. Adapter bindings (`hono`, `@cloudflare/workers-types`, `zod`, etc.) are `peerDependencies` chosen by the consumer. |
| **Maintainer Stability** | "How consistent the release authors are and whether maintainership has shifted unexpectedly." Penalises unexpected handovers. | Active release authors are documented in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) and verified each quarter by the disclosure exercise (above). Off-boarding is a step on the release checklist (§ Maintainer accounts). Every release tag is signed and every release commit is signed, so the chain of release authors is cryptographically inspectable from the git log. The pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml) refuses to publish unless the actor on the publish run is listed in the **Active** block of [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) (release gate). |
| **Maturity** | "How long the project has existed, how predictably it evolves, and whether releases follow a sensible cadence." Penalises rewritten history and erratic versioning. | Semantic versioning is enforced by hand at release time; the full ordered history of every shipped change lives in [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) (`## 9. Change log going forward`, newest at the top, one entry per release). Releases are tagged as signed `v*` tags and the tag/version match is verified before `pnpm publish` runs (§ npm publishing). The release-history is append-only: we have never force-pushed `main` and we have never deleted a published version from npm. |
| **Supply-Chain Scripts** | "How safe the package's lifecycle scripts are and whether they introduce unnecessary risk during installation." Penalises any of `preinstall` / `install` / `postinstall` / `prepare` / `preprepare` / `postprepare` / `prepublish`. | Both published packages (`@daloyjs/core`, `create-daloy`) declare **zero install-time lifecycle scripts**. Only `prepublishOnly` ships — that hook runs *on the maintainer's CI* during publish and is never executed by a consumer's `pnpm install`. The new [`pnpm verify:no-lifecycle-scripts`](scripts/verify-no-lifecycle-scripts.ts) governance gate fails a PR that adds any forbidden hook to either published manifest and runs in both [`ci.yml`](.github/workflows/ci.yml) and the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml). Consumer-side defence-in-depth: every scaffolded template ships `.npmrc` with `ignore-scripts=true`, so even an upstream dep that *does* declare a lifecycle hook will not run it on a fresh `create-daloy` project. |
| **Attestations** | "Whether the project includes verifiable provenance to prove that builds are authentic and reproducible." | Every `@daloyjs/core` and `create-daloy` tarball is published with `--provenance` (root [`.npmrc`](.npmrc) sets `provenance=true`), which binds the bytes to the source commit and the `release.yml` workflow run via npm trusted publishing (OIDC) and Sigstore. Consumers can verify the published bytes against the source commit and reject any release whose attestation cannot be re-derived from the GitHub source (§ npm publishing). CycloneDX SBOM attestation per release is on the roadmap (above). |

What this **does not** defend against, and we say so explicitly:

- A consumer who installs a *different* package that happens to have a
  poor Aikido Package Health score. The score is per-package, not
  ecosystem-wide, and Daloy can only speak to `@daloyjs/core` and
  `create-daloy`. For every other package in the consumer's tree the
  consumer should run their own Aikido / Snyk / Socket lookup.
- Aikido changing the weighting of any category. The mapping above
  describes *what we ship*, not *what score Aikido renders*. If Aikido
  reweights "Supply-Chain Scripts" tomorrow, the underlying control —
  zero install-time hooks, enforced by `verify:no-lifecycle-scripts` —
  does not change.
- A future contributor adding a runtime dep or a `postinstall` hook
  through a non-`@daloyjs/core` package in the workspace (e.g. a new
  package under [`packages/`](packages)). The current
  `verify:no-lifecycle-scripts` gate checks the two published manifests
  by name; extending it to any new publishable package is a
  release-blocking task when that package is added.

If a future Aikido category lands that maps onto a class of attack the
framework should defend against and currently does not, treat the gap as a
release-blocking bug and open a private advisory.

### Governance floor (reaffirmed)

Every supply-chain control listed above is the documented governance floor.
Removal of any one of these requires an explicit `SECURITY.md` entry
justifying the removal and a maintainer-quorum sign-off on the PR. The
static gate that enforces this lives in
[`scripts/verify-wave10-audits.ts`](scripts/verify-wave10-audits.ts) and runs
in CI as `pnpm verify:wave10-audits`. It refuses a PR that:

- removes the top-level `permissions:` block from a workflow,
- removes `persist-credentials: false` from an `actions/checkout` call,
- replaces a SHA-pinned third-party action with a tag or branch reference,
- drops `step-security/harden-runner` from a workflow that uses third-party
  actions,
- adds a runtime dep to `@daloyjs/core/package.json` (zero-runtime-dep
  posture, also reaffirmed by the auth-helper hardening pass),
- removes the plugin-prerequisite refuse-to-boot path or the
  `topoSortExtensions` cycle-detection throw from `src/app.ts`, or
- removes `SECURITY-CONTACTS.md` or `.github/CODEOWNERS`.

### Recurring security-disclosure exercise

The disclosure rotation is documented in
[`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) and tested at least once per
quarter with a simulated report. Each exercise verifies that:

1. The private vulnerability-report inbox is monitored within the
   3-business-day acknowledgement target documented earlier in this file.
2. Every handle in the **Active** rotation can authenticate to GitHub and
   npm with hardware-backed 2FA.
3. The protected `npm-publish` GitHub Environment still requires explicit
   approval before any publish job executes.
4. `pnpm verify:wave10-audits` exits zero on `main`.
5. The GitHub and npm account-recovery email address for every handle in
   the **Active** rotation still resolves to a domain the contact
   personally owns, or to a custodial provider where the contact still has
   an active account. (Added 2026-05-20 in response to the `node-ipc`
   2026-05-14 reload, where a dormant maintainer was compromised via a
   lapsed recovery-email domain — see `otherdocs/security-incidence.md`.)

The most recent exercise is recorded as a one-line bullet in
[`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) using the form
"`_<date>_ — disclosure exercise completed.`" plus a short summary
of findings. The audit script reads the
`<!-- last-exercise: YYYY-MM-DD -->` marker in `SECURITY-CONTACTS.md` and
refuses with a non-zero exit when the date is older than 180 days, so a
missed quarter fails CI loud instead of silently aging out.

### Typosquat + init-time C2 (shopsprint pattern)

Socket's 2026-05-19 disclosure of
[`github.com/shopsprint/decimal`](https://socket.dev/blog/popular-go-decimal-library-typosquat-dns-backdoor)
is a Go-ecosystem incident, but the attack pattern is ecosystem-agnostic and
maps cleanly onto npm. We list it here because operators occasionally ask
which of our controls would actually have blocked it. The pattern has four
moving parts:

1. **Typosquat name** one character off the canonical package (`shopsprint`
   vs. `shopspring`), uploaded years before being weaponized.
2. **Trust-then-poison** release cadence — six years of benign mirror
   releases, then a malicious release seven minutes after a legitimate-looking
   bug-fix release on the same day.
3. **Init-time C2** — package init runs a background loop that polls a DNS
   TXT record on a free DDNS provider and executes any value as a command.
   No shell, no HTTP, no filesystem persistence.
4. **Registry-proxy persistence** — source repository and owner account
   deleted, but the module proxy continues serving the malicious tarball
   indefinitely from cache.

The npm-equivalent attack is a typosquat of a popular package that ships a
malicious `postinstall` (or an import-time side effect) and persists in the
npm registry tarball cache after the source repo is taken down. The
following Daloy controls are designed against exactly this pattern:

| Attack step | DaloyJS / template control |
| --- | --- |
| Typosquat replaces canonical dep in `package.json` | Lockfile is committed and CI runs `pnpm install --frozen-lockfile`; any unexplained dep change shows up in PR review. We also publish a stable scope (`@daloyjs/*`) so consumers can grep for the scope rather than trust unscoped autocomplete. |
| Trust-then-poison: malicious version published moments before install | `minimumReleaseAge: 1440` (24 h cooldown) in both the framework workspace ([`pnpm-workspace.yaml`](pnpm-workspace.yaml)) and every scaffolded project template ([`packages/create-daloy/templates/*/pnpm-workspace.yaml`](packages/create-daloy/templates)). Worm campaigns and trojan releases are typically detected and unpublished inside that window. |
| Init-time / postinstall payload runs on `pnpm install` | `ignore-scripts=true` in [`.npmrc`](.npmrc) (framework) and the template `_npmrc` (user apps) suppresses every lifecycle script. The pnpm 11 `strictDepBuilds: true` workspace key (framework only — deferred from templates because of transitive `esbuild`) hard-refuses installs of any package that needs a build. Packages permitted to build are listed explicitly in `pnpm.onlyBuiltDependencies` (`esbuild` only). |
| Import-time side effect runs the first time the app `import`s the dep | `@daloyjs/core` ships with **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) and the governance floor above), so importing `@daloyjs/core` cannot pull in a transitively trojanized package at all. User-installed deps still need handler-level review, but the framework adds zero new import-time attack surface. |
| Compromised release pulled from a non-registry source | `blockExoticSubdeps: true` (transitive deps refused unless they come from the configured registry) plus [`pnpm verify:lockfile`](scripts/verify-lockfile-sources.ts) (CI gate that rejects `git+`, `github:`, `ssh:`, and any tarball URL outside `registry.npmjs.org`). |
| Source repo deleted, but malicious tarball still served from registry cache | Provenance attestation on every `@daloyjs/core` and `create-daloy` tarball (`--provenance` + Sigstore via OIDC, see § npm publishing) — consumers can verify the published bytes against the source commit and reject any release whose attestation cannot be re-derived from the GitHub source. |
| Operator pivots through any binary the dev or CI runs | Maintainer accounts require hardware-backed 2FA; the publish workflow uses no long-lived `NPM_TOKEN`, runs in a protected environment, and blocks egress to everything except npm, GitHub, and Sigstore via `step-security/harden-runner` (see § CI/CD). A compromised dev laptop cannot push a release on its own. |

What this **does not** defend against, and we say so explicitly:

- A user copying a typosquatted dep name into their own `package.json` by
  hand. No package manager can catch a human typo at the point of authoring.
  Mitigations are review, dependabot, and `pnpm why <name>` before merge.
- A second-stage payload that the operator pre-stages via a different vector
  and triggers later. The 24 h cooldown shortens the window but does not
  eliminate it.
- Compromise of the npm registry itself. Provenance attestations make this
  detectable after the fact; preventing it is npm's responsibility.

If a future incident report describes an attack step that any control in
the table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Cross-platform postinstall binary drop (axios 2026 compromise pattern)

Snyk's 2026 disclosure of the
[axios npm package compromise](https://snyk.io/blog/axios-npm-package-compromised-supply-chain-attack-delivers-cross-platform/)
(see also Microsoft's
[mitigation guidance](https://www.microsoft.com/en-us/security/blog/2026/04/01/mitigating-the-axios-npm-supply-chain-compromise/)
and Arctic Wolf's
[writeup](https://arcticwolf.com/resources/blog/supply-chain-attack-impacts-widely-used-axios-npm-package/))
is listed here because `axios` is one of the most-installed packages on
npm and the compromise touched a maintainer-account takeover, a
`postinstall` lifecycle script, and a cross-platform native payload — a
combination several earlier entries only partially cover. We map each
step explicitly so reviewers don't have to re-derive which Daloy control
catches it.

| Attack step | DaloyJS / template control |
| --- | --- |
| Maintainer account takeover (phishing / lapsed recovery email) used to publish trojaned `axios` versions | Upstream of any package-manager control. Our equivalent surface is every handle in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) § Active: hardware-backed 2FA is mandatory at both the npm registry and the GitHub organization level (see § Maintainer accounts), the quarterly disclosure exercise re-verifies that each active contact's GitHub and npm recovery-email addresses still resolve to a domain the contact personally owns, and a lapsed-domain finding blocks the next publish. No long-lived `NPM_TOKEN` exists for an attacker to abuse; publishes use OIDC + Sigstore from `release.yml` only. |
| Trojaned version published moments before a downstream `pnpm install` | `minimum-release-age=1440` (24 h cooldown) in root [`.npmrc`](.npmrc) and every scaffolded template [`_npmrc`](packages/create-daloy/templates/node-basic/_npmrc) blocks install of a freshly published trojan version inside the typical detect-and-unpublish window. Every malicious `axios` release in this campaign was removed inside that window. |
| `postinstall` script (e.g. `prepare_node.js`) drops and executes a cross-platform Go binary that harvests npm/CI tokens, env vars, and wallets | `ignore-scripts=true` in root [`.npmrc`](.npmrc) and every template `_npmrc` suppresses *every* lifecycle hook (`preinstall` / `install` / `postinstall` / `prepare`). The allowlist for packages that legitimately need to build is `pnpm.onlyBuiltDependencies` in [`package.json`](package.json) (`esbuild` only on the framework; nothing on `@daloyjs/core` itself). The [`scripts/verify-no-lifecycle-scripts.ts`](scripts/verify-no-lifecycle-scripts.ts) governance gate (`pnpm verify:no-lifecycle-scripts`) refuses any PR that adds an install-time hook to a published manifest, so a future maintainer cannot quietly weaken this either. |
| `axios` pulled in transitively by an unrelated dependency, executing its `postinstall` on a consumer install of `@daloyjs/core` | `@daloyjs/core` ships **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) and the governance floor). Installing `@daloyjs/core` cannot pull in `axios` — or any other package — transitively. The framework's own HTTP/client code uses the platform `fetch` and Node `http`, never `axios`. |
| Trojaned binary phones home from the publish runner to attacker C2 | `step-security/harden-runner` on the publish workflow (see § CI/CD) blocks egress to anything outside the npm registry, GitHub, and the Sigstore endpoints needed for provenance. Even if a transitive dev-dep on the publish runner were trojaned in a future incident, the runner cannot reach attacker infrastructure. The same workflow runs in the protected `npm-publish` GitHub Environment with `persist-credentials: false`, so a stolen workflow token would expire before the next job step. |
| Consumer reinstalls and reintroduces the trojan after cleanup because the lockfile still pins the bad version | Scaffolded projects ship the same posture as the framework: `minimumReleaseAge: 1440` in [`packages/create-daloy/templates/*/pnpm-workspace.yaml`](packages/create-daloy/templates), `ignore-scripts=true` in each template `_npmrc`, and a lockfile that is committed and CI-checked with `pnpm install --frozen-lockfile`. Consumers can pin off a known-good version and rely on `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) to reject any non-`registry.npmjs.org` tarball substitution. |

What this **does not** defend against, and we say so explicitly:

- A *consumer* application that depends on `axios` (directly or
  transitively) and disables the template defaults — e.g. removes
  `ignore-scripts=true` from its `.npmrc` or sets
  `--minimum-release-age=0`. Daloy ships safe defaults in every
  scaffolded template; we cannot police downstream projects that opt
  out of them.
- A future axios-style compromise that publishes a trojan version,
  remains undetected for **longer** than 24 h, and ships an
  import-time (not install-time) payload. `ignore-scripts=true` would
  not help against a pure `import`-time payload (see the `node-ipc`
  2026-05-14 table above); `minimum-release-age=1440` is what shortens
  that window, and the zero-runtime-deps posture is what keeps
  `@daloyjs/core` from carrying such a package at all.
- Compromise of the npm registry itself. Provenance attestations make
  it detectable after the fact; preventing it is npm's responsibility.

If a future incident report describes an attack step that any control in
the table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Import-time CJS payload + dormant-maintainer takeover (node-ipc 2026-05-14 reload)

Socket's 2026-05-14 disclosure of the
[`node-ipc` reload](https://socket.dev/blog/node-ipc-package-compromised)
(malicious versions `9.1.6`, `9.2.3`, `12.0.1`) is listed here because it
combines two attack characteristics that earlier entries did not. We map
them explicitly so reviewers don't have to re-derive which Daloy control
catches each step.

| Attack step | DaloyJS / template control |
| --- | --- |
| Malicious code appended as an IIFE to a **CJS** entrypoint (`node-ipc.cjs`) and executed at `require()` time — *not* via `postinstall`, `preinstall`, or `prepare` | `ignore-scripts=true` would **not** have helped here; `minimum-release-age=1440` (root `.npmrc` + every template `_npmrc`) is what blocks install of a freshly published trojan version inside the typical detect-and-unpublish window. All three malicious `node-ipc` versions were removed inside that window. |
| Transitive load of the poisoned CJS bundle through a seemingly unrelated dependency | `@daloyjs/core` ships **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) and the governance floor). Importing `@daloyjs/core` cannot pull in a transitive package at all, poisoned or otherwise. |
| Downstream consumer's `require()` chain re-entering a CJS variant of the framework | `@daloyjs/core` is **ESM-only** — `"type": "module"` in `package.json` and every entry in the `exports` field exposes only an `import` condition, no `require` condition. There is no CJS bundle of the framework that an attacker could append an IIFE to even if a future compromise tried. |
| Access vector: **dormant maintainer account** whose npm recovery-email domain had **lapsed and been re-registered** by the attacker, allowing a standard password reset to capture publish rights | This is upstream of any package-manager control — npm will honor a legitimate password reset to whatever address is on file. Our equivalent surface is every handle in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) § Active. The quarterly disclosure exercise now explicitly verifies that each active contact's GitHub and npm recovery-email addresses still resolve to a domain the contact personally owns (or to a custodial provider the contact still has an active account with). A lapsed-domain finding blocks the next publish. |
| DNS-TXT exfiltration via a lookalike bootstrap resolver (`sh[.]azurestaticprovider[.]net`) during a CI/release run | `step-security/harden-runner` on the publish workflow blocks egress to anything outside the npm registry, GitHub, and the Sigstore endpoints. The framework cannot block runtime DNS exfiltration inside *consumer* applications — that is the operator's network-policy responsibility. |

What this **does not** defend against, and we say so explicitly:

- A consumer who chooses to `require()` a malicious CommonJS package in
  their own code. Daloy can keep itself ESM-only and dependency-free; it
  cannot police what the application loads.
- An attacker who compromises the recovery email of a Daloy maintainer
  *between* quarterly exercises. The exercise shortens the window; it
  does not eliminate it. Hardware-backed 2FA on the maintainer's GitHub
  and npm accounts remains the primary guard, and the
  `npm-publish` GitHub Environment still requires explicit approval
  from a second listed contact.

If a future incident report describes an attack step that any control in
either table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### IDE-extension compromise on a maintainer workstation (GitHub 2026-05-20 pattern)

Aikido and BleepingComputer's 2026-05-20 disclosure of the
[GitHub-internal-repos breach via a poisoned VS Code extension](https://www.aikido.dev/blog/github-breached-vs-code-extension)
(~3,800 internal repositories exfiltrated after a GitHub employee installed
a malicious extension from the official marketplace) is a different
ecosystem from npm and most of the controls in the two tables above do
**not** apply to it directly — the malicious code never enters
`pnpm-lock.yaml`, never executes a `postinstall` script, and never has to
defeat `minimum-release-age`. It runs in the developer's editor process
with whatever filesystem and network access that editor has. We list it
here because operators have asked, and because being honest about the
boundary matters more than pretending we have a control we do not have.

**What a backend framework cannot do.** Daloy cannot stop a maintainer or
a consumer from installing a poisoned VS Code, Cursor, JetBrains, or
Zed extension. That is a workstation-hygiene problem (signed extensions,
publisher verification, extension allowlists, EDR) and is owned by the
developer's operating environment, not by `@daloyjs/core`.

**What Daloy does do**, mapped step-by-step against the GitHub incident:

| Attack step | DaloyJS / template control |
| --- | --- |
| Malicious extension reads source files in the open workspace | Out of scope for a framework. We do not commit secrets to the repo (no `.env`, no long-lived tokens in `.github/`), and every scaffolded template's [`_gitignore`](packages/create-daloy/templates/node-basic/_gitignore) excludes `.env`, `.env.*` (with a `!.env.example` allowlist), `dist/`, and `coverage/` so an attacker reading the workspace gets configuration shape, not credentials. |
| Malicious extension reads tokens from the OS keychain, shell history, or `~/.npmrc` | Out of scope for a framework. Our mitigation is that **no maintainer holds a long-lived `NPM_TOKEN`** — publishes happen through OIDC + Sigstore from `release.yml`, not from any dev machine (see § npm publishing). A scraped `~/.npmrc` from a Daloy maintainer's laptop yields no publish credential for `@daloyjs/*`. |
| Malicious extension exfiltrates the contents of a private repository | Out of scope for a framework. For `@daloyjs/daloy` itself, the public repository is the source of truth and there is nothing private to exfiltrate. For *consumer* applications, secret-scanning (GitHub Advanced Security, `gitleaks`, etc.) and short-lived cloud credentials are the operator's responsibility — we recommend both in the threat-model section above. |
| Malicious extension silently mutates `package.json` / `pnpm-lock.yaml` to introduce a typosquatted dep | Caught at PR review: `package.json` and `pnpm-lock.yaml` are CODEOWNERS-protected ([`.github/CODEOWNERS`](.github/CODEOWNERS)), CI runs `pnpm install --frozen-lockfile`, and `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) rejects any `git+`, `github:`, `ssh:`, or non-`registry.npmjs.org` source. `minimumReleaseAge: 1440` then blocks install of a freshly published trojan dep even if one slipped past review. |
| Malicious extension stages a commit to `.github/workflows/*` to weaken CI (e.g. drop `harden-runner`, add `pull_request_target`, unpin an action) | Caught at PR review: `.github/` is CODEOWNERS-protected, `zizmor` statically rejects unsafe workflow patterns ([`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)), and `pnpm verify:wave10-audits` ([`scripts/verify-wave10-audits.ts`](scripts/verify-wave10-audits.ts)) refuses the PR if the top-level `permissions:` block, `persist-credentials: false`, the SHA-pin on a third-party action, or `step-security/harden-runner` is removed. |
| Malicious extension steals a maintainer's GitHub PAT and uses it to push directly to `main` or to publish a release | Branch protection on `main` requires PR review (CODEOWNERS-enforced for sensitive paths). The publish job (`release.yml`) is triggered only by a signed `v*` tag plus explicit maintainer dispatch for `create-daloy`, runs only in the `npm-publish` protected GitHub Environment, and requires a second listed maintainer to approve the environment before any `pnpm publish` runs. A stolen single-account PAT does not produce a release on its own. |
| Malicious extension installs an auto-update hook that re-poisons after cleanup | Outside our boundary. The standard recovery is to uninstall the extension, rotate maintainer credentials (npm, GitHub, recovery email — same drill as the `node-ipc` 2026-05-14 reload), and run the quarterly disclosure exercise out of cycle. |

**What this does not defend against, and we say so explicitly:**

- A maintainer installing a poisoned extension and then approving their
  own subsequent malicious PR. CODEOWNERS requires a reviewer; branch
  protection enforces it. The `npm-publish` environment requires a
  second approver. None of these survive *two* compromised maintainer
  accounts — that is the threat model that hardware-backed 2FA on every
  active maintainer and the off-boarding checklist exist to make
  expensive.
- A consumer of `@daloyjs/core` who installs a poisoned VS Code
  extension in their own application repo. The blast radius there is
  whatever that extension can reach in the consumer's workspace, which
  is unrelated to Daloy. Our recommended posture for consumers mirrors
  ours: `.env*` in `.gitignore` (already shipped in every template
  `_gitignore`), no long-lived cloud credentials on disk, branch
  protection on the deploy branch, and OIDC-based publishing /
  deployment instead of static tokens.

If a future incident report describes an attack step that any control in
the table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Malicious AI-agent skills on a maintainer or consumer workstation (ToxicSkills / ClawHub 2026 pattern)

Snyk's 2026 ["ToxicSkills" research](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)
(plus the parallel "ClawHavoc" / `clawdhub` malicious-campaign disclosures
and Mobb.ai's audit of 22,511 public skills) documents prompt-injection
payloads in **~36%** of audited skills and **1,467 confirmed malicious
payloads** across the ClawHub, OpenClaw, and Claude Code skill registries.
The attack shape is: an AI coding agent (Claude Code, Cursor, OpenClaw,
etc.) loads a "skill" — a markdown / YAML / shell bundle — from a public
registry, and that skill either prompt-injects the agent into
exfiltrating files and tokens or directly executes attacker-controlled
shell commands with the developer's local privileges. The malicious code
never enters `package.json` or `pnpm-lock.yaml`, so none of the
npm-focused controls in the `node-ipc` / `shopsprint` / `axios` / `@antv` tables
above apply directly. We list it here for the same reason we list the
GitHub VS Code-extension breach above: operators ask, and the honest
answer is that some of this is outside a backend framework's boundary.

**What a backend framework cannot do.** Daloy cannot stop a maintainer or
a consumer from installing a poisoned skill into Claude Code, Cursor,
OpenClaw, Continue, Aider, Windsurf, Zed, or any other agent runtime.
Those runtimes execute skills with whatever filesystem, network, and
credential access the developer's shell has, which is far more than any
HTTP framework can mediate. Skill-registry hygiene (signed publishers,
allowlists, isolation, sandboxing) is owned by the agent runtime and the
developer's operating environment.

**What Daloy does do**, mapped step-by-step against the ToxicSkills pattern:

| Attack step | DaloyJS / template control |
| --- | --- |
| Poisoned skill prompt-injects the agent into reading `.env`, `~/.npmrc`, the macOS / Linux keychain, or shell history | Out of scope for a framework. Mitigation in our own repo: no `.env` is committed, no long-lived `NPM_TOKEN` exists on any maintainer machine (publish runs from `release.yml` via OIDC, see § npm publishing), and every scaffolded template's [`_gitignore`](packages/create-daloy/templates/node-basic/_gitignore) excludes `.env`, `.env.*` (with a `!.env.example` allowlist), `dist/`, `coverage/`, and `*.log` so a skill reading the workspace gets configuration shape, not credentials. |
| Poisoned skill executes a shell command (`curl … \| sh`, `npm publish`, `git push`) under the developer's identity | Outside our boundary at runtime. The release-side blast radius is bounded because **no publish happens from a developer machine** — `release.yml` is the only path to `npm publish` for `@daloyjs/core` / `create-daloy`, it requires a signed `v*` tag, it runs only in the protected `npm-publish` GitHub Environment, and that environment requires a second listed maintainer to approve before any publish job executes. A skill that ran `npm publish` on a maintainer laptop would fail for lack of a publish-capable token. |
| Poisoned skill silently edits `package.json`, `pnpm-lock.yaml`, `.npmrc`, or a workflow under `.github/` to weaken CI or introduce a typosquatted dep | Caught at PR review. Those paths are CODEOWNERS-protected ([`.github/CODEOWNERS`](.github/CODEOWNERS)); CI runs `pnpm install --frozen-lockfile`; `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) rejects `git+`, `github:`, `ssh:`, and non-`registry.npmjs.org` sources; `pnpm verify:wave10-audits` ([`scripts/verify-wave10-audits.ts`](scripts/verify-wave10-audits.ts)) refuses removal of `permissions:`, `persist-credentials: false`, action SHA-pins, or `step-security/harden-runner`; `zizmor` statically rejects unsafe workflow patterns ([`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)). Even with a fully compromised agent on a maintainer laptop, the malicious change has to clear a human review under those gates. |
| Poisoned skill stages a backdoor inside `src/` (e.g. weakens a header sanitizer, removes a rate-limit guard, downgrades a JWT algorithm allowlist) | Caught at PR review plus the static governance gates: `pnpm verify:wave9-audits`, `pnpm verify:wave10-audits`, `pnpm verify:wave11-audits`, `pnpm verify:wave12-audits`, and `pnpm verify:secret-comparisons` enforce the documented security floor. CodeQL and the test suite (with the 90% line / 90% function / 90% branch coverage gates) run on every PR. A backdoor that bypasses all of those would have to be subtle enough to pass code review on `src/security.ts`, `src/hashing.ts`, `src/jwt.ts`, etc. — review is the last line of defense and there is no shortcut around it. |
| Poisoned skill exfiltrates the contents of the open workspace over HTTP / DNS / a third-party MCP server | Out of scope for a framework. For `@daloyjs/daloy` itself the workspace is the public repository and there is nothing private to exfiltrate. For consumer applications, secret-scanning (GitHub Advanced Security, `gitleaks`, etc.), short-lived cloud credentials, and developer-workstation egress controls are the operator's responsibility — the same posture we recommend against the GitHub VS Code-extension breach above. |
| Skill vendors a malicious npm dep transitively (skill says "install X" and X is a typosquat) | If the agent obeys and runs `pnpm add`, every other control in this document applies: `ignore-scripts=true` blocks lifecycle payloads, `minimumReleaseAge: 1440` blocks fresh trojan releases, `blockExoticSubdeps: true` plus `pnpm verify:lockfile` reject non-registry sources, `@daloyjs/core`'s zero-runtime-dep posture means *we* never pull the typosquat in, and the CODEOWNERS-guarded lockfile means the change has to clear PR review. |
| Skill registry is taken down but the cached malicious skill remains pinned in a dev's local agent cache | Outside our boundary. Agent runtimes own their skill cache. Recovery is the same drill as the `node-ipc` 2026-05-14 reload and the VS Code-extension breach: uninstall the skill, rotate the affected maintainer's npm and GitHub credentials and recovery email (the quarterly disclosure exercise verifies all three), and run the disclosure exercise out of cycle. |

**Daloy-repo policy on agent skills (workstation hygiene).** Because the
framework cannot police skill registries, we constrain what enters *this*
repository:

- The repository does not vendor, recommend, or pre-install any
  third-party AI-agent skill, Claude Code skill, Cursor rule pack,
  OpenClaw skill, or equivalent. The only agent-facing files in this
  repo are first-party and reviewed under the normal CODEOWNERS path:
  [`AGENTS.md`](AGENTS.md), [`.github/copilot-instructions.md`](.github/copilot-instructions.md),
  and the per-area `AGENTS.md` files (e.g. [`website/AGENTS.md`](website/AGENTS.md)).
- No template under [`packages/create-daloy/templates/`](packages/create-daloy/templates)
  ships a third-party skill bundle, agent ruleset, or MCP-server config
  pointing at a public skill registry. Scaffolded apps therefore inherit
  zero pre-installed skill surface from us.
- A PR that adds a third-party skill, rule pack, or agent-cache
  directory (`.claude/skills/`, `.cursor/rules/`, `.openclaw/`,
  `.continue/`, `.aider/`, `.windsurf/`, `.zed/ai/`, or any similar
  per-tool directory containing executable instructions sourced from
  outside this repo) must be treated as a supply-chain change: it
  requires the same maintainer review and justification as a new
  runtime dependency, and must come from a publisher and version the
  reviewer can verify by hand. "I downloaded this from ClawHub /
  OpenClaw / the Cursor directory and it looked useful" is **not**
  sufficient justification.
- Maintainers who use an AI agent against this repo are expected to run
  it under the agent's least-privilege mode (deny shell exec by
  default, allowlist tools explicitly) and to review every diff before
  committing. The CODEOWNERS, branch-protection, and
  `npm-publish`-environment controls described above assume diffs are
  human-reviewed; an agent that auto-approves its own PRs would defeat
  that assumption.

**What this does not defend against, and we say so explicitly:**

- A maintainer installing a poisoned skill in their personal Claude
  Code / Cursor / OpenClaw setup and then merging the skill's
  suggestions without reading them. CODEOWNERS requires a reviewer for
  sensitive paths and the `npm-publish` Environment requires a second
  approver, so a single compromised maintainer cannot ship a poisoned
  release on their own — but two compromised maintainers can, which is
  why hardware-backed 2FA on every active maintainer and the off-boarding
  checklist exist to make that expensive.
- A consumer of `@daloyjs/core` who installs a poisoned skill in their
  own application repo. The blast radius is whatever that skill can
  reach in the consumer's workspace, which is unrelated to Daloy. Our
  recommended posture for consumers mirrors ours: do not vendor
  third-party skills, keep `.env*` in `.gitignore` (already shipped in
  every template `_gitignore`), no long-lived cloud credentials on
  disk, branch protection on the deploy branch, and OIDC-based
  publishing / deployment instead of static tokens.
- Prompt-injection content hosted in *data* the framework processes
  (request bodies, third-party API responses). That is application-level
  input validation owned by the handler author; Daloy does not auto-feed
  request data to an LLM.

If a future incident report describes an attack step that any control in
the table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Cross-Site WebSocket Hijacking on a dev/admin server (Storybook CVE-2026-27148 pattern)

Aikido's 2026 disclosure of the
[Storybook WebSocket hijack](https://www.aikido.dev/blog/storybooks-websockets-attack)
([CVE-2026-27148](https://app.opencve.io/cve/CVE-2026-27148)) is the
representative case for a class of bug that ships in many runtime
frameworks: the WebSocket upgrade endpoint authenticates the user with
cookies but does **not** validate the `Origin` header. A browser
*always* attaches cookies to a WS handshake regardless of which page
triggered it, so a victim visiting `evil.example` while their local
Storybook (or any cookie-authenticated WS server) is running silently
hands the attacker a fully authenticated control channel — Storybook's
specific impact was overwriting story files on disk and reaching RCE on
the developer's workstation.

| Attack step | DaloyJS / template control |
| --- | --- |
| Malicious page calls `new WebSocket("ws://victim-host/...")`; the browser opens the handshake with the victim's cookies attached | `app.ws()` in production with `secureDefaults` refuses-at-registration unless the route declares an `allowedOrigins` policy (`"same-origin"`, a string allowlist, or a predicate) or explicitly opts out via `acknowledgeCrossOriginUpgrade: true`. The CSWSH gate is an *additional* check on top of the existing `beforeUpgrade` / `acknowledgeUnauthenticated` gate — cookie auth alone is no longer a sufficient acknowledgement, because cookie auth is exactly what CSWSH abuses. |
| The server's `beforeUpgrade` hook reads the cookie, finds a valid session, and accepts the handshake | `checkWebSocketOrigin()` runs **before** `beforeUpgrade` in both the Node and Bun adapters. A cross-origin handshake is rejected with `403` and `beforeUpgrade` is never invoked, so an authenticated handler cannot accidentally bless the attacker's connection. |
| The attacker sends authenticated WS messages (modify state, exfiltrate data, write files, achieve RCE through a "write story to disk" RPC like Storybook's) | The CSWSH guard refuses the handshake before any message is received. A non-browser client (CLI, server-to-server) that does not send `Origin` still passes the `same-origin` and array-allowlist policies; callers that want to require an `Origin` for every client may pass a predicate (`(origin) => origin !== null && allowed.has(origin)`). |
| The attacker uses a `null` origin (sandboxed iframe, file://, some browser extensions) to evade a naive `Origin` check | Daloy's policies compare against the exact `Origin` string the server received, so `"null"` is treated as just another origin — `"same-origin"` and a typical string allowlist both reject it. The predicate form gives the operator the final say. |

What this **does not** defend against, and we say so explicitly:

- A route that opts in via `acknowledgeCrossOriginUpgrade: true` and
  then exposes a state-changing protocol over WS. The acknowledgement
  flag is exactly the place where the operator owns the decision; if
  the route is truly cross-origin (a public broadcast feed, a
  no-cookie WS used only with bearer tokens out of the URL), CSWSH is
  not reachable and the flag is correct. If the route is
  cookie-authenticated, the flag is wrong and the refuse-at-startup
  message names the route so review can catch it.
- A custom WS adapter that bypasses `app.webSocketRoutes` and calls
  the adapter's raw upgrade primitive directly. The CSWSH check is
  wired into the Node and Bun adapters; bespoke adapters are
  responsible for calling `checkWebSocketOrigin()` themselves before
  invoking `beforeUpgrade`.

If a future incident report describes an attack step that any control in
the table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Slopsquatting / AI package hallucination (Aikido 2025 pattern)

Aikido's ["Slopsquatting: When AIs hallucinate packages" research](https://www.aikido.dev/blog/slopsquatting-ai-package-hallucination-attacks)
(and the original [Lasso / "Package Hallucination"](https://arxiv.org/abs/2406.10279)
study before it) documents a supply-chain attack shape that is adjacent
to classical typosquatting but driven by AI coding assistants: the LLM
**hallucinates a package name that does not exist** (`request-promise-native2`,
`pyjson-utils`, `@types/fastify-helmet`, etc.) and confidently emits
`pnpm add <hallucination>`. An attacker who has been watching public LLM
output simply registers that name on npm with a malicious payload, and
the next developer / agent that copies the suggestion installs the
trojan. The hallucinated name often *sounds* plausible, so it survives
visual review in a way a classical typo (`expresss`, `lodahs`) does not.

This is the same attack surface as the "Skill vendors a malicious npm
dep transitively" row in the ToxicSkills table above — but it also
applies when no skill is involved, just a base-model LLM the developer
trusts. We list it explicitly because operators ask, and because as of
2025 the share of `pnpm add` invocations originating from an AI agent
inside a coding IDE is non-trivial.

**Daloy's mitigations, mapped step by step against slopsquatting:**

| Attack step | DaloyJS / template control |
| --- | --- |
| LLM emits `pnpm add <hallucinated-name>` and the developer / agent runs it without verifying the package exists | Outside any framework's boundary. We document the recommended posture in [`AGENTS.md`](AGENTS.md) ("review every diff before committing", least-privilege agent mode) and in the malicious-skills section above. The framework's job is to make sure that *if* the bad install happens, the blast radius is bounded by the controls below. |
| Attacker pre-registered the hallucinated name on npm and pushed a fresh malicious version inside the last 24 hours | `minimum-release-age=1440` in this repo's [`.npmrc`](.npmrc) **and** in every scaffolded template's `_npmrc` ([`packages/create-daloy/templates/node-basic/_npmrc`](packages/create-daloy/templates/node-basic/_npmrc), `bun-basic`, `cloudflare-worker`, `vercel-edge`, etc.) refuses to resolve any version published less than 24 hours ago. Slopsquat packages are typically detected and unpublished or de-listed inside that window — the same property that defended us against the `node-ipc` 2026-05-14 reload. |
| Malicious package ships a `postinstall` / `preinstall` / `prepare` hook that exfiltrates `~/.npmrc`, `.env`, SSH keys, or the keychain on `pnpm install` | `ignore-scripts=true` in this repo's [`.npmrc`](.npmrc) and every template's `_npmrc` suppresses every lifecycle script. Packages permitted to build are listed explicitly in `pnpm.onlyBuiltDependencies` and `pnpm-workspace.yaml#onlyBuiltDependencies` (currently only `esbuild` in the framework; templates ship an empty allowlist). pnpm 11's `strictDepBuilds: true` (framework only — see § Supply chain) hard-refuses any newly added dep that *needs* to build. |
| Malicious package declares the trojan source via `git+ssh://` / `github:owner/repo#<sha>` / a non-`registry.npmjs.org` tarball URL to bypass registry-side scanning | `blockExoticSubdeps: true` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) and every template's `pnpm-workspace.yaml` refuses to install exotic sub-deps in the first place. `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) is wired into [`ci.yml`](.github/workflows/ci.yml) and the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml); it rejects `git+`, `github:`, `ssh:`, `http:` URLs and any tarball whose origin is not the official npm registry. |
| Hallucinated dep transitively lands inside `@daloyjs/core`'s published tarball, infecting every consumer | `@daloyjs/core` has **zero runtime dependencies** (only `zod` as a peer). [`scripts/verify-no-runtime-deps.ts`](scripts/verify-no-runtime-deps.ts) runs as `pnpm verify:no-runtime-deps` in CI and in the pre-publish `verify` job and fails the build if any `dependencies` entry is added to the published manifest. Even a slopsquat that lands in `pnpm-lock.yaml` as a dev-only dep cannot leak into the tarball we ship. |
| Hallucinated dep lands in `pnpm-lock.yaml` via a PR (agent-authored or otherwise) | [`pnpm-lock.yaml`](pnpm-lock.yaml) is CODEOWNERS-protected ([`.github/CODEOWNERS`](.github/CODEOWNERS)); CI runs `pnpm install --frozen-lockfile`; `pnpm audit --prod` and `pnpm verify:lockfile` reject unsigned / non-registry sources; maintainer review is the last line of defence. A PR that adds a package name no reviewer recognises is the failure mode `AGENTS.md` warns about and reviewers are instructed to push back on. |
| Slopsquat ships a typo of an *internal* Daloy export (`@daloyjs/cor`, `@daloyjs/core-utils`) to look like a sibling package | The `@daloyjs` npm scope is owned by the maintainer team and protected by hardware-backed 2FA; no third party can publish under it. Scaffolded templates only ever reference `@daloyjs/core` and `create-daloy`, both pinned by `create-daloy` to the matching release. There is no `@daloyjs/*` sub-package surface for a slopsquatter to plausibly imitate. |

**What this does not defend against, and we say so explicitly:**

- A developer who runs `pnpm add <hallucinated-name> --ignore-scripts=false` or otherwise overrides our defaults. The defaults are advisory at the consumer side; if a project disables them, the controls listed above do not apply.
- A slopsquat that survives the 24-hour `minimum-release-age` window because nobody reported it. This is the same residual risk as classical typosquatting; defence-in-depth is `ignore-scripts=true` + `blockExoticSubdeps: true` + maintainer review of every new dep name.
- A slopsquat installed *globally* (`pnpm add -g`) outside any project's `.npmrc`. Global installs do not inherit the project's cooldown; we recommend against `-g` for security-sensitive tooling and have none in our own developer setup.

If you encounter a slopsquatted package referencing `@daloyjs/*` (e.g. `daloyjs`, `daloy-core`, `@daloyjs/cli`, `create-daloyjs`), report it via the npm abuse form *and* file a private advisory at <https://github.com/daloyjs/daloy/security/advisories/new> so we can warn other operators.

If you suspect a compromised version of `@daloyjs/core` or `create-daloy`:

- Compare the published tarball's provenance attestation against the source
  commit at <https://www.npmjs.com/package/@daloyjs/core>.
- Look in the published manifest for unexpected `optionalDependencies`,
  `peerDependencies`, or `bin` entries — especially anything pointing to a
  fork (e.g. `github:owner/repo#<sha>`).
- Look in the unpacked tarball for files outside of `dist/` and `README.md`
  (the only paths in our `files` field).
- Report to <https://github.com/daloyjs/daloy/security/advisories/new>.
