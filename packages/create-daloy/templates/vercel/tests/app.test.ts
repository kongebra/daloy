import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/index.ts";

test("Vercel Node.js handler responds through DaloyJS", async () => {
  // Vercel Node.js Functions invoke the default export's `fetch` method.
  const response = await handler.fetch(new Request("https://example.test/healthz"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).runtime, "vercel");
});

// Unhappy path: an unregistered route is rejected with 404 (problem+json).
test("unknown route returns 404", async () => {
  const response = await handler.fetch(new Request("https://example.test/__not_a_route__"));
  assert.equal(response.status, 404);
});
