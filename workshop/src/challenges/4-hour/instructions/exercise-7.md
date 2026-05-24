# Exercise 7: Testing & Introspection

The contract is real; now lock it down with tests. Use `app.introspect()` to enumerate every route, and write a `node:test` contract test that boots the app on an ephemeral port and verifies both the happy path and the 404 problem+json.

## Requirements

- In the exercise file, when run as a script, print every route registered on the app via `app.introspect()`.
- In `tests/exercise-7.test.ts`, write three tests (the starter already has them — see `tests/`):
  1. `GET /books/1` returns 200, `application/json`, and a body that matches `BookSchema`.
  2. `GET /books/missing` returns 404 with `application/problem+json`.
  3. `app.introspect()` lists at least the `getBookById` operationId.
- Run `pnpm test`. Both tests should pass.

## Verify

```bash
# Boot the script directly — see the introspect dump
pnpm dev:4:7
# Registered routes:
#   GET    /books/:id  (operationId=getBookById)
# → http://localhost:3000/docs

# Contract tests
pnpm test
# ✔ GET /books/1 returns a Book that matches BookSchema
# ✔ GET /books/missing returns a 404 problem+json
# ✔ app.introspect() lists every registered operationId
```

## Discussion Prompt

`app.introspect()` is a public API of the framework. It returns the same data structure the OpenAPI generator uses. What testing or operational use cases does that unlock that you couldn't get from `/openapi.json` alone?

## Why This Matters

Contract tests are the cheapest insurance against unintentional API breakage. Because the contract is just the route definition, the test surface is:

- "Does the runtime still accept this input and return this output?" — `fetch` + assert.
- "Did anyone delete or rename a route?" — `app.introspect()` + assert on a set of `operationId`s.
- "Did the OpenAPI shape change in a way clients can't tolerate?" — diff `/openapi.json` between commits.

You don't need a mocking framework, a separate "API description" repo, or a third-party contract-test product.

## Training Resources

- [DaloyJS — Testing](https://daloyjs.dev/docs/testing)
- [DaloyJS — Routing (introspect)](https://daloyjs.dev/docs/routing)
- [Node — node:test](https://nodejs.org/api/test.html)
