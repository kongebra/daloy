# Exercise 5: OpenAPI + Typed Client Codegen

Generate a fully typed fetch SDK from the spec your server already exposes. Same idea as Hey API in the React workshop — but the server _is_ the source of truth.

## Requirements

- Use the in-process `createClient(app, { baseUrl })` to call `getBookById` from a startup smoke-test inside this very file.
- Verify the TypeScript inferred return type is a discriminated union over `status`.
- In a second terminal, run `pnpm gen` while this exercise is serving. Inspect `generated/client/` and confirm:
  - There's a `getBookById` function.
  - The 200 and 404 response bodies are typed.
  - There's a Zod schema generated from `BookSchema` you can re-use on the consumer side.

## Verify

```bash
# Terminal A
pnpm dev:4:5

# Terminal B
pnpm gen:openapi      # writes generated/openapi.json
pnpm gen:client       # writes generated/client/
cat generated/openapi.json | jq '.paths."/books/{id}".get.operationId'
# "getBookById"
ls generated/client
```

The startup smoke-test in this exercise should also print:

```
client.getBookById(1) -> 200 { id: '1', title: 'Foundation' }
client.getBookById(missing) -> 404 { type: 'about:blank', title: 'Not Found', status: 404, … }
```

## Discussion Prompt

Hey API codegen runs against the live `/openapi.json` of a running server. That makes the OpenAPI doc the contract _between_ teams. What changes about your PR-review process when the spec is auto-generated from the route definitions?

## Why This Matters

This is the payoff for exercises 1–4. Every contract slot you typed earlier — `request.params`, `responses[200].body`, `auth.scheme`, the 401 documentation — now generates:

- A typed SDK function the frontend can import.
- A Zod schema for runtime validation on the consumer side.
- Discriminated response types so consumers can't forget the error case.

There is no hand-written DTO, no axios glue, no "we need to keep the API and SDK in sync" ritual.

## Training Resources

- [DaloyJS — Clients](https://daloyjs.dev/docs/clients)
- [DaloyJS — OpenAPI](https://daloyjs.dev/docs/openapi)
- [Hey API — Get Started](https://heyapi.dev/openapi-ts/get-started)
- [Hey API — Plugins](https://heyapi.dev/openapi-ts/plugins)
