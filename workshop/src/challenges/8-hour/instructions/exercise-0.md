# 8-Hour · Exercise 0: Workshop Setup

This is the same bootstrap as the [4-hour exercise 0](../../4-hour/instructions/exercise-0.md), with one addition: print `app.introspect()` at boot so every later exercise can show its full operation table at a glance.

## Requirements

- Construct an `App` with `docs: true` and an `openapi.info` block.
- Register `GET /health` that returns `{ status: "ok" }` typed with a Zod schema.
- Print `app.introspect()` at boot.
- Boot with the Node adapter on port 3000.

## Verify

```bash
pnpm dev:8:0
# Registered routes:
#   GET    /health  (operationId=getHealth)
# → http://localhost:3000/health

curl -s http://localhost:3000/health
# {"status":"ok"}
open http://localhost:3000/docs
```

## Why This Matters (Beyond the 4-Hour Setup)

The 8-hour track introduces multiple plugins, multiple security schemes, and ultimately a WebSocket route. The introspect dump is your sanity check — every time you add a feature, the boot log either confirms or refutes that the contract changed the way you expected.

## Training Resources

- [DaloyJS — Getting Started](https://daloyjs.dev/docs/getting-started)
- [DaloyJS — OpenAPI](https://daloyjs.dev/docs/openapi)
- [4-hour exercise 0 coding steps](../../4-hour/coding-steps/exercise-0-steps.md) — re-use the same setup walkthrough
