# 8-Hour · Exercise 8: Typed Client Codegen with Hey API

Hey API turns your live OpenAPI spec into a fully-typed fetch SDK. No DTOs to write, no fetch wrappers to maintain, no drift between server and client.

## Requirements

- The server boots two routes (already wired): `GET /books/:id`, `POST /books`.
- While the server is running, in a **second terminal**:
  ```bash
  pnpm gen:openapi   # dumps generated/openapi.json
  pnpm gen:client    # runs @hey-api/openapi-ts → generated/client
  ```
- In a test file, import a generated SDK function and confirm `data` is typed and `error` is the problem+json shape.

## Verify

```bash
ls generated/client            # services/, types/, ...
pnpm typecheck                 # passes
```

In the solution we also include the in-process `createClient` (from `@daloyjs/core/client`) for instant iteration — useful in unit tests where you don't want a real network round-trip.

## Discussion Prompt

You change `BookSchema` on the server to require `author: string`. Walk through what breaks downstream — when does the consumer find out? Mid-deploy, at compile time, at runtime?

## Why This Matters

The "typed client" claim only holds if your generation step is fast and reliable. Hey API:

- Reads `openapi.json` directly (no Swagger CLI, no Java).
- Emits zero-dep ESM TypeScript.
- Supports the `client-fetch` runtime that ships with no dependencies.

Once you've used it for a week, you stop writing fetch wrappers. The framework's contract _is_ your SDK.

## Training Resources

- [DaloyJS — Clients & codegen](https://daloyjs.dev/docs/clients)
- [Hey API — Getting started](https://heyapi.dev/openapi-ts/get-started)
- [Hey API — TypeScript SDK plugin](https://heyapi.dev/openapi-ts/plugins/sdk)
