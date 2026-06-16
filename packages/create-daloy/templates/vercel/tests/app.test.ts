import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/[...path].ts";

test("Vercel Node.js handler responds through DaloyJS", async () => {
  // Vercel Node.js Functions invoke the default export's `fetch` method.
  const response = await handler.fetch(new Request("https://example.test/healthz"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).runtime, "vercel");
});
