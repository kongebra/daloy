# 8-Hour · Exercise 2: Path Params, Query, Body, Headers

Every part of a request that you read in a handler should be a schema slot. This exercise wires all four — path, query, body, headers — and shows each one landing in OpenAPI with the right location.

## Requirements

- `GET /books` with:
  - `?limit=` (integer, 1–100, default 20) — coerced from a string at the wire level.
  - `?status=available|checked-out` (optional).
- `POST /books` with:
  - A `.strict()` body (`id`, `title`, `status` defaulting to `"available"`).
  - A required `idempotency-key` header (uuid).
  - Replay protection — second request with the same key returns 409.
- Confirm `/openapi.json` reports each parameter with the right `in: path|query|header|body`.

## Verify

```bash
curl -s 'http://localhost:3000/books?limit=1&status=available' | jq

curl -s -X POST http://localhost:3000/books \
  -H 'content-type: application/json' \
  -H 'idempotency-key: 11111111-1111-1111-1111-111111111111' \
  -d '{"id":"3","title":"Hyperion"}' | jq

# Replay → 409
curl -s -X POST http://localhost:3000/books \
  -H 'content-type: application/json' \
  -H 'idempotency-key: 11111111-1111-1111-1111-111111111111' \
  -d '{"id":"4","title":"Ringworld"}' | jq

curl -s http://localhost:3000/openapi.json | jq '.paths."/books".post.parameters'
```

## Why This Matters

Each slot has different semantics:

- **Path params** are part of the URL — required, non-optional, validated up front.
- **Query params** are caller-provided filters — coerce from string (`z.coerce.number()`), give them sensible defaults.
- **Headers** are transport metadata — case-insensitive on the wire, validated as lower-cased keys.
- **Body** is the payload — `.strict()` it, always.

Mixing them up (e.g. reading `idempotency-key` from the body) is how APIs become hard to consume and hard to cache.

## Training Resources

- [DaloyJS — Validation](https://daloyjs.dev/docs/validation)
- [DaloyJS — Routing](https://daloyjs.dev/docs/routing)
- [OpenAPI 3.1 — Parameter Object](https://spec.openapis.org/oas/v3.1.0#parameter-object)
