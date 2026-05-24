// 8-HOUR · Challenge 1 (Feature) — Authors CRUD
//
// Build a full CRUD slice for `/authors`. This is a green-field exercise: you
// own the contract, the validation, the errors, the examples, and the tests.
//
// Requirements (see instructions/challenge-1-feature.md for the full spec):
//   - GET    /authors            — list (with `?limit` query)
//   - GET    /authors/:id        — single
//   - POST   /authors            — create (bearer auth)
//   - PATCH  /authors/:id        — partial update (bearer auth)
//   - DELETE /authors/:id        — soft delete (bearer auth, returns 204)
//   - All bodies are `.strict()`
//   - Two named examples on the 200 response of GET /authors/:id
//   - RFC 9457 errors: 404 NotFoundError, HttpError(409) on duplicate id
//
// Docs: https://daloyjs.dev/docs/routing
//        https://daloyjs.dev/docs/validation
//        https://daloyjs.dev/docs/errors

import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: {
    info: { title: "Workshop API", version: "0.1.0" },
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  },
  docs: true,
});

// TODO: AuthorSchema, CreateAuthorBody, PatchAuthorBody
// TODO: in-memory Map<string, Author>
// TODO: five routes

serve(app, { port: 3000 });
