/**
 * Bookstore example — end-to-end typed client with **inferred** types.
 *
 * Run:
 *   pnpm install
 *   pnpm example
 *
 * Then:
 *   curl http://localhost:3000/books/1
 *   open  http://localhost:3000/docs
 *
 * To generate a Hey API typed SDK from this app's contract:
 *   pnpm gen
 */

import { serve } from "../src/adapters/node.ts";
import { createClient } from "../src/client.ts";
import { printStartupBanner } from "../src/banner.ts";
import { buildExampleApp } from "./build-app.ts";

// `buildExampleApp()` returns an App whose per-route tuple is INFERRED (the
// factory neither annotates `: App` nor splits the `.route(...)` chain), so the
// typed client below needs no cast: `getBookById` / `createBook`, their inputs,
// and their per-status response unions are all derived from the route
// definitions. `docs: true` on the factory auto-mounts GET /docs (Scalar UI)
// and GET /openapi.json.
const app = buildExampleApp();

const { port, close } = serve(app, { port: 3000 });
printStartupBanner({
  name: "DaloyJS Bookstore",
  url: `http://localhost:${port}`,
  runtime: "Node.js",
  links: [{ label: "Docs", url: `http://localhost:${port}/docs` }],
});

// In-process typed client — fully inferred, NO cast.
const client = createClient(app, { baseUrl: `http://localhost:${port}` });

setTimeout(async () => {
  // `params.id` is typed `string` — passing `{ id: 1 }` is a compile error.
  const found = await client.getBookById({ params: { id: "1" } });
  if (found.status === 200) {
    // Inside this branch `found.body` is typed `{ id: string; title: string }`.
    console.log("getBookById  ->", found.status, found.body.title);
  } else {
    console.log("getBookById  ->", found.status);
  }

  // `body` is typed `{ id: string; title: string }`; the bearer token the route
  // requires is sent as a per-call header. `params: {}` is required even though
  // `/books` has no path params — the client input contract is inferred exactly
  // from the route, which is the whole point: it cannot drift from the server.
  const created = await client.createBook({
    params: {},
    body: { id: "3", title: "Neuromancer" },
    headers: { authorization: "Bearer demo-token" },
  });
  if (created.status === 201) {
    console.log("createBook   ->", created.status, created.body.title);
  } else {
    console.log("createBook   ->", created.status);
  }

  await close();
}, 250);
