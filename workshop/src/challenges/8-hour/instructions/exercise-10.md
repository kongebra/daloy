# 8-Hour · Exercise 10: Rate Limits, Body Limits, Timeouts

The three quantitative defenses. Each one has a default; you're going to tune them per route.

## Requirements

- App-level: `bodyLimitBytes: 64 * 1024` and `requestTimeoutMs: 5_000`.
- Global rate limit: 60 requests / minute.
- **Per-route override** on `POST /password-reset`: 5 / minute (stricter).
- Confirm:
  - `GET /slow` returns **408** after 5 s.
  - `POST /echo` with a 1 MB body returns **413**.
  - 6th call to `/password-reset` in 60 s returns **429**.

## Verify

```bash
# 408
time curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/slow
# 408 (after ~5s)

# 413
dd if=/dev/zero bs=1024 count=1024 2>/dev/null | base64 | jq -Rs '{blob: .}' | \
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/echo \
       -H 'content-type: application/json' --data-binary @-
# 413

# 429
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/password-reset \
       -H 'content-type: application/json' -d '{"email":"a@b.c"}'
done
# 202 202 202 202 202 429
```

## Why This Matters

- **408 vs 413 vs 429** are semantically distinct, and good clients act on each differently (retry-with-backoff vs split-the-payload vs back-off-respect-retry-after). Don't collapse them into a generic 500.
- **Per-route limits** matter for expensive operations: a 60/min global limit is fine for `GET /health`, but `/password-reset` (which sends an email) needs to be much tighter.
- **App-level body limit** prevents the "memory exhaustion DoS": a single 50 MB request body that pins your worker.

## Training Resources

- [DaloyJS — Security](https://daloyjs.dev/docs/security)
- [DaloyJS — Routing (route hooks)](https://daloyjs.dev/docs/routing)
- [RFC 6585 — 429 Too Many Requests](https://www.rfc-editor.org/rfc/rfc6585)
