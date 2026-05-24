# Exercise 6: Runtime Portability

The same `App` ships on Node, Bun, Deno, Vercel, and Cloudflare Workers. The framework's core only knows `Request → Response`; each adapter is a tiny boot shim. Prove it by extracting your app into a `buildApp()` factory and booting it from two different adapters.

## Requirements

- Extract everything in the exercise file into a `buildApp(): App` factory.
- Boot the factory from at least two adapters in the same file:
  - `@daloyjs/core/node` (always available).
  - `@daloyjs/core/bun` (used at runtime if `Bun` is detected, dynamically imported so Node doesn't choke on the import).
- Add `runtime` to the `/health` response and confirm the value swaps when you change adapters.

## Verify

```bash
# Node
pnpm dev:4:6
curl -s http://localhost:3000/health
# {"runtime":"Node.js"}

# Bun (if installed)
bun src/challenges/4-hour/exercise-6.ts
curl -s http://localhost:3000/health
# {"runtime":"Bun"}
```

`buildApp()` itself is identical for both. The only difference is the imported `serve` function.

## Discussion Prompt

The deployment platforms that matter for your team — Vercel, Workers, Lambda, your own k8s — each have constraints (cold-start time, response-streaming limits, fs access, env-var injection). Look at the [Adapters docs](https://daloyjs.dev/docs/adapters) and pick the two adapters you'd actually use in production. What concrete benefit does each give over Node?

## Why This Matters

"Cloud lock-in" is usually self-inflicted. A framework that wires Node-only APIs into the request lifecycle (`req.connection.remoteAddress`, `res.write()` mid-stream, raw `Buffer` for body parsing) makes itself impossible to port. DaloyJS's core only uses Web standards (`Request`, `Response`, `ReadableStream`, `Headers`), so the same code runs anywhere a JavaScript runtime exposes those primitives — which is, by 2026, everywhere.

## Training Resources

- [DaloyJS — Adapters overview](https://daloyjs.dev/docs/adapters)
- [DaloyJS — Node adapter](https://daloyjs.dev/docs/adapters/node)
- [DaloyJS — Bun adapter](https://daloyjs.dev/docs/adapters/bun)
- [DaloyJS — Deno adapter](https://daloyjs.dev/docs/adapters/deno)
- [DaloyJS — Cloudflare Workers adapter](https://daloyjs.dev/docs/adapters/cloudflare-workers)
- [DaloyJS — Vercel adapter](https://daloyjs.dev/docs/adapters/vercel)
