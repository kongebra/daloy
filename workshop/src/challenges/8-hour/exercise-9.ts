// 8-HOUR · Exercise 9 — Secure Headers, CSP, CORS, CSRF
//
// TODO:
// 1. Configure secureHeaders with a strict Content-Security-Policy.
// 2. Configure cors with an explicit origin list (not "*", not credentials+wildcard).
// 3. Implement double-submit CSRF protection on POST /actions:
//      - Server issues a `csrf` cookie on GET /csrf.
//      - Clients must echo it in an `X-CSRF-Token` header on POST.
//      - Reject when mismatched.
//
// Docs: https://daloyjs.dev/docs/security

import { App, secureHeaders, cors, ForbiddenError, type Hooks } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});

// TODO: secureHeaders({ contentSecurityPolicy: { directives: { "default-src": ["'self'"], ... } } })
// TODO: cors({ origin: ["https://app.example.com"], credentials: true })
// TODO: csrf middleware that reads cookie + header, throws ForbiddenError on mismatch

// app.use(...);
// app.use(...);
// app.use(...);

// TODO: GET /csrf → issues cookie + returns the token.
// TODO: POST /actions → protected by csrf middleware.

serve(app, { port: 3000 });
