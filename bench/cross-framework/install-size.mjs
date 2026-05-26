#!/usr/bin/env node
// Install size: walks each framework's package tree under node_modules and
// reports total file size + file count + direct + transitive dep count.
//
// Methodology: for each framework, we ask `pnpm why` / read its package.json
// to find its top-level package, then recursively sum every file under that
// package and its transitive deps (skipping symlinks-to-elsewhere and
// duplicated content via pnpm's content-addressable store).
//
// Usage:
//   node install-size.mjs
//   node install-size.mjs --only=daloy

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { __dirname, ROOT, machineInfo, parseArgs, fmt } from "./lib/common.mjs";

const FRAMEWORKS = [
  { name: "daloy",    pkg: "@daloyjs/core" },
  // { name: "hono",     pkg: "hono" },
  // { name: "fastify",  pkg: "fastify" },
  // { name: "express",  pkg: "express" },
  // { name: "koa",      pkg: "koa" },
  // { name: "nest",     pkg: "@nestjs/core" },
  // { name: "elysia",   pkg: "elysia" },
  // { name: "feathers", pkg: "@feathersjs/feathers" },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;

function findPackageRoot(pkgName) {
  // Look in this folder's node_modules.
  const direct = path.join(ROOT, "node_modules", pkgName);
  if (existsSync(direct)) return realpathSync(direct);
  return null;
}

function walkSize(dir, seen = new Set()) {
  let bytes = 0;
  let files = 0;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return { bytes, files }; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    let real;
    try { real = realpathSync(p); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    let st;
    try { st = statSync(real); } catch { continue; }
    if (st.isDirectory()) {
      const sub = walkSize(real, seen);
      bytes += sub.bytes;
      files += sub.files;
    } else if (st.isFile()) {
      bytes += st.size;
      files += 1;
    }
  }
  return { bytes, files };
}

function collectDeps(pkgRoot, allDeps = new Set(), depth = 0) {
  if (depth > 50) return allDeps; // safety bound
  let pkg;
  try { pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8")); }
  catch { return allDeps; }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
  for (const name of Object.keys(deps)) {
    if (allDeps.has(name)) continue;
    // Skip optional peers that aren't installed.
    const candidate = findPackageRoot(name);
    if (!candidate) continue;
    allDeps.add(name);
    collectDeps(candidate, allDeps, depth + 1);
  }
  return allDeps;
}

function measure(pkgName) {
  const root = findPackageRoot(pkgName);
  if (!root) throw new Error(`package ${pkgName} not found under ${ROOT}/node_modules`);
  const direct = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const directDeps = Object.keys({ ...(direct.dependencies ?? {}), ...(direct.peerDependencies ?? {}) });
  const transitive = collectDeps(root);
  // Total bytes = own bytes + every transitive dep's bytes.
  let totalBytes = 0;
  let totalFiles = 0;
  const ownSeen = new Set();
  const own = walkSize(root, ownSeen);
  totalBytes += own.bytes;
  totalFiles += own.files;
  for (const dep of transitive) {
    const depRoot = findPackageRoot(dep);
    if (!depRoot) continue;
    const w = walkSize(depRoot, new Set());
    totalBytes += w.bytes;
    totalFiles += w.files;
  }
  return {
    pkg: pkgName,
    version: direct.version,
    ownBytes: own.bytes,
    ownFiles: own.files,
    totalBytes,
    totalFiles,
    directDepCount: directDeps.length,
    transitiveDepCount: transitive.size,
  };
}

async function main() {
  const targets = FRAMEWORKS.filter((f) => !ONLY || ONLY.has(f.name));
  const rows = [];
  for (const fw of targets) {
    try {
      const r = measure(fw.pkg);
      rows.push({ framework: fw.name, ...r });
      console.error(`${fw.name.padEnd(10)} v${r.version}  ` +
        `own=${(r.ownBytes / 1024).toFixed(1)} KiB / ${r.ownFiles} files  ` +
        `total=${(r.totalBytes / 1024).toFixed(1)} KiB / ${r.totalFiles} files  ` +
        `deps=${r.directDepCount} direct / ${r.transitiveDepCount} transitive`);
    } catch (err) {
      console.error(`✗ ${fw.name}: ${err.message}`);
      rows.push({ framework: fw.name, error: err.message });
    }
  }

  const lines = [
    "| Framework  | own (KiB) | own files | total (KiB) | total files | direct deps | transitive deps |",
    "| ---------- | --------: | --------: | ----------: | ----------: | ----------: | --------------: |",
  ];
  for (const r of rows) {
    if (!r.totalBytes) continue;
    lines.push(
      `| ${r.framework.padEnd(10)} `
      + `| ${fmt(r.ownBytes / 1024).padStart(9)} `
      + `| ${fmt(r.ownFiles).padStart(9)} `
      + `| ${fmt(r.totalBytes / 1024).padStart(11)} `
      + `| ${fmt(r.totalFiles).padStart(11)} `
      + `| ${fmt(r.directDepCount).padStart(11)} `
      + `| ${fmt(r.transitiveDepCount).padStart(15)} |`,
    );
  }
  console.log("\n" + lines.join("\n") + "\n");

  writeFileSync(
    path.join(__dirname, "results.install-size.json"),
    JSON.stringify({ ranAt: new Date().toISOString(), machine: machineInfo(), rows }, null, 2),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
