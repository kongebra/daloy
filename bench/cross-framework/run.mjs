#!/usr/bin/env node
// Cross-framework HTTP benchmark runner.
// See ./README.md for methodology.
//
// Usage:
//   node run.mjs
//   node run.mjs --only=daloy,fastify,hono
//   DURATION=20 CONNECTIONS=200 node run.mjs

import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import autocannon from "autocannon";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FRAMEWORKS = [
  { name: "daloy",    file: "servers/daloy.ts" },
  // { name: "hono",     file: "servers/hono.ts" },
  // { name: "fastify",  file: "servers/fastify.ts" },
  // { name: "express",  file: "servers/express.ts" },
  // { name: "koa",      file: "servers/koa.ts" },
  // { name: "nest",     file: "servers/nest.ts" },
  // { name: "elysia",   file: "servers/elysia.ts" },
  // { name: "feathers", file: "servers/feathers.ts" },
];

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "true"];
    }),
);

const ONLY = args.only ? new Set(args.only.split(",")) : null;
const DURATION = Number(process.env.DURATION ?? 10);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 100);
const PIPELINING = Number(process.env.PIPELINING ?? 1);
const WARMUP_SECONDS = 5;
const ITERATIONS = 3;
const PORT = 3456;

const SCENARIOS = [
  { id: "static",   title: "GET /static",     method: "GET",  path: "/static" },
  { id: "dynamic",  title: "GET /users/:id",  method: "GET",  path: "/users/42" },
  { id: "echo",     title: "POST /echo",      method: "POST", path: "/echo",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "alice" }) },
];

function startServer(file) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", path.join(__dirname, file)],
    {
      cwd: __dirname,
      env: { ...process.env, PORT: String(PORT), NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return new Promise((resolve, reject) => {
    let resolved = false;
    const onData = (buf) => {
      if (resolved) return;
      if (buf.toString().includes(`READY ${PORT}`)) {
        resolved = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    // Suppress framework log spam but surface real crashes.
    let stderrBuf = "";
    child.stderr.on("data", (buf) => {
      stderrBuf += buf.toString();
    });
    child.once("exit", (code) => {
      if (!resolved) {
        reject(new Error(`Server exited with code ${code} before READY.\nstderr: ${stderrBuf}`));
      }
    });
    setTimeout(() => {
      if (!resolved) {
        try { child.kill("SIGKILL"); } catch {}
        reject(new Error(`Server did not emit READY within 15s.\nstderr: ${stderrBuf}`));
      }
    }, 15_000);
  });
}

async function killServer(child) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((r) => child.once("exit", () => r(true))),
    wait(3_000, false),
  ]);
  if (!exited) child.kill("SIGKILL");
  // Give the kernel a moment to release the port.
  await wait(250);
}

function runAutocannon(scenario, duration) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: `http://127.0.0.1:${PORT}${scenario.path}`,
      method: scenario.method,
      headers: scenario.headers,
      body: scenario.body,
      connections: CONNECTIONS,
      pipelining: PIPELINING,
      duration,
    }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    // No live progress bar — we want clean output.
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });
}

async function benchOne(fw) {
  console.error(`\n=== ${fw.name} ===`);
  const child = await startServer(fw.file);
  try {
    const results = {};
    for (const sc of SCENARIOS) {
      // Warmup (discarded).
      await runAutocannon(sc, WARMUP_SECONDS);
      const samples = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const r = await runAutocannon(sc, DURATION);
        samples.push({
          reqPerSec: r.requests.average,
          p99: r.latency.p99,
          nonExpectedStatusCodes: r.non2xx,
        });
      }
      const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
      results[sc.id] = {
        reqPerSec: mean(samples.map((s) => s.reqPerSec)),
        p99: mean(samples.map((s) => s.p99)),
        non2xx: samples.reduce((a, b) => a + b.nonExpectedStatusCodes, 0),
        samples,
      };
      console.error(
        `  ${sc.title.padEnd(20)} ${results[sc.id].reqPerSec.toFixed(0).padStart(10)} req/s   p99 ${results[sc.id].p99.toFixed(2)}ms`
        + (results[sc.id].non2xx ? `  ⚠ ${results[sc.id].non2xx} non-2xx` : ""),
      );
    }
    return results;
  } finally {
    await killServer(child);
  }
}

function renderTable(rows) {
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const lines = [
    "| Framework  | GET /static (req/s) | GET /users/:id (req/s) | POST /echo (req/s) | p99 /static (ms) |",
    "| ---------- | ------------------: | ---------------------: | -----------------: | ---------------: |",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.framework.padEnd(10)} `
      + `| ${fmt(r.results.static.reqPerSec).padStart(19)} `
      + `| ${fmt(r.results.dynamic.reqPerSec).padStart(22)} `
      + `| ${fmt(r.results.echo.reqPerSec).padStart(18)} `
      + `| ${r.results.static.p99.toFixed(2).padStart(16)} |`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const targets = FRAMEWORKS.filter((f) => !ONLY || ONLY.has(f.name));
  const rows = [];
  for (const fw of targets) {
    try {
      const results = await benchOne(fw);
      rows.push({ framework: fw.name, results });
    } catch (err) {
      console.error(`  ✗ ${fw.name} failed: ${err.message}`);
      rows.push({ framework: fw.name, error: err.message });
    }
  }

  const ok = rows.filter((r) => r.results);
  const table = renderTable(ok);
  console.log("\n" + table + "\n");

  writeFileSync(
    path.join(__dirname, "results.json"),
    JSON.stringify({
      ranAt: new Date().toISOString(),
      node: process.version,
      duration: DURATION,
      connections: CONNECTIONS,
      pipelining: PIPELINING,
      iterations: ITERATIONS,
      rows,
    }, null, 2),
  );
  console.error(`Wrote results.json (${ok.length}/${rows.length} frameworks OK).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
