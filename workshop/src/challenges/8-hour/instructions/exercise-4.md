# 8-Hour · Exercise 4: Middleware Plugins & Encapsulation

Write your own middleware. It's just a function — and once you've written one, you've understood every plugin in the framework.

## Requirements

- Implement a `timing` middleware that:
  - Records `performance.now()` before `next()`.
  - Sets `server-timing: total;dur=<ms>` on the response after.
- Place it between `secureHeaders` and `cors` so headers it sets aren't overwritten and so its measurement excludes CORS preflight overhead.
- Confirm the response carries every standard header plus `server-timing`.

## Verify

```bash
curl -sI http://localhost:3000/health | grep -iE 'x-(content-type-options|frame-options|request-id)|server-timing'
# x-content-type-options: nosniff
# x-frame-options: DENY
# x-request-id: …
# server-timing: total;dur=1.4
```

## Why This Matters

The middleware contract is simply `(ctx, next) => Promise<Response>`. There is no plugin lifecycle, no hook system, no registration order surprises. The framework's first-party middleware (`requestId`, `secureHeaders`, `cors`, `rateLimit`) are written against the same contract — you can read their source as reference.

## Training Resources

- [DaloyJS — Routing & middleware](https://daloyjs.dev/docs/routing)
- [DaloyJS — Security](https://daloyjs.dev/docs/security)
- [MDN — Server-Timing](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing)
