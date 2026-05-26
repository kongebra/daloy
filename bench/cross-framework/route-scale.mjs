#!/usr/bin/env node
// Route-scale benchmark: register N routes and hit one of them.
// Exposes how router lookup cost scales with the routing table size.
//
// Usage:
//   node route-scale.mjs
//   node route-scale.mjs --only=daloy --routes=500

import { writeFileSync } from "node:fs";
import path from "node:path";
import autocannon from "autocannon";
import {
  __dirname, machineInfo, parseArgs,
  startServer, killServer, waitForHealthy, stats, fmt,
} from "./lib/common.mjs";

const FRAMEWORKS = [
  { name: "daloy", file: "servers/daloy-scale.ts" },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const DURATION = Number(process.env.DURATION ?? 10);
const WARMUP = Number(process.env.WARMUP ?? 10);
const ITERATIONS = Number(process.env.ITERATIONS ?? 3);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 100);
const PORT = 3560;
const ROUTE_COUNTS = (args.routes ? args.routes.split(",") : ["10", "100", "500", "2000"]).map(Number);

function runAutocannon({ duration, urlPath }) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: `http://127.0.0.1:${PORT}${urlPath}`,
      connections: CONNECTIONS,
      pipelining: 1,
      duration,
    }, (err, result) => err ? reject(err) : resolve(result));
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });
}

async function benchOneCount(fw, routeCount) {
  console.error(`\n=== ${fw.name} (${routeCount} routes) ===`);
  const child = await startServer(fw.file, { port: PORT, extraEnv: { ROUTE_COUNT: String(routeCount) } });
  await waitForHealthy(PORT, "/r/0");
  try {
    // Hit the *last* registered route so trie/list traversal pays its full cost.
    const lastIdx = routeCount - 1;
    const urlPath = `/r/${lastIdx}`;
    await runAutocannon({ duration: WARMUP, urlPath });
    const samples = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const r = await runAutocannon({ duration: DURATION, urlPath });
      samples.push({ reqPerSec: r.requests.average, p99: r.latency.p99 });
    }
    const rps = stats(samples.map((s) => s.reqPerSec));
    const p99 = samples.reduce((a, s) => a + s.p99, 0) / samples.length;
    console.error(`  median ${fmt(rps.median).padStart(8)} req/s  p99 ${p99.toFixed(2)}ms`);
    return { routeCount, reqPerSec: rps, p99, samples };
  } finally {
    await killServer(child);
  }
}

async function main() {
  const targets = FRAMEWORKS.filter((f) => !ONLY || ONLY.has(f.name));
  const rows = [];
  for (const fw of targets) {
    const series = [];
    for (const rc of ROUTE_COUNTS) {
      try {
        series.push(await benchOneCount(fw, rc));
      } catch (err) {
        console.error(`  ✗ ${fw.name} @ ${rc} routes: ${err.message}`);
        series.push({ routeCount: rc, error: err.message });
      }
    }
    rows.push({ framework: fw.name, series });
  }

  const lines = [
    "| Framework  | routes | req/s (median) | p99 (ms) |",
    "| ---------- | -----: | -------------: | -------: |",
  ];
  for (const r of rows) {
    for (const s of r.series) {
      if (s.error) {
        lines.push(`| ${r.framework.padEnd(10)} | ${String(s.routeCount).padStart(6)} | ${"ERR".padStart(14)} | ${"—".padStart(8)} |`);
      } else {
        lines.push(
          `| ${r.framework.padEnd(10)} `
          + `| ${String(s.routeCount).padStart(6)} `
          + `| ${fmt(s.reqPerSec.median).padStart(14)} `
          + `| ${s.p99.toFixed(2).padStart(8)} |`,
        );
      }
    }
  }
  console.log("\n" + lines.join("\n") + "\n");

  writeFileSync(
    path.join(__dirname, "results.route-scale.json"),
    JSON.stringify({
      ranAt: new Date().toISOString(),
      machine: machineInfo(),
      config: { duration: DURATION, warmup: WARMUP, iterations: ITERATIONS, connections: CONNECTIONS, routeCounts: ROUTE_COUNTS },
      rows,
    }, null, 2),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
