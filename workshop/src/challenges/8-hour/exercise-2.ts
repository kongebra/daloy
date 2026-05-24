// 8-HOUR · Exercise 2 — Path Params, Query, Body, Headers
//
// TODO:
// 1. Build GET /books with a `?limit=` query (1..100, default 20) and
//    `?status=` filter ("available" | "checked-out").
// 2. Build POST /books with a `.strict()` body and an `idempotency-key` header.
// 3. Confirm /openapi.json reports each slot with the correct location
//    (path / query / header / body).
//
// Docs: https://daloyjs.dev/docs/validation

import { App, HttpError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const books = new Map<string, { id: string; title: string; status: "available" | "checked-out" }>([
  ["1", { id: "1", title: "Foundation", status: "available" }],
  ["2", { id: "2", title: "Dune", status: "checked-out" }],
]);
const seenIdempotencyKeys = new Set<string>();

const BookSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["available", "checked-out"]),
});

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});

// TODO: GET /books with limit + status query.
// TODO: POST /books with .strict() body and required idempotency-key header.

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
