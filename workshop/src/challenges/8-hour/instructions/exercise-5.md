# 8-Hour · Exercise 5: Bearer Auth + per-Route Auth

Real APIs have multiple authentication boundaries. This exercise wires two of them: a bearer-token admin surface and an API-key partner surface — each declared in OpenAPI, each enforced per route.

## Requirements

- Declare two `securitySchemes` in `openapi`:
  - `bearer: { type: "http", scheme: "bearer" }`
  - `apiKey: { type: "apiKey", in: "header", name: "X-API-Key" }`
- `POST /admin/books` requires bearer (use `bearerAuth({ validate })` with `timingSafeEqual`).
- `GET /partner/books` requires API key (write your own middleware reading `x-api-key`).
- 401 means "no credential supplied"; 403 means "credential supplied but invalid". Return them distinctly.

## Verify

```bash
# 401 — no token
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/admin/books
# 401

# 403 — wrong token
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/admin/books -H 'authorization: Bearer wrong'
# 403

# 201 — right token + body
curl -s -X POST http://localhost:3000/admin/books \
  -H 'authorization: Bearer admin-token' \
  -H 'content-type: application/json' \
  -d '{"id":"1","title":"Foundation"}' | jq

# 401 / 403 / 200 for /partner/books with X-API-Key
```

## Why This Matters

- **`timingSafeEqual`** is required for any equality check on a secret. A normal `===` comparison short-circuits at the first differing byte; an attacker can use the timing difference to leak the secret one byte at a time.
- **401 vs 403 distinction** is genuinely useful: load balancers and SDKs treat them differently. A 401 prompts a refresh-token flow; a 403 prompts a "ask your admin" UX.
- **`auth: { scheme }` + `hooks:`** both appear in OpenAPI _and_ enforce at runtime. If you only set `hooks`, OpenAPI consumers don't know auth is required. If you only set `auth`, runtime doesn't enforce. Set both.

## Training Resources

- [DaloyJS — Security](https://daloyjs.dev/docs/security)
- [DaloyJS — OpenAPI](https://daloyjs.dev/docs/openapi)
- [Node.js `timingSafeEqual`](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)
