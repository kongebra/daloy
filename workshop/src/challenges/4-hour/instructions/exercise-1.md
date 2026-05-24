# Exercise 1: Contract-First Route

Replace the stub `/books/:id` route with a real contract that validates the path parameter, types the response body, and documents both the happy path and the 404.

## Requirements

- Define a `BookSchema` (Zod) with `id` and `title` strings.
- Add a `request.params` schema that validates `id` as a non-empty string (or a uuid — your choice).
- Type the 200 response body with `BookSchema` and add an example.
- Document a 404 response with a problem+json schema (RFC 9457 shape — `type`, `title`, `status`, optional `detail`).
- Return the 404 manually in the handler when the book isn't found. (Exercise 2 will swap this for `throw new NotFoundError(...)`.)

## Verify

```bash
curl -s http://localhost:3000/books/1 | jq
# { "id": "1", "title": "Foundation" }

curl -s -i http://localhost:3000/books/missing | head -n 1
# HTTP/1.1 404 Not Found

curl -s http://localhost:3000/openapi.json | jq '.paths."/books/{id}".get.parameters'
# Should list a path parameter `id` of type string
```

## Discussion Prompt

Once `request.params`, `responses[200].body`, and `responses[404].body` are all schemas, **three** things are now wired off the same definition: runtime validation, the TypeScript types inside the handler, and the OpenAPI spec consumed by Hey API. What would each of those cost you in Express?

## Why This Matters

This is the single highest-leverage idea in DaloyJS: **the route definition is the contract**. Every later concern — auth, errors, typed-client codegen, testing — composes on top without diverging. Drift between "the docs", "the types", and "the runtime" is structurally impossible.

## Training Resources

- [DaloyJS — Routing](https://daloyjs.dev/docs/routing)
- [DaloyJS — Validation](https://daloyjs.dev/docs/validation)
- [DaloyJS — OpenAPI](https://daloyjs.dev/docs/openapi)
- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457)
