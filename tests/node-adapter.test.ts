import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { connect, type AddressInfo } from "node:net";
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

test("node adapter: maxConnections forwards to server.maxConnections", async () => {
  const { handle, port } = await startServer(buildEchoApp(), { maxConnections: 5 });
  try {
    assert.equal(handle.server.maxConnections, 5);
    // Admitted requests still succeed normally under the cap.
    const res = await fetch(`http://127.0.0.1:${port}/hello`);
    assert.equal(res.status, 200);
  } finally {
    await handle.close();
  }
});

test("node adapter: maxConnections sheds overflow sockets while admitted ones stay served", async () => {
  // Cap at a single concurrent connection, then hold it open with a slow
  // handler. A second connection must be refused at accept time (ECONNRESET /
  // ECONNREFUSED) instead of being queued — that is the graceful-degradation
  // contract: overflow is rejected fast rather than inflating tail latency.
  const app = new App({ logger: false });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  app.route({
    method: "GET",
    path: "/slow",
    operationId: "slow",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => { await gate; return { status: 200 as const, body: { ok: true } }; },
  });
  const { handle, port } = await startServer(app, { maxConnections: 1 });
  try {
    // First connection occupies the only allowed socket (kept open by `gate`).
    const slow = fetch(`http://127.0.0.1:${port}/slow`, {
      headers: { connection: "keep-alive" },
    });
    // Give the first socket time to be accepted before opening the second.
    await new Promise((r) => setTimeout(r, 50));
    // Second connection should be rejected at the socket layer.
    await assert.rejects(
      fetch(`http://127.0.0.1:${port}/slow`, { headers: { connection: "close" } }),
      /fetch failed|ECONNRESET|ECONNREFUSED|socket/i,
    );
    // The admitted request still completes successfully once released.
    release();
    const res = await slow;
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    release();
    await handle.close();
  }
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

/**
 * Open a raw socket, send partial request headers that never terminate, and
 * report how long until the server reaps the stalled connection. `trickle`
 * keeps dribbling header bytes (the evasive slowloris variant); otherwise the
 * socket goes idle after the partial preamble.
 */
function slowlorisReapMs(port: number, opts: { trickle: boolean; deadlineMs: number }): Promise<number | null> {
  return new Promise((resolve) => {
    const sock = connect(port, "127.0.0.1");
    const t0 = Date.now();
    let timer: ReturnType<typeof setInterval> | undefined;
    let done = false;
    const finish = (reaped: boolean) => {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(reaped ? Date.now() - t0 : null);
    };
    sock.on("connect", () => {
      sock.write("GET /hello HTTP/1.1\r\nHost: t\r\n"); // never sends the terminating blank line
      if (opts.trickle) {
        let i = 0;
        timer = setInterval(() => {
          try {
            sock.write(`X-Drip-${i++}: keep\r\n`);
          } catch {
            /* socket gone */
          }
        }, 200);
      }
    });
    // The server hanging up on us (close/end) or replying 408 = reaped.
    sock.on("close", () => finish(true));
    sock.on("end", () => finish(true));
    sock.on("data", () => finish(true));
    sock.on("error", () => finish(true));
    setTimeout(() => finish(false), opts.deadlineMs);
  });
}

test("node adapter: a stalled (idle) slowloris connection is reaped near the configured timeout", async () => {
  const app = buildEchoApp();
  // Short timeout → the adapter must tune connectionsCheckingInterval so the
  // timeout is actually enforced. Without that fix, Node's default 30s checker
  // leaves the socket open for ~30s and this assertion times out.
  const { handle, port } = await startServer(app, { connectionTimeoutMs: 800 });
  try {
    const ms = await slowlorisReapMs(port, { trickle: false, deadlineMs: 6000 });
    assert.ok(ms !== null, "the idle stalled connection must be reaped, not held open");
    assert.ok(ms! < 5000, `reaped in ${ms}ms — well under the default 30s checker interval`);
  } finally {
    await handle.close();
  }
});

test("node adapter: connectionTimeoutMs: 0 disables the request/header timeouts", async () => {
  const app = buildEchoApp();
  const { handle } = await startServer(app, { connectionTimeoutMs: 0 });
  try {
    assert.equal(handle.server.requestTimeout, 0, "requestTimeout disabled");
    assert.equal(handle.server.headersTimeout, 0, "headersTimeout disabled");
  } finally {
    await handle.close();
  }
});

test("node adapter: an active-trickle slowloris (bytes dribbled forever) is still reaped", async () => {
  const app = buildEchoApp();
  const { handle, port } = await startServer(app, { connectionTimeoutMs: 800 });
  try {
    const ms = await slowlorisReapMs(port, { trickle: true, deadlineMs: 6000 });
    assert.ok(ms !== null, "trickling bytes must not let the connection evade the header timeout");
    assert.ok(ms! < 5000, `trickle slowloris reaped in ${ms}ms`);
  } finally {
    await handle.close();
  }
});
