// DaloyJS — large streaming response. GET /stream returns a ~10 MiB body
// chunked through a ReadableStream so we can measure the streaming pipeline.
import { z } from "zod";
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App();

const CHUNK = new Uint8Array(64 * 1024).fill(0x61); // 64 KiB of 'a'
const TOTAL_CHUNKS = 160; // ~10 MiB total

app.route({
  method: "GET",
  path: "/health",
  operationId: "health",
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
  handler: async () => ({ status: 200, body: { ok: true } }),
});

app.route({
  method: "GET",
  path: "/stream",
  operationId: "stream",
  responses: {
    200: {
      description: "ok",
      // body declared as undefined since we're emitting a raw stream.
      body: undefined as never,
    },
  },
  handler: async () => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= TOTAL_CHUNKS) {
          controller.close();
          return;
        }
        controller.enqueue(CHUNK);
        sent++;
      },
    });
    return {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
      body,
    };
  },
});

const port = Number(process.env.PORT ?? 3000);
const handle = serve(app, { port, hostname: "127.0.0.1" });
handle.server.once("listening", () => {
  process.stdout.write(`READY ${port}\n`);
});
