// 8-HOUR · Exercise 1 — Contract-First Route
//
// Same essential pattern as 4-hour exercise 1, but you also exercise:
//   - `summary` + `description` on the operation
//   - `examples` with multiple named entries (good / not_found)
//   - re-using the BookSchema across response and request shapes
//
// TODO:
// 1. Build /books/:id with full operation metadata (summary, description, tags).
// 2. Add two named examples to the 200 response.
// 3. Confirm both examples appear in /docs.
//
// Docs: https://daloyjs.dev/docs/routing

import { App, NotFoundError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const books = new Map<string, { id: string; title: string }>([
  ["1", { id: "1", title: "Foundation" }],
  ["2", { id: "2", title: "Dune" }],
]);

const BookSchema = z.object({ id: z.string(), title: z.string() });

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});

// TODO: full contract route here.

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
