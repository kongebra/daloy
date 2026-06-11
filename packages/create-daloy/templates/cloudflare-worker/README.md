# my-daloy-worker

A [DaloyJS](https://daloyjs.dev) Cloudflare Workers starter.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:8787
```

## Deploy

```bash
pnpm deploy
```

`@daloyjs/core/cloudflare` exposes `toFetchHandler(app)`, so the same `App` you would use on Node also runs on Workers.

## What's included

- `@daloyjs/core/cloudflare` with starter security middleware: `secureHeaders` and `requestId`.
- Smaller edge-friendly body and timeout limits in the generated app.
- `wrangler.toml` ready for local development and deploys.

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

Read the docs at <https://daloyjs.dev/docs>.
