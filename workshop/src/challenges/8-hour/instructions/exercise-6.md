# 8-Hour · Exercise 6: JWT with Algorithm Allowlist + JWK

JWTs are the most-misconfigured authentication mechanism in modern APIs. This exercise teaches the one knob that prevents the famous attacks: an **explicit algorithm allowlist**.

## Requirements

- `POST /auth/login` issues an HS256 JWT with `createJwtSigner` and a one-hour `exp`.
- `GET /me` is protected by a custom JWT hook.
- The verifier **must** be created with `algorithms: ["HS256"]` — not a broad allowlist.
- Verify that:
  - A token signed with `{"alg":"none"}` is rejected.
  - A token signed with the wrong algorithm is rejected.
  - An expired token is rejected.
- Bonus: read the commented `jwk(...)` block to see how this becomes asymmetric/JWKS-based in production.

## Verify

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"alice","password":"wonderland"}' | jq -r .token)
echo "$TOKEN"

curl -s http://localhost:3000/me -H "authorization: Bearer $TOKEN" | jq
# {"sub":"alice"}

# A hand-forged alg:none token is rejected
NONE_TOKEN=$(echo -n '{"alg":"none","typ":"JWT"}' | base64).$(echo -n '{"sub":"alice"}' | base64).
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/me -H "authorization: Bearer $NONE_TOKEN"
# 401
```

## Why This Matters

The "alg confusion" attack family — `alg:none` tokens, swapping HS256 ↔ RS256 to trick the server into using a public key as an HMAC secret — is responsible for some of the highest-impact CVEs in JWT libraries. The fix is _not_ "use a better library"; it's **always pass an explicit algorithm allowlist on every verify call**. The library cannot reliably default this for you because the right answer depends on your issuer.

In the bonus section, `jwk(...)` shows the production pattern: fetch the issuer's JWKS, cache it, rotate when keys rotate, and verify against RS256/ES256 — never reuse the symmetric path in front of an asymmetric issuer.

## Training Resources

- [DaloyJS — Secure defaults](https://daloyjs.dev/docs/security/secure-defaults)
- [DaloyJS — JWT helpers](https://daloyjs.dev/docs/jwt)
- [OWASP — JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
