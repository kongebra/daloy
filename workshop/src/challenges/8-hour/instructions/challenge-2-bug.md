# 8-Hour · Challenge 2 (Bug Hunt): Security Regression

A "bad PR" landed in `challenge-2-bug.ts`. It has **7 security regressions** (plus one bonus). Find them all without looking at the solution.

## Rules

- The bugs are spread across config, middleware setup, JWT verification, request validation, the handler body, and a helper route.
- The exercise is _not_ "diff vs the solution". Read the file once, list the bugs you see, then run the verify commands.
- The solution file is the **post-fix** version. Only open it after you've drafted your own fix.

## Hints (vague on purpose)

1. The body limit is now in the megabytes — what attack does that enable?
2. One critical middleware was deleted. What kind of header-related attack does that re-enable?
3. The CORS config has a wildcard and credentials. Why is that broken by spec?
4. The JWT verifier doesn't pass an `algorithms` allowlist. What attack family does that re-enable?
5. The admin request body lost `.strict()`. What does an attacker put in the extra fields?
6. The admin token comparison uses `===`. What does that leak?
7. The 401 problem+json `detail` is suspiciously informative. Why is that bad in production?
8. (Bonus) The `/proxy` route calls `fetch` directly with no guard. Reference: exercise 11.

## Verify

```bash
# 1: send a 1 MB payload and confirm it's no longer accepted after the fix.
# 2: curl -sI http://localhost:3000/health should show x-content-type-options and friends.
# 3: a request with Origin: https://evil.com should NOT get an Access-Control-Allow-Origin header.
# 4: a forged {"alg":"none"} token should be rejected by the fixed verifier.
# 5: posting {"token":"x","command":"y","extra":"hi"} should be rejected with 400.
# 6: same comparison either way at the HTTP layer, but tests should use timingSafeEqual.
# 7: in production mode (NODE_ENV=production), `detail` should not leak the expected token.
# 8: posting {"url":"http://169.254.169.254/"} should be refused.
```

## Why This Matters

Security regressions usually look like "small refactors". The PR description says "simplifying validation" or "improving DX" while quietly removing the very checks that protect you. The fixed version of this file is exactly the same _shape_ — just with the guards intact.

This is why every change to `src/security.ts`, JWT, fetch-guard, etc. in DaloyJS goes through automated `verify:*` gates: a human reviewer can miss any one of these.

## Training Resources

- [DaloyJS — Secure defaults](https://daloyjs.dev/docs/security/secure-defaults)
- [DaloyJS — Security](https://daloyjs.dev/docs/security)
- [Supabase + Aikido — Secure-by-Default Development](https://www.aikido.dev/blog/supabase-approach-to-secure-by-default-development)
