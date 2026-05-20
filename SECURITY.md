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
operators can plan around them and contributors can pick them up:

- **First-party JWT verification** (`jwt()` middleware over `jose`) with mandatory
  algorithm allowlist (no `none`, no `alg` from header), JWKS support, and
  configurable `issuer`/`audience`/`clockTolerance`.
- **First-party WebAuthn / passkeys** via a thin wrapper over a vetted library.
- **SSRF guard** (`fetchGuard()`) blocking outbound `fetch` to RFC1918,
  loopback, link-local, and metadata-service IPs unless explicitly allowlisted.
- **Per-route capability-based body limits** derived from the route schema
  (override the global cap when the schema implies a tighter ceiling).
- **Under-pressure auto-shedding** in the Node adapter (event-loop lag, RSS,
  heap), returning `503` before the runtime hangs.
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
  before their last day. (Wave 8 item.)
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
   organization level and the npm registry level. (Wave 8 mandatory-2FA
   audit gate.)
6. Confirm the GitHub actor on the publish run is listed in the ACTIVE block
   of [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md). The Wave 10 release
   gate refuses to publish otherwise.

### Wave 10 governance floor (reaffirmed)

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
  posture, also reaffirmed by Wave 8 and Wave 9 item 19),
- removes the plugin-prerequisite refuse-to-boot path or the
  `topoSortExtensions` cycle-detection throw from `src/app.ts`, or
- removes `SECURITY-CONTACTS.md` or `.github/CODEOWNERS`.

### Recurring security-disclosure exercise (Wave 10)

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

The most recent exercise is recorded as a one-line bullet in
[`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) using the form
"`_<date>_ — Wave 10 disclosure exercise completed.`" plus a short summary
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
| Import-time side effect runs the first time the app `import`s the dep | `@daloyjs/core` ships with **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) and the Wave 10 governance floor above), so importing `@daloyjs/core` cannot pull in a transitively trojanized package at all. User-installed deps still need handler-level review, but the framework adds zero new import-time attack surface. |
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



If you suspect a compromised version of `@daloyjs/core` or `create-daloy`:

- Compare the published tarball's provenance attestation against the source
  commit at <https://www.npmjs.com/package/@daloyjs/core>.
- Look in the published manifest for unexpected `optionalDependencies`,
  `peerDependencies`, or `bin` entries — especially anything pointing to a
  fork (e.g. `github:owner/repo#<sha>`).
- Look in the unpacked tarball for files outside of `dist/` and `README.md`
  (the only paths in our `files` field).
- Report to <https://github.com/daloyjs/daloy/security/advisories/new>.
