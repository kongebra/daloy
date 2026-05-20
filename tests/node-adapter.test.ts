import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { App } from "../src/index.js";
import { serve as serveNode } from "../src/adapters/node.js";

async function startServer(app: App, opts: Parameters<typeof serveNode>[1] = {}) {
  const handle = serveNode(app, { port: 0, handleSignals: false, ...opts });
  await once(handle.server, "listening");
  const port = (handle.server.address() as AddressInfo).port;
  return { handle, port };
}

function buildEchoApp(): App {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/hello",
    operationId: "hello",
    responses: { 200: { description: "ok", body: z.object({ msg: z.string() }) as any } },
    handler: async () => ({ status: 200 as const, body: { msg: "hi" } }),
  });
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "echoPost",
    request: { body: z.object({ value: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ value: z.string() }) as any } },
    handler: async ({ body }) => ({ status: 200 as const, body: body as { value: string } }),
  });
  app.route({
    method: "GET",
    path: "/url",
    operationId: "url",
    responses: { 200: { description: "ok", body: z.object({ url: z.string() }) as any } },
    handler: async ({ request }) => ({ status: 200 as const, body: { url: request.url } }),
  });
  app.route({
    method: "GET",
    path: "/multi",
    operationId: "multi",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async ({ request }) => ({
      status: 200 as const,
      body: { ok: request.headers.get("x-multi")?.includes(",") ?? false },
    }),
  });
  return app;
}

test("node adapter: GET request flows through toWebRequest and sendWebResponse", async () => {
  const { handle, port } = await startServer(buildEchoApp());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/hello`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { msg: "hi" });
  } finally {
    await handle.close();
  }
});

test("node adapter: POST forwards request body via Readable.toWeb", async () => {
  const { handle, port } = await startServer(buildEchoApp());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "payload" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { value: "payload" });
  } finally {
    await handle.close();
  }
});

test("node adapter: trustProxy honors x-forwarded-host and x-forwarded-proto", async () => {
  const { handle, port } = await startServer(buildEchoApp(), { trustProxy: true });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/url`, {
      headers: { "x-forwarded-host": "proxied.example, real.example", "x-forwarded-proto": "https" },
    });
    const body = (await res.json()) as { url: string };
    assert.match(body.url, /^https:\/\/proxied\.example\/url$/);
  } finally {
    await handle.close();
  }
});

test("node adapter: trustProxy off ignores x-forwarded-* headers", async () => {
  const { handle, port } = await startServer(buildEchoApp(), { trustProxy: false });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/url`, {
      headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
    });
    const body = (await res.json()) as { url: string };
    assert.match(body.url, /^http:\/\/127\.0\.0\.1/);
  } finally {
    await handle.close();
  }
});

test("node adapter: 404 fall-through and array-valued request headers", async () => {
  const { handle, port } = await startServer(buildEchoApp());
  try {
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(missing.status, 404);
    const res = await fetch(`http://127.0.0.1:${port}/multi`, {
      headers: { "x-multi": "first, second" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await handle.close();
  }
});

test("node adapter: adapter error path returns 500 problem+json", async () => {
  const app = new App({
    logger: false,
    hooks: {
      onSend: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("stream boom"));
            },
          }),
        ),
    },
  });
  app.route({
    method: "GET",
    path: "/boom",
    operationId: "boom",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const { handle, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/boom`);
    assert.equal(res.status, 500);
    assert.equal(res.headers.get("content-type"), "application/problem+json");
    const body = (await res.json()) as { title: string };
    assert.equal(body.title, "Internal Server Error");
  } finally {
    await handle.close();
  }
});

test("node adapter: rejects invalid maxHeaderBytes", () => {
  assert.throws(
    () => serveNode(new App({ logger: false }), { maxHeaderBytes: -1, handleSignals: false }),
    /maxHeaderSize|range|out of range/i,
  );
});

test("node adapter: handleSignals registers SIGTERM/SIGINT listeners", async () => {
  const app = new App({ logger: false });
  const beforeT = process.listenerCount("SIGTERM");
  const beforeI = process.listenerCount("SIGINT");
  const { handle } = await startServer(app, { handleSignals: true });
  try {
    assert.ok(process.listenerCount("SIGTERM") > beforeT);
    assert.ok(process.listenerCount("SIGINT") > beforeI);
  } finally {
    await handle.close();
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  }
});

test("node adapter: SIGTERM handler triggers close and exit", async () => {
  // Save originals
  const origExit = process.exit;
  const origTermListeners = process.listeners("SIGTERM");
  const origIntListeners = process.listeners("SIGINT");
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
  let exitCode: number | undefined;
  (process as { exit: (c?: number) => void }).exit = ((c?: number) => {
    exitCode = c;
  }) as never;
  try {
    const app = new App({ logger: false });
    const { handle } = await startServer(app, { handleSignals: true });
    const termListener = process.listeners("SIGTERM").slice(-1)[0] as () => void;
    const intListener = process.listeners("SIGINT").slice(-1)[0] as () => void;
    termListener();
    // Wait for close().then(exit) microtasks
    await new Promise<void>((r) => setTimeout(r, 50));
    assert.equal(exitCode, 0);
    // Calling SIGINT after close is also safe (close is idempotent)
    exitCode = undefined;
    intListener();
    await new Promise<void>((r) => setTimeout(r, 50));
    assert.equal(exitCode, 0);
    void handle; // already closed
  } finally {
    (process as { exit: typeof origExit }).exit = origExit;
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    for (const l of origTermListeners) process.on("SIGTERM", l as () => void);
    for (const l of origIntListeners) process.on("SIGINT", l as () => void);
  }
});

test("node adapter: double close() is a no-op", async () => {
  const app = new App({ logger: false });
  const { handle } = await startServer(app);
  await handle.close();
  await handle.close();
});
