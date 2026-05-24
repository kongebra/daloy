# 8-Hour · Exercise 11: SSRF, Sessions, WebSocket

Three "harder" surfaces in one exercise: outbound `fetch` with SSRF protection, signed-cookie sessions, and an authenticated WebSocket.

## Requirements

- **SSRF**: `POST /preview` accepts a `{ url }` body and fetches the page _via_ `fetchGuard()`, which by default blocks 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, and 169.254.0.0/16 (AWS metadata service). Also restrict to `https:` and 5s timeout.
- **Sessions**: `POST /login` issues a signed-cookie session (`payload.hmac`) on `Set-Cookie` with `HttpOnly; SameSite=Strict; Secure`.
- **WebSocket**: `/ws` requires the session cookie. Echoes messages back to the authenticated user.

## Verify

```bash
# SSRF — public host works
curl -s -X POST http://localhost:3000/preview \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}' | jq

# SSRF — metadata service blocked
curl -s -X POST http://localhost:3000/preview \
  -H 'content-type: application/json' \
  -d '{"url":"http://169.254.169.254/"}' | jq
# {"type":"about:blank","title":"Bad Request","status":400,"detail":"Refusing to fetch: ..."}

# Sessions
curl -s -c /tmp/s.txt -X POST http://localhost:3000/login \
  -H 'content-type: application/json' \
  -d '{"username":"alice","password":"wonderland"}'

# WebSocket — use `websocat`
websocat ws://localhost:3000/ws --header "Cookie: $(cat /tmp/s.txt | grep session | awk '{print $6\"=\"$7}')"
```

## Why This Matters

- **`fetchGuard`** is the only thing standing between your API and someone using your server as a hop point into your VPC. Cloud metadata endpoints (`169.254.169.254`) leak IAM credentials in seconds.
- **Signed-cookie sessions** sidestep the entire "session store" question for stateless APIs. The cookie carries the data; HMAC proves authenticity.
- **WebSocket authentication** is its own gotcha — most apps `accept(req)` first and verify later. By then you've already accepted the socket and burned a connection slot. Verify in the `authorize` hook _before_ accepting.

## Training Resources

- [DaloyJS — Security (fetchGuard)](https://daloyjs.dev/docs/security)
- [DaloyJS — WebSockets](https://daloyjs.dev/docs/websockets)
- [OWASP — SSRF](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery)
