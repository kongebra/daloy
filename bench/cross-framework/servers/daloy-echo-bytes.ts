// DaloyJS — raw-bytes echo server for the body-size sweep.
// POST /echo-bytes accepts application/octet-stream and returns
// { received: N } where N is the body length.
import { z } from "zod";
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({
  // Allow up to 8 MiB so the 4 MiB sweep point fits with headroom.
  bodyLimitBytes: 8 * 1024 * 1024,
});

app.route({
  method: "GET",
  path: "/health",
  operationId: "health",
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
  handler: async () => ({ status: 200, body: { ok: true } }),
});

app.route({
  method: "POST",
  path: "/echo-bytes",
  operationId: "echoBytes",
  // No schema body — we want raw bytes through readRawBody.
  responses: { 200: { description: "ok", body: z.object({ received: z.number() }) } },
  handler: async ({ request }) => {
    const buf = await request.arrayBuffer();
    return { status: 200, body: { received: buf.byteLength } };
  },
});

const port = Number(process.env.PORT ?? 3000);
const handle = serve(app, { port, hostname: "127.0.0.1" });
handle.server.once("listening", () => {
  process.stdout.write(`READY ${port}\n`);
});
