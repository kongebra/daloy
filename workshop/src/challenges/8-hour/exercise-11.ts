// 8-HOUR · Exercise 11 — SSRF, Sessions, WebSocket
//
// TODO:
// 1. Implement a "preview link" endpoint that fetches a URL — but uses
//    `fetchGuard()` so private network ranges are blocked.
// 2. Issue signed-cookie sessions (HMAC) on POST /login.
// 3. Expose a WebSocket at /ws that requires the session cookie.
//
// Docs: https://daloyjs.dev/docs/security  ·  https://daloyjs.dev/docs/websockets

import { App, fetchGuard, UnauthorizedError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const SESSION_SECRET = "workshop-do-not-reuse";
const users = new Map([["alice", "wonderland"]]);

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});

// TODO: const safeFetch = fetchGuard({ allowProtocols: ["https:"] }) → use this for /preview.
// TODO: sign/verify session cookie helpers.
// TODO: POST /login → set signed session cookie.
// TODO: POST /preview → fetch external URL via safeFetch.
// TODO: app.ws("/ws", { beforeUpgrade, open, message }) → require session cookie.

serve(app, { port: 3000 });
