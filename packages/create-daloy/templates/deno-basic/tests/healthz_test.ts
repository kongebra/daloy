import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { buildApp } from "../src/build-app.ts";

Deno.test("GET /healthz returns 200", async () => {
  const app = buildApp();
  const res = await app.request("/healthz");
  assertEquals(res.status, 200);
  const body = (await res.json()) as { ok: boolean; runtime: string };
  assertEquals(body.ok, true);
  assertEquals(body.runtime, "deno");
});

// Unhappy path: an unregistered route is rejected with 404 (problem+json).
Deno.test("unknown route returns 404", async () => {
  const app = buildApp();
  const res = await app.request("/__not_a_route__");
  assertEquals(res.status, 404);
});
