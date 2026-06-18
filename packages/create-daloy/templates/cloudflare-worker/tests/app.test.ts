import assert from "node:assert/strict";
import test from "node:test";
import handler from "../src/index.ts";

// Cloudflare Workers invoke the default export's `fetch(request, env?, ctx?)`.
// env / ctx are optional, so a plain Request is enough for in-process tests.
test("GET /healthz returns 200", async () => {
  const res = await handler.fetch(new Request("https://example.test/healthz"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; runtime: string };
  assert.equal(body.ok, true);
  assert.equal(body.runtime, "cloudflare-worker");
});

// Unhappy path: an unregistered route is rejected with 404 (problem+json).
test("unknown route returns 404", async () => {
  const res = await handler.fetch(new Request("https://example.test/__not_a_route__"));
  assert.equal(res.status, 404);
});
