#!/usr/bin/env node
// Bundle size: produces a minimal "hello world" app per framework, bundles
// it with esbuild for the neutral platform, and reports raw + gzipped size.
// Useful for edge/serverless deployment targets where bundle size dominates
// cold-start time and may hit a platform cap (e.g. 1 MiB on free tiers).
//
// Usage:
//   node bundle-size.mjs
//   node bundle-size.mjs --only=daloy

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import os from "node:os";
import { build } from "esbuild";
import { __dirname, ROOT, machineInfo, parseArgs, fmt } from "./lib/common.mjs";

// Each entry is a minimal source string. Keep them comparable: one route
// each, no extras. We let esbuild resolve from this folder's node_modules.
const FRAMEWORKS = [
  {
    name: "daloy",
    src: `
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
const app = new App();
app.route({
  method: "GET", path: "/", operationId: "h",
  responses: { 200: { description: "ok", body: undefined as any } },
  handler: async () => ({ status: 200, body: { ok: true } }),
});
serve(app, { port: 3000 });
`,
  },
  // {
  //   name: "hono",
  //   src: `
  //     import { Hono } from "hono";
  //     import { serve } from "@hono/node-server";
  //     const app = new Hono();
  //     app.get("/", (c) => c.json({ ok: true }));
  //     serve({ fetch: app.fetch, port: 3000 });
  //   `,
  // },
  // { name: "fastify", src: `import Fastify from "fastify"; const f = Fastify(); f.get("/", async () => ({ ok: true })); f.listen({ port: 3000 });` },
  // { name: "express", src: `import express from "express"; const a = express(); a.get("/", (_, r) => r.json({ ok: true })); a.listen(3000);` },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;

async function bundleOne(fw) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), `bench-bundle-${fw.name}-`));
  try {
    const entry = path.join(tmp, "entry.ts");
    const outfile = path.join(tmp, "out.mjs");
    writeFileSync(entry, fw.src.trim());
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      minify: true,
      platform: "node",
      format: "esm",
      target: ["es2022"],
      // Bundle everything that isn't a Node built-in. node:* modules ship
      // with the runtime and shouldn't be counted in the framework's size.
      external: ["node:*"],
      logLevel: "silent",
      nodePaths: [path.join(ROOT, "node_modules")],
      absWorkingDir: ROOT,
    });
    const bytes = readFileSync(outfile);
    return {
      raw: bytes.length,
      gzipped: gzipSync(bytes, { level: 9 }).length,
    };
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const targets = FRAMEWORKS.filter((f) => !ONLY || ONLY.has(f.name));
  const rows = [];
  for (const fw of targets) {
    try {
      const r = await bundleOne(fw);
      rows.push({ framework: fw.name, ...r });
      console.error(`${fw.name.padEnd(10)} raw=${(r.raw / 1024).toFixed(1)} KiB  gz=${(r.gzipped / 1024).toFixed(1)} KiB`);
    } catch (err) {
      console.error(`✗ ${fw.name}: ${err.message}`);
      rows.push({ framework: fw.name, error: err.message });
    }
  }

  const lines = [
    "| Framework  | raw (KiB) | gzipped (KiB) |",
    "| ---------- | --------: | ------------: |",
  ];
  for (const r of rows) {
    if (!r.raw) continue;
    lines.push(`| ${r.framework.padEnd(10)} | ${fmt(r.raw / 1024).padStart(9)} | ${fmt(r.gzipped / 1024).padStart(13)} |`);
  }
  console.log("\n" + lines.join("\n") + "\n");

  writeFileSync(
    path.join(__dirname, "results.bundle-size.json"),
    JSON.stringify({ ranAt: new Date().toISOString(), machine: machineInfo(), rows }, null, 2),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
