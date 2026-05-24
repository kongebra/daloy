# Challenge 2 — Bug: Find the Security Regressions

A teammate's PR description: _"Made the tests pass — please review."_ The tests do indeed pass. The app is also seven different kinds of broken.

There are **five intentional security regressions** in [`challenge-2-bug.ts`](../challenge-2-bug.ts), plus two bonus regressions on `POST /books`. Find them, explain why each is dangerous in one sentence, and fix them **without** weakening the framework's defaults.

## Rules

- Do **not** delete the regressions to make tests pass. Fix them properly.
- Do **not** add `// eslint-disable` or `as any` to silence warnings.
- Per the framework's posture in [AGENTS.md](../../../../AGENTS.md), bad defaults are bugs. If a default is in the way, narrow the scope — don't disable it.
- Document your reasoning in PR-comment style above each fix.

## What to look for

- **App constructor options** — what makes the defaults weaker than out-of-the-box?
- **Middleware stack** — what's missing? What's set to a value that effectively disables it?
- **CORS** — there's exactly one combination of `origin` + `credentials` that browsers reject. The other dangerous combo is the one that ships anyway.
- **Error handling** — does any handler leak server internals to the client?
- **Auth contract** — is the route runtime-protected, OpenAPI-documented, _or both_?
- **Request body schema** — does any route accept unknown fields?

## Verify

When you're done, every one of these should hold:

```bash
# Response carries x-content-type-options, x-frame-options, hsts, x-request-id
curl -sI http://localhost:3000/docs | grep -iE 'x-(content-type-options|frame-options|request-id)|strict-transport-security'

# Wildcard CORS is gone
curl -sI -X OPTIONS http://localhost:3000/books -H 'origin: https://evil.example' \
  -H 'access-control-request-method: POST' | grep -i access-control-allow-origin
# Should NOT echo "evil.example" or "*"

# Body limit and timeout are restored (413 / 408 work, see exercise 3)

# Missing book returns problem+json, not a stack-trace-ish body
curl -s http://localhost:3000/books/missing | jq
# {"type":"about:blank","title":"Not Found","status":404,...}

# Mass-assignment is rejected
curl -s -X POST http://localhost:3000/books \
  -H 'authorization: Bearer demo-token' \
  -H 'content-type: application/json' \
  -d '{"id":"3","title":"Hyperion","isAdmin":true}'
# {"type":"about:blank","title":"Validation Error", … "Unrecognized key: \"isAdmin\""}

# /docs shows the lock icon on createBook
open http://localhost:3000/docs
```

## Why This Matters

The Supabase + Aikido write-up [Secure-by-Default Development](https://www.aikido.dev/blog/supabase-approach-to-secure-by-default-development) captures the failure mode in one line:

> _"If you tell an AI to make something work, it might remove the very security checks that protect you."_

The bug challenge simulates exactly that failure mode. Every regression here is something a hurried teammate (or an AI coding assistant) might "fix" to silence a red CI check. The right response is always to keep the guardrail and fix the root cause.

## Training Resources

- [DaloyJS — Security overview](https://daloyjs.dev/docs/security)
- [DaloyJS — Secure defaults](https://daloyjs.dev/docs/security/secure-defaults)
- [DaloyJS — Auth](https://daloyjs.dev/docs/auth)
- [DaloyJS — Errors](https://daloyjs.dev/docs/errors)
- [Aikido — Secure-by-Default Development (Supabase)](https://www.aikido.dev/blog/supabase-approach-to-secure-by-default-development)
- [OWASP — Mass Assignment](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html)
- [OWASP — Security Misconfiguration](https://owasp.org/www-project-top-ten/2017/A6_2017-Security_Misconfiguration)
