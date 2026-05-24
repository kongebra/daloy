# 8-Hour · Exercise 9: Secure Headers, CSP, CORS, CSRF

The three browser-facing security mechanisms. Each one has a famously bad default; you're going to set good ones.

## Requirements

- `secureHeaders` with a tight CSP: `default-src 'self'`, no `unsafe-eval`, `frame-ancestors 'none'`.
- `cors` with an **explicit origin list** plus `credentials: true`.
- **Double-submit CSRF**: `GET /csrf` sets a cookie and returns the same value in the body; `POST /actions` rejects unless the `X-CSRF-Token` header matches the cookie (constant-time comparison).

## Verify

```bash
# Headers present
curl -sI http://localhost:3000/health | grep -iE 'content-security-policy|access-control-allow-origin'

# CSRF happy path
TOKEN=$(curl -s -c /tmp/c.txt http://localhost:3000/csrf | jq -r .token)
curl -s -b /tmp/c.txt -X POST http://localhost:3000/actions \
  -H "X-CSRF-Token: $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"reboot"}' | jq
# {"ok":true}

# CSRF mismatch → 403
curl -s -b /tmp/c.txt -X POST http://localhost:3000/actions \
  -H "X-CSRF-Token: wrong" -H 'content-type: application/json' \
  -d '{"name":"reboot"}' | jq
# {"type":"about:blank","title":"Forbidden","status":403,...}
```

## Why This Matters

- **`credentials: true` + `origin: "*"`** is unsafe per the CORS spec and silently broken by browsers. Always enumerate origins.
- **CSP `unsafe-inline` for scripts** defeats the entire mechanism. Use nonces if you absolutely need inline.
- **Double-submit CSRF** is the right pattern for JSON APIs: it doesn't require a server-side session store, and constant-time comparison prevents timing attacks on the token.

## Training Resources

- [DaloyJS — Security](https://daloyjs.dev/docs/security)
- [DaloyJS — Secure defaults](https://daloyjs.dev/docs/security/secure-defaults)
- [OWASP — CSRF Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [MDN — CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
