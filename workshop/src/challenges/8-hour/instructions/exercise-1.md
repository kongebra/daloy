# 8-Hour · Exercise 1: Contract-First Route (with rich operation metadata)

Build the canonical `/books/:id` route with the full set of operation metadata that drives the Scalar UI and the typed client docs.

## Requirements

- Add `summary`, `description`, and `tags` to the operation.
- Add **two named examples** under `responses[200].examples` (e.g., `foundation` and `dune`).
- Use `throw new NotFoundError(...)` for the miss path (instead of returning a 404 body manually).
- Confirm both examples appear in `/docs` (Scalar lets you pick the example from a dropdown).

## Verify

```bash
curl -s http://localhost:3000/books/1
# {"id":"1","title":"Foundation"}

curl -s http://localhost:3000/openapi.json | jq '.paths."/books/{id}".get.responses."200".content."application/json".examples'
# {"foundation":{"value":{"id":"1","title":"Foundation"}},"dune":{...}}

open http://localhost:3000/docs
```

## Discussion Prompt

A senior product manager asks: _"Can we let consumers see different examples per region / per environment?"_ Where in the contract would each example live, and what stops the spec from becoming unmaintainable?

## Why This Matters

`summary` shows up in the sidebar; `description` shows up in the operation body. Both are markdown-enabled. **Named examples** are how you teach consumers what realistic input/output looks like — far more useful than a single `default` placeholder. Hey API also picks up examples and uses them in generated tests.

## Training Resources

- [DaloyJS — Routing](https://daloyjs.dev/docs/routing)
- [DaloyJS — OpenAPI](https://daloyjs.dev/docs/openapi)
- [OpenAPI 3.1 — Examples](https://spec.openapis.org/oas/v3.1.0#example-object)
