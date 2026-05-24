# 8-Hour · Exercise 5 — Step-by-Step

> Goal: enforce two different authentication schemes on two routes, with the right error codes.

## Step 1 — Declare the security schemes

```ts
openapi: {
  info: { title: "Workshop API", version: "0.1.0" },
  securitySchemes: {
    bearer: { type: "http", scheme: "bearer" },
    apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
  },
},
```

These names (`bearer`, `apiKey`) are the keys you reference from each route's `auth.scheme`.

## Step 2 — Write a constant-time string equality helper

```ts
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
```

**Why the length pre-check:** `timingSafeEqual` throws when the buffers are different lengths. The early return prevents the throw but, importantly, doesn't leak length information any more than the throw itself would.

## Step 3 — Wire bearer auth on `/admin/books`

```ts
auth: { scheme: "bearer" },
hooks: bearerAuth({
  validate: async (token) => constantTimeEqual(token, VALID_ADMIN_TOKEN),
}),
```

`bearerAuth` does the header parsing for you and throws the right 401/403 from `validate`'s boolean. You only supply the comparison.

## Step 4 — Write a custom hook for the API-key surface

```ts
const apiKeyAuth: Hooks = {
  beforeHandle(ctx) {
    const key = ctx.request.headers.get("x-api-key");
    if (!key) throw new UnauthorizedError("Missing X-API-Key header");
    if (!VALID_API_KEYS.has(key)) throw new ForbiddenError("Invalid API key");
  },
};
```

**Why throw, not return a 401 response:** the error pipeline renders RFC 9457 problem+json automatically. Returning a hand-rolled response bypasses that pipeline.

## Step 5 — Apply to `/partner/books`

```ts
auth: { scheme: "apiKey" },
hooks: apiKeyAuth,
```

## Common mistakes

- **Using `===` to compare tokens.** Constant-time comparison is non-negotiable.
- **Only setting `hooks` and forgetting `auth`.** OpenAPI consumers (and Hey API) won't know the route is protected, so generated clients won't prompt for credentials.
- **Returning 401 for "wrong" credentials.** Use 403. Save 401 for "no credentials presented at all" — they're semantically different and clients act on the difference.
- **Storing API keys in plaintext in a `Map`.** Fine for the workshop. In production, hash them at rest (HKDF + bcrypt or argon2id).
