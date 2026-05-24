# Exercise 4: Bearer Auth on a Route

Protect `POST /books` with bearer-token auth. The hard part is not the runtime check — it's wiring the auth into the OpenAPI spec so the typed client and the Scalar UI both know which routes need a token.

## Requirements

- Declare a `bearer` security scheme on `openapi.securitySchemes` in the App constructor.
- On `POST /books`:
  - Add `auth: { scheme: "bearer" }` to the route definition.
  - Add `hooks: bearerAuth({ validate: (token) => token === "demo-token" })`.
  - Document a 401 response.
- `GET /books/:id` stays unauthenticated.

## Verify

```bash
# Unauthenticated POST → 401
curl -s -i -X POST http://localhost:3000/books \
  -H 'content-type: application/json' \
  -d '{"id":"3","title":"Hyperion"}' | head -n 1
# HTTP/1.1 401 Unauthorized

# Authenticated POST → 201
curl -s -i -X POST http://localhost:3000/books \
  -H 'authorization: Bearer demo-token' \
  -H 'content-type: application/json' \
  -d '{"id":"3","title":"Hyperion"}' | head -n 1
# HTTP/1.1 201 Created

# Scalar UI shows the lock icon next to createBook
open http://localhost:3000/docs
```

## Discussion Prompt

The `validate` callback above does a plain `===` string compare. Why is that **always** the wrong shape for production, and what does DaloyJS give you to do it correctly?

(Hint: <https://daloyjs.dev/docs/security/secure-defaults#secret-comparison>.)

## Why This Matters

Three things have to line up for auth to actually protect anything:

1. **Runtime enforcement** — the `bearerAuth({ validate })` hook rejects bad tokens with a 401.
2. **OpenAPI declaration** — `auth: { scheme: "bearer" }` tells Hey API the typed client must send `Authorization: Bearer …`. Without it, the generated SDK is happy to make the call without a token, and you find out in prod.
3. **Docs honesty** — Scalar shows the lock icon and an `Authorize` button. Anyone exploring the docs immediately sees which routes need credentials.

DaloyJS keeps all three in sync from one place — the route definition.

## Training Resources

- [DaloyJS — Auth](https://daloyjs.dev/docs/auth)
- [DaloyJS — Secure defaults: secret comparison](https://daloyjs.dev/docs/security/secure-defaults)
- [DaloyJS — OpenAPI](https://daloyjs.dev/docs/openapi)
- [OpenAPI 3.1 — Security Schemes](https://spec.openapis.org/oas/v3.1.0#security-scheme-object)
