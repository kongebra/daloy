# 8-Hour · Exercise 4 — Step-by-Step

> Goal: write a small lifecycle hook and place it correctly in the stack.

## Step 1 — Write the hook

Above `app.use(requestId())`:

```ts
const timing: Hooks = {
  beforeHandle(ctx) {
    ctx.state.startedAt = performance.now();
  },
  onSend(res, ctx) {
    const startedAt = ctx?.state.startedAt;
    if (typeof startedAt === "number") {
      const ms = (performance.now() - startedAt).toFixed(1);
      res.headers.set("server-timing", `total;dur=${ms}`);
    }
  },
};
```

**Why the explicit `: Hooks` annotation:** without it, TypeScript can still infer the shape, but the annotation acts as documentation and catches an entire class of lifecycle-name mistakes.

**Why `performance.now()` and not `Date.now()`:** `performance.now()` is monotonic and high-resolution. `Date.now()` can move backwards on NTP corrections and is millisecond-granularity only.

## Step 2 — Insert it in the stack

```ts
app.use(requestId());
app.use(secureHeaders());
app.use(timing);
app.use(cors({ ... }));
app.use(rateLimit({ ... }));
```

**Why after `secureHeaders` and before `cors`:**

- After `secureHeaders` so the timing measurement includes the cost of setting security headers (which is what your customers experience).
- Before `cors` so a preflight `OPTIONS` request — which is handled by the CORS middleware short-circuiting — doesn't double-count its time in `server-timing`.

## Step 3 — Verify

```bash
curl -sI http://localhost:3000/health | grep -iE 'x-(content-type-options|frame-options|request-id)|server-timing'
```

You should see all four headers. If `server-timing` is missing, your middleware never wrote it (probably because you returned `res` from inside a try/catch that swallowed the response).

## Common mistakes

- **Trying to call `next()`.** DaloyJS hooks are lifecycle objects, not Koa-style middleware functions.
- **Mutating `ctx.headers` instead of `res.headers`.** `ctx` is the _request_. Response headers go on the `Response` passed to `onSend`.
- **Reading `performance` from a Web Worker that doesn't have it.** Workers do have `performance.now()` since 2019. Don't write defensive `if (typeof performance !== "undefined")` checks unless you know your target runtime is older.
