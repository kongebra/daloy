# 8-Hour · Exercise 8 — Step-by-Step

> Goal: run the codegen pipeline end-to-end and use the typed SDK.

## Step 1 — Boot the server

```bash
pnpm dev:8:8
```

You should see two routes registered. The contract is now exposed at `/openapi.json`.

## Step 2 — In a second terminal, dump the spec

```bash
pnpm gen:openapi
```

This runs `scripts/dump-openapi.ts`, which `fetch`es `http://localhost:3000/openapi.json` and writes it to `generated/openapi.json`. Committing this file is optional — many teams check it in for diff visibility on PRs.

## Step 3 — Generate the SDK

```bash
pnpm gen:client
```

This runs `@hey-api/openapi-ts` against the config in [`openapi-ts.config.ts`](../../../../openapi-ts.config.ts). Output lands in `generated/client/`.

## Step 4 — Use it

```ts
import { getBookById } from "../../../generated/client";

const { data, error } = await getBookById({ path: { id: "1" } });
if (error) {
  // error is typed as the problem+json union from your responses block
  console.error(error);
} else {
  // data is typed as BookSchema's inferred shape
  console.log(data.title);
}
```

Notice you don't import any types separately — `data` and `error` are inferred from the generated client's signature.

## Step 5 — In-process client for tests

You don't always want to spin up a real port for unit tests. `createClient(app, { baseUrl })` from `@daloyjs/core/client` returns a typed client that calls into the app **without going over the network**. Same contract shape as the generated client; zero startup cost; great for `node --test`.

## Common mistakes

- **Running `pnpm gen` before the server is up.** The dump script fetches `/openapi.json`. No server, no spec, no codegen.
- **Importing the generated client from outside `generated/`** but forgetting to commit it. CI typecheck fails until you regenerate or commit. Pick one policy and stick to it.
- **Manually editing `generated/`.** It will be wiped on the next gen. Customize the codegen via plugins in `openapi-ts.config.ts`.
