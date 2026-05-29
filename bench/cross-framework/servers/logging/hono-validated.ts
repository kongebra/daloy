// Hono with the same Zod schemas as servers/logging/daloy.ts, plus one
// structured access log per completed response. This exists so the logging
// bench can compare daloy-with-validation against hono-with-validation, not
// daloy-with-validation against hono-without — counting Zod cost on one side
// and not the other is a fairness bug.
//
// Validation is done inline (no @hono/zod-validator dep) so the comparison is
// strictly Zod cost vs Zod cost, not middleware-stack cost vs hand-rolled.
import { z } from "zod";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { accessLogStart, writeAccessLog } from "./access-log";

const paramsSchema = z.object({ id: z.string() });
const echoSchema = z.object({ name: z.string() });

const app = new Hono();

app.use("*", async (c, next) => {
  const startedAt = accessLogStart();
  await next();
  writeAccessLog("hono-validated", c.req.method, c.req.path, c.res.status, startedAt);
});

app.get("/static", (c) => c.json({ ok: true }));

app.get("/users/:id", (c) => {
  const parsed = paramsSchema.safeParse({ id: c.req.param("id") });
  if (!parsed.success) return c.json({ error: "bad" }, 400);
  return c.json({ id: parsed.data.id });
});

app.post("/echo", async (c) => {
  const raw = await c.req.json();
  const parsed = echoSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad" }, 400);
  return c.json({ name: parsed.data.name });
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  process.stdout.write(`READY ${port}\n`);
});
