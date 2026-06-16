# my-daloy-vercel-api

A [DaloyJS](https://daloyjs.dev) Vercel API starter on the Node.js runtime.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Try it:

```bash
curl http://localhost:3000/healthz
<!-- daloy-minimal:strip-start books -->
curl http://localhost:3000/books/1
<!-- daloy-minimal:strip-end books -->
```

<!-- daloy-minimal:strip-start docs -->

## API documentation

- API docs (Scalar): <http://localhost:3000/docs>
- OpenAPI 3.1 JSON: <http://localhost:3000/openapi.json>
- OpenAPI 3.1 YAML: <http://localhost:3000/openapi.yaml>

After deploying, the same routes serve `/docs`, `/openapi.json`, and `/openapi.yaml` from your Vercel deployment URL.
To brand Scalar, change `docs: true` in `api/[...path].ts` to `docs: { scalar: { theme, customCss } }`.

<!-- daloy-minimal:strip-end docs -->

## Deploy

```bash
pnpm deploy
```

The API entry lives at `api/[...path].ts` and uses `@daloyjs/core/vercel`:

```ts
import { toFetchHandler } from "@daloyjs/core/vercel";

// Node.js is the default runtime — no `runtime` export needed.
export default toFetchHandler(app);
```

This starter targets Vercel's Node.js runtime (on Fluid Compute), which Vercel
now recommends for standalone functions. Node.js Functions expect a default
export with a `fetch` method, which is exactly what `toFetchHandler(app)`
returns. If you specifically need the Edge runtime, add the `runtime` export and
switch to the bare web handler:

```ts
import { toWebHandler } from "@daloyjs/core/vercel";

export const runtime = "edge";
export default toWebHandler(app);
```

That catch-all API route lets DaloyJS own routing while Vercel handles the runtime.

## Imports

This project uses TypeScript with `"allowImportingTsExtensions"`. Relative imports use the `.ts` extension — the actual file on disk:

```ts
import handler from "../api/[...path].ts";
```

Vercel bundles the `api/` functions at deploy time and resolves `.ts` directly, and the test runner (tsx) does too.

## What's included

- `@daloyjs/core/vercel` with starter security middleware: `secureHeaders` and `requestId`.
- Smaller serverless-friendly body and timeout limits in the generated app.
<!-- daloy-minimal:strip-start books -->
- A health route and a contract-first `/books/:id` route with Zod validation.
  <!-- daloy-minimal:strip-end books -->
  <!-- daloy-minimal:strip-start docs -->
- A Scalar API reference UI at `/docs`, plus live OpenAPI 3.1 specs at `/openapi.json` and `/openapi.yaml`.
<!-- daloy-minimal:strip-end docs -->

## Authentication (OAuth2 / OpenID Connect)

This app is a **resource server**: DaloyJS verifies and enforces access tokens,
it does **not** issue them. There is no built-in login UI, user database, or
OAuth2 authorization server (it is not an identity provider like Keycloak,
Auth0, or Duende IdentityServer). To add login, bring an OpenID Connect provider
— managed (Auth0, Okta, Clerk, Microsoft Entra ID, AWS Cognito) or self-hosted
open source (Keycloak, Zitadel, Ory, Logto) — and verify its JWTs with the
first-party `jwk()`, `bearerAuth()`, and `requireScopes()` helpers. Don't build
your own authorization server.

See [Auth architecture](https://daloyjs.dev/docs/auth/architecture) for the
recommended designs (API resource server and browser BFF).
