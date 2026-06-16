import { z } from "zod";
import { App, NotFoundError, requestId, secureHeaders } from "@daloyjs/core";
import { toFetchHandler } from "@daloyjs/core/vercel";

// This template targets Vercel's Node.js runtime — the runtime Vercel now
// recommends for standalone functions (it runs on Fluid Compute, with the
// performance of the edge network but full Node API support). Node.js is the
// default runtime, so no `runtime` export is needed. Vercel Node.js Functions
// in `/api` expect a default export with a `fetch` method, which is exactly
// what `toFetchHandler(app)` returns. If you specifically need the Edge runtime
// instead, add `export const runtime = "edge"` and switch the default export to
// `toWebHandler(app)` from "@daloyjs/core/vercel".

const app = new App({
  bodyLimitBytes: 256 * 1024,
  requestTimeoutMs: 5_000,
  production: process.env.NODE_ENV === "production",
  // daloy-minimal:strip-start docs
  // Auto-mounted docs (when `docs: true`):
  //   GET /openapi.json — OpenAPI 3.1 spec (JSON)
  //   GET /openapi.yaml — OpenAPI 3.1 spec (YAML, served inline as text/yaml)
  //   GET /docs         — Scalar API reference UI that loads the spec
  openapi: {
    info: { title: "My Daloy Vercel API", version: "0.0.1" },
  },
  docs: true,
  // daloy-minimal:strip-end docs
});

app.use(requestId());
app.use(secureHeaders());

app.route({
  method: "GET",
  path: "/healthz",
  operationId: "healthz",
  tags: ["Ops"],
  responses: {
    200: {
      description: "Service is healthy",
      body: z.object({ ok: z.literal(true), runtime: z.literal("vercel") }),
    },
  },
  handler: async () => ({
    status: 200,
    body: { ok: true as const, runtime: "vercel" as const },
  }),
});

// daloy-minimal:strip-start books
const Book = z.object({ id: z.string(), title: z.string() });
const books = new Map<string, z.infer<typeof Book>>([
  ["1", { id: "1", title: "Noli Me Tangere" }],
]);

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  tags: ["Books"],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "Found", body: Book },
    404: { description: "Not found" },
  },
  handler: async ({ params }) => {
    const book = books.get(params.id);
    if (!book) throw new NotFoundError(`Book ${params.id} not found`);
    return { status: 200, body: book };
  },
});
// daloy-minimal:strip-end books

export default toFetchHandler(app);
