# Exercise 2: Validation + RFC 9457 Errors

Let the framework do the error rendering. Replace the manual 404 body with `throw new NotFoundError(...)` and watch validation errors and unknown-key errors come back as well-formed problem+json without writing a single response body.

## Requirements

- Replace the manual 404 in `GET /books/:id` with `throw new NotFoundError(...)`.
- Add `POST /books` with a `.strict()` request body schema (`id` + `title`).
- On duplicate id, `throw new HttpError(409, ...)` (returns 409 problem+json automatically).
- Verify three failure modes return problem+json with the right status:
  - Missing book → `404`
  - Invalid request body (missing title, or title too long) → `400`
  - Unknown key in body (e.g. `{ id, title, isbn }`) → `400` rejected by `.strict()`

## Verify

```bash
# 1. NotFoundError → 404 problem+json
curl -s -i http://localhost:3000/books/missing | head -n 4

# 2. ValidationError (missing required field) → 400 problem+json
curl -s -X POST http://localhost:3000/books \
  -H 'content-type: application/json' \
  -d '{"id":"3"}'

# 3. .strict() rejects unknown keys
curl -s -X POST http://localhost:3000/books \
  -H 'content-type: application/json' \
  -d '{"id":"3","title":"Hyperion","isbn":"0-553-28368-5"}'
```

All three responses should be `application/problem+json` with `type`, `title`, `status`, and useful `detail` for these expected 4xx failures.

## Discussion Prompt

DaloyJS redacts internal 5xx details in production, while expected 4xx errors can still carry client-facing `detail`. Where would you draw that line in your own API, and what's the trade-off?

## Why This Matters

Half of bad API code is hand-rolled error responses. By the time the codebase has 30 routes, each one has its own slightly-different error shape, and clients can't write a single error parser. DaloyJS's RFC 9457 default fixes this once for the whole app — and `.strict()` schemas close the very common mass-assignment vulnerability where an attacker posts extra fields hoping one of them is `isAdmin: true`.

## Training Resources

- [DaloyJS — Errors](https://daloyjs.dev/docs/errors)
- [DaloyJS — Validation](https://daloyjs.dev/docs/validation)
- [DaloyJS — Security overview](https://daloyjs.dev/docs/security)
- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457)
- [OWASP — Mass Assignment cheatsheet](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html)
