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
5. The GitHub and npm account-recovery email address for every handle in
   the **Active** rotation still resolves to a domain the contact
   personally owns, or to a custodial provider where the contact still has
   an active account. (Added 2026-05-20 in response to the `node-ipc`
   2026-05-14 reload, where a dormant maintainer was compromised via a
   lapsed recovery-email domain — see `otherdocs/security-incidence.md`.)

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
| Transitive load of the poisoned CJS bundle through a seemingly unrelated dependency | `@daloyjs/core` ships **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) and the Wave 10 governance floor). Importing `@daloyjs/core` cannot pull in a transitive package at all, poisoned or otherwise. |
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
npm-focused controls in the `node-ipc` / `shopsprint` / `@antv` tables
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



If you suspect a compromised version of `@daloyjs/core` or `create-daloy`:

- Compare the published tarball's provenance attestation against the source
  commit at <https://www.npmjs.com/package/@daloyjs/core>.
- Look in the published manifest for unexpected `optionalDependencies`,
  `peerDependencies`, or `bin` entries — especially anything pointing to a
  fork (e.g. `github:owner/repo#<sha>`).
- Look in the unpacked tarball for files outside of `dist/` and `README.md`
  (the only paths in our `files` field).
- Report to <https://github.com/daloyjs/daloy/security/advisories/new>.
