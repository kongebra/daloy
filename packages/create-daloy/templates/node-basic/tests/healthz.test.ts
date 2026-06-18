import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/build-app.ts";

// In-process tests via `app.request(...)` — no port, no network.
test("GET /healthz returns 200", async () => {
  const app = buildApp();
  const res = await app.request("/healthz");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean };
  assert.equal(body.ok, true);
});

// Unhappy path: an unregistered route is rejected with 404 (problem+json).
test("unknown route returns 404", async () => {
  const app = buildApp();
  const res = await app.request("/__not_a_route__");
  assert.equal(res.status, 404);
});
