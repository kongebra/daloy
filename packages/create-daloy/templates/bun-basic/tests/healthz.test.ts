import { describe, expect, test } from "bun:test";
import { buildApp } from "../src/build-app.ts";

describe("buildApp", () => {
  test("GET /healthz returns 200", async () => {
    const app = buildApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; runtime: string };
    expect(body.ok).toBe(true);
    expect(body.runtime).toBe("bun");
  });

  // Unhappy path: an unregistered route is rejected with 404 (problem+json).
  test("unknown route returns 404", async () => {
    const app = buildApp();
    const res = await app.request("/__not_a_route__");
    expect(res.status).toBe(404);
  });
});
