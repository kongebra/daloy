# 8-Hour · Exercise 7 — Step-by-Step

> Goal: turn the bare-minimum OpenAPI block into a useful one using the fields DaloyJS currently exposes on `new App({ openapi })`.

## Step 1 — Expand `openapi.info`

```ts
info: {
  title: "Workshop API",
  version: "0.1.0",
  description: "Reference API used by the DaloyJS workshop. ...",
},
```

## Step 2 — Add `servers`

```ts
servers: [
  { url: "http://localhost:3000", description: "Local dev" },
  { url: "https://api.example.com", description: "Production" },
],
```

This drives the "Server" dropdown in Scalar and in the typed client — Hey API will let consumers pick a server when constructing the client.

## Step 3 — Add route summaries, descriptions, and tags

```ts
summary: "Health check",
description: "Returns `{ ok: true }` when the process is up. Use for liveness probes.",
tags: ["Meta"],
```

DaloyJS route definitions support `summary`, `description`, and string `tags`. The current App-level `openapi` options support `info.description`, `servers`, `securitySchemes`, and `webhooks`.

## Step 4 — Add security schemes when routes need auth

```ts
securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
```

## Common mistakes

- **Putting markdown in `info.title`.** The title is plain text and shows up in lots of places (tabs, bookmarks). Keep it short.
- **Copy-pasting OpenAPI fields that DaloyJS doesn't expose yet.** Keep `contact`, `license`, top-level tag descriptions, and `externalDocs` in external docs until the App options support them.
- **Hardcoding `servers: [{ url: "https://api.example.com" }]` only.** Local development becomes painful — Scalar's "Try it" panel will hit prod.
