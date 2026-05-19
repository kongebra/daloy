/**
 * `daloy inspect` — CLI inspector.
 *
 * Loads a user's `App` instance from an entry file and prints its routes,
 * schema summary, dead routes, missing operationIds, or the full OpenAPI
 * 3.1 document.
 *
 * Pure logic lives in `runCli` so it can be unit-tested without spawning
 * a child process. The thin shim in `bin/daloy.mjs` wires this up to
 * `process.argv`, `process.stdout`, dynamic `import()`, and `process.exit`.
 */

import type { App, IntrospectedRoute } from "./app.js";
import { runContractTests } from "./contract.js";
import { generateOpenAPI } from "./openapi.js";
import type { RouteDefinition, RouteMeta } from "./types.js";

export interface CliIO {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  /** Resolve a user-provided entry specifier to a module to import. */
  importEntry: (specifier: string) => Promise<unknown>;
  /** Version string surfaced by `--version`. */
  version: string;
  /**
   * Spawn a child process and resolve with its exit code. Required for
   * `daloy dev`; optional so unit tests that only exercise `inspect`
   * can omit it.
   */
  spawn?: (command: string, args: readonly string[]) => Promise<number>;
  /**
   * Override runtime detection (defaults to inspecting `globalThis.process.versions`).
   * Mainly exists for tests.
   */
  detectRuntime?: () => DevRuntime;
}

export interface CliResult {
  exitCode: number;
}

export interface CliOptions {
  json: boolean;
  check: boolean;
  schemas: boolean;
  openapi: boolean;
  ai: boolean;
  tag?: string;
  method?: string;
  entry?: string;
  help: boolean;
  version: boolean;
  /** Override runtime detection for `daloy dev`. */
  runtime?: DevRuntime;
}

const HELP = `daloy — DaloyJS CLI

Usage:
  daloy <command> [options] [entry]

Commands:
  inspect [entry]        Load an App and print its routes (default command).
  dev     [entry]        Start the entry file with the host runtime's
                         native watch mode (tsx --watch on Node, --hot on
                         Bun, --watch on Deno).

Options:
  --json                 Print machine-readable JSON instead of a table.
  --check                Run the contract test suite; exit 1 on errors.
  --schemas              Include per-route schema presence (body/query/...).
  --openapi              Print the OpenAPI 3.1 document for the App.
  --ai                   Print an AI/codegen-friendly JSON dump of the
                         route catalog with schemas and meta examples
                         (suitable for feeding to an LLM or for writing
                         to a sibling routes.json).
  --tag <tag>            Only show routes that declare this tag.
  --method <method>      Only show routes for this HTTP method.
  --runtime <r>          (dev) Force the runtime: node | bun | deno.
                         Useful from package.json scripts where the CLI
                         shebang would otherwise always select Node.
  -h, --help             Show this help.
  -v, --version          Print the @daloyjs/core version this CLI ships from.

Entry:
  For inspect: a path to a JS or TS file that exports an App instance,
  either as the default export or as a named export called "app". Modules
  may also export a zero-argument buildApp() or createApp() factory.
  Defaults to ./src/app.ts, ./src/app.js, ./src/build-app.ts,
  ./src/build-app.js, ./app.ts, ./app.js, ./build-app.ts, ./build-app.js.

  For dev: a path to the runnable entry (e.g. ./src/index.ts that calls
  serve()). Defaults to ./src/index.ts, ./src/main.ts, ./src/server.ts,
  ./src/app.ts, ./index.ts, ./main.ts, ./server.ts, ./app.ts.

Examples:
  daloy inspect
  daloy inspect --json src/server.ts
  daloy inspect --check
  daloy inspect --openapi > openapi.json
  daloy dev
  daloy dev src/server.ts
`;

const DEFAULT_ENTRIES: string[] = [
  "src/app.ts",
  "src/app.js",
  "src/build-app.ts",
  "src/build-app.js",
  "app.ts",
  "app.js",
  "build-app.ts",
  "build-app.js",
];

const DEFAULT_DEV_ENTRIES: string[] = [
  "src/index.ts",
  "src/main.ts",
  "src/server.ts",
  "src/app.ts",
  "src/index.js",
  "src/main.js",
  "src/server.js",
  "src/app.js",
  "index.ts",
  "main.ts",
  "server.ts",
  "app.ts",
  "index.js",
  "main.js",
  "server.js",
  "app.js",
];

/** Runtime detected for `daloy dev`. */
export type DevRuntime = "node" | "bun" | "deno";

/**
 * Detect which JS runtime is hosting the CLI. Inspects
 * `globalThis.process.versions` for Bun/Deno markers; falls back to Node.
 *
 * @since 0.3.0
 */
export function detectRuntime(): DevRuntime {
  const proc = (globalThis as { process?: { versions?: Record<string, unknown> } }).process;
  const v = proc?.versions ?? {};
  if (v.bun) return "bun";
  if (v.deno) return "deno";
  return "node";
}

/**
 * Build the `(command, args)` pair `daloy dev` should spawn for the given
 * runtime and entry file. Pure function so tests can assert exact argv
 * without spawning a child process.
 *
 * - Node: `node --import tsx --watch <entry>` (tsx must be installed as a
 *   dev dependency for TS files; .js entries also work).
 * - Bun:  `bun --hot <entry>` (Bun ships with TS support).
 * - Deno: `deno run --watch --allow-net --allow-env --allow-read <entry>`
 *   (the three permissions cover serving HTTP, reading env vars, and
 *   reading the source tree; users who need more should run `deno run`
 *   directly).
 *
 * @since 0.3.0
 */
export function buildDevCommand(runtime: DevRuntime, entry: string): { command: string; args: string[] } {
  switch (runtime) {
    case "bun":
      return { command: "bun", args: ["--hot", entry] };
    case "deno":
      return {
        command: "deno",
        args: ["run", "--watch", "--allow-net", "--allow-env", "--allow-read", entry],
      };
    case "node":
    default:
      return { command: "node", args: ["--import", "tsx", "--watch", entry] };
  }
}

/**
 * Pick the first existing dev entry. Unlike `loadApp` we can't `import()`
 * to probe (we'd execute the user's server twice) so we rely on the file
 * system via `node:fs` when available; on edge runtimes we just return the
 * first candidate.
 */
async function resolveDevEntry(entry: string | undefined): Promise<string> {
  if (entry) return entry;
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const proc = (globalThis as { process?: { cwd?: () => string } }).process;
    const cwd = proc?.cwd?.() ?? ".";
    for (const candidate of DEFAULT_DEV_ENTRIES) {
      if (fs.existsSync(path.join(cwd, candidate))) return candidate;
    }
  } catch {
    /* fall through */
  }
  throw new Error(
    `Could not find a dev entry. Tried: ${DEFAULT_DEV_ENTRIES.join(", ")}.\n` +
      `Pass an explicit path: daloy dev ./src/server.ts`
  );
}

export function parseArgs(argv: readonly string[]): { command: string; opts: CliOptions } {
  const opts: CliOptions = {
    json: false,
    check: false,
    schemas: false,
    openapi: false,
    ai: false,
    help: false,
    version: false,
  };
  let command = "inspect";
  let i = 0;
  if (argv[0] === "inspect" || argv[0] === "dev" || argv[0] === "help") {
    command = argv[0];
    i = 1;
  }
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    switch (a) {
      case "--json":
        opts.json = true;
        break;
      case "--check":
        opts.check = true;
        break;
      case "--schemas":
        opts.schemas = true;
        break;
      case "--openapi":
        opts.openapi = true;
        break;
      case "--ai":
        opts.ai = true;
        break;
      case "--tag":
        opts.tag = readFlagValue(argv, ++i, "--tag");
        break;
      case "--method":
        opts.method = readFlagValue(argv, ++i, "--method").toUpperCase();
        break;
      case "--runtime": {
        const value = readFlagValue(argv, ++i, "--runtime").toLowerCase();
        if (value !== "node" && value !== "bun" && value !== "deno") {
          throw new Error(`--runtime must be one of: node, bun, deno (got: ${value})`);
        }
        opts.runtime = value;
        break;
      }
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-v":
      case "--version":
        opts.version = true;
        break;
      default:
        if (a.startsWith("-")) {
          throw new Error(`Unknown flag: ${a}`);
        }
        opts.entry = a;
    }
  }
  return { command, opts };
}

function readFlagValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export async function runCli(argv: readonly string[], io: CliIO): Promise<CliResult> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    io.stderr(`${(err as Error).message}\n\n${HELP}`);
    return { exitCode: 2 };
  }
  const { command, opts } = parsed;
  if (opts.help || command === "help") {
    io.stdout(HELP);
    return { exitCode: 0 };
  }
  if (opts.version) {
    io.stdout(`${io.version}\n`);
    return { exitCode: 0 };
  }
  if (command === "dev") {
    return runDev(opts, io);
  }
  if (command !== "inspect") {
    io.stderr(`Unknown command: ${command}\n\n${HELP}`);
    return { exitCode: 2 };
  }

  let app: App;
  try {
    app = await loadApp(opts.entry, io);
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`);
    return { exitCode: 1 };
  }

  if (opts.openapi) {
    const doc = generateOpenAPI(app, {
      info: { title: "App", version: "0.0.0" },
    });
    io.stdout(`${JSON.stringify(doc, null, opts.json ? 0 : 2)}\n`);
    return { exitCode: 0 };
  }

  if (opts.ai) {
    const dump = buildAiDump(app, opts);
    io.stdout(`${JSON.stringify(dump, null, opts.json ? 0 : 2)}\n`);
    return { exitCode: 0 };
  }

  const all = app.introspect();
  const routes = filterRoutes(all, opts);

  const issues = opts.check ? await runContractTests(app) : undefined;

  if (opts.json) {
    const payload: Record<string, unknown> = { routes };
    if (issues) payload.contract = issues;
    io.stdout(`${JSON.stringify(payload, null, 2)}\n`);
    return { exitCode: issues && !issues.ok ? 1 : 0 };
  }

  io.stdout(formatTable(routes, opts.schemas));

  if (issues) {
    io.stdout(`\n${formatContract(issues)}`);
    if (!issues.ok) return { exitCode: 1 };
  }
  return { exitCode: 0 };
}

function filterRoutes(routes: IntrospectedRoute[], opts: CliOptions): IntrospectedRoute[] {
  return routes
    .filter(
      (r) =>
        (!opts.method || r.method === opts.method) &&
        (!opts.tag || effectiveTags(r).includes(opts.tag)),
    )
    .map((r) => {
      const tags = effectiveTags(r);
      return tags.length > 0 ? { ...r, tags } : r;
    });
}

function effectiveTags(route: IntrospectedRoute): string[] {
  return dedupeTags(route.tags, route.meta?.tags);
}

function formatTable(routes: IntrospectedRoute[], includeSchemas: boolean): string {
  if (routes.length === 0) {
    return "No routes registered (or none matched the filter).\n";
  }
  const header = includeSchemas
    ? ["METHOD", "PATH", "OPERATION ID", "B/Q/P/H", "RESPONSES", "TAGS"]
    : ["METHOD", "PATH", "OPERATION ID", "RESPONSES", "TAGS"];
  const rows: string[][] = [header];
  for (const r of routes) {
    const opId = r.operationId ?? "-";
    const tags = effectiveTags(r).join(",") || "-";
    const responses = r.responses.length === 0 ? "-" : r.responses.sort((a, b) => a - b).join(",");
    if (includeSchemas) {
      const flags = `${r.hasBody ? "B" : "-"}${r.hasQuery ? "Q" : "-"}${r.hasParams ? "P" : "-"}${r.hasHeaders ? "H" : "-"}`;
      rows.push([r.method, r.path, opId, flags, responses, tags]);
    } else {
      rows.push([r.method, r.path, opId, responses, tags]);
    }
  }
  const widths = header.map((_, col) => Math.max(...rows.map((row) => (row[col] ?? "").length)));
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const line = row.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join("  ");
    out.push(line.trimEnd());
    if (i === 0) out.push(widths.map((w) => "-".repeat(w)).join("  "));
  }
  out.push("");
  out.push(`${routes.length} route${routes.length === 1 ? "" : "s"}.`);
  return `${out.join("\n")}\n`;
}

function formatContract(report: Awaited<ReturnType<typeof runContractTests>>): string {
  const out: string[] = [];
  const errors = report.issues.filter((i) => i.level === "error");
  const warnings = report.issues.filter((i) => i.level === "warning");
  out.push(
    `Contract checks: ${report.checked} route${report.checked === 1 ? "" : "s"} · ` +
      `${errors.length} error${errors.length === 1 ? "" : "s"} · ` +
      `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
  );
  for (const issue of report.issues) {
    out.push(`  [${issue.level}] ${issue.route}: ${issue.message}`);
  }
  if (report.ok) out.push("OK.");
  else out.push("FAIL.");
  return `${out.join("\n")}\n`;
}

async function runDev(opts: CliOptions, io: CliIO): Promise<CliResult> {
  if (!io.spawn) {
    io.stderr(
      "daloy dev requires a spawn-capable host (use the bundled bin/daloy.mjs CLI).\n"
    );
    return { exitCode: 2 };
  }
  let entry: string;
  try {
    entry = await resolveDevEntry(opts.entry);
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`);
    return { exitCode: 1 };
  }
  const runtime = opts.runtime ?? (io.detectRuntime ?? detectRuntime)();
  const { command, args } = buildDevCommand(runtime, entry);
  io.stdout(`daloy dev: ${runtime} → ${command} ${args.join(" ")}\n`);
  try {
    const code = await io.spawn(command, args);
    return { exitCode: code };
  } catch (err) {
    io.stderr(`daloy dev: failed to start: ${(err as Error).message}\n`);
    return { exitCode: 1 };
  }
}

/**
 * Build the `daloy inspect --ai` payload: the registered route catalog
 * paired with JSON-Schema dumps of every request/response schema and any
 * `meta.examples` declared on the route. The payload is intentionally
 * stable and self-describing so LLMs and SDK builders can consume it
 * without round-tripping through OpenAPI.
 *
 * @since 0.14.0
 */
export function buildAiDump(app: App, opts: CliOptions): Record<string, unknown> {
  const introspected = filterRoutes(app.introspect(), opts);
  const indexById = new Map<string, IntrospectedRoute>();
  for (const r of introspected) indexById.set(`${r.method} ${r.path}`, r);

  const routes: Record<string, unknown>[] = [];
  for (const def of app.routes as RouteDefinition[]) {
    const id = `${def.method} ${def.path}`;
    if (!indexById.has(id)) continue;
    const meta: RouteMeta | undefined = (def as { meta?: RouteMeta }).meta;
    const entry: Record<string, unknown> = {
      method: def.method,
      path: def.path,
      ...(def.operationId ? { operationId: def.operationId } : {}),
      ...(def.summary ?? meta?.summary
        ? { summary: def.summary ?? meta?.summary }
        : {}),
      ...(def.description ?? meta?.description
        ? { description: def.description ?? meta?.description }
        : {}),
      tags: dedupeTags(def.tags, meta?.tags),
      ...(def.deprecated ? { deprecated: true } : {}),
      ...(def.auth ? { auth: def.auth } : {}),
      request: aiRequest(def.request),
      responses: aiResponses(def.responses),
    };
    if (meta?.examples) entry.examples = meta.examples;
    if (meta?.extensions) entry.extensions = meta.extensions;
    routes.push(entry);
  }

  return {
    daloy: { ai: 1 },
    generatedAt: new Date().toISOString(),
    routeCount: routes.length,
    routes,
  };
}

function dedupeTags(a: string[] | undefined, b: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...(a ?? []), ...(b ?? [])]) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function aiRequest(req: RouteDefinition["request"]): Record<string, unknown> {
  if (!req) return {};
  const out: Record<string, unknown> = {};
  for (const part of ["params", "query", "headers", "body"] as const) {
    const schema = req[part];
    if (schema) out[part] = aiSchema(schema);
  }
  return out;
}

function aiResponses(
  responses: RouteDefinition["responses"]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [status, spec] of Object.entries(responses)) {
    if (!spec) continue;
    const entry: Record<string, unknown> = { description: spec.description };
    if (spec.body) entry.body = aiSchema(spec.body);
    if (spec.examples) entry.examples = spec.examples;
    out[status] = entry;
  }
  return out;
}

function aiSchema(schema: unknown): unknown {
  const anySchema = schema as { toJSONSchema?: () => unknown };
  if (typeof anySchema?.toJSONSchema === "function") {
    try {
      return anySchema.toJSONSchema();
    } catch {
      /* fall through */
    }
  }
  return {};
}

async function loadApp(entry: string | undefined, io: CliIO): Promise<App> {
  const candidates = entry ? [entry] : DEFAULT_ENTRIES.slice();
  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      const mod = (await io.importEntry(candidate)) as Record<string, unknown>;
      const app = pickApp(mod);
      if (app) return app;
      lastErr = new Error(
        `Loaded "${candidate}" but it did not export an App instance ` +
          `or a zero-argument buildApp()/createApp() factory.`
      );
    } catch (err) {
      lastErr = err;
    }
  }
  if (entry) {
    throw new Error(
      `Could not load App from "${entry}": ${(lastErr as Error)?.message ?? String(lastErr)}`
    );
  }
  throw new Error(
    `Could not find an App entry. Tried: ${DEFAULT_ENTRIES.join(", ")}.\n` +
      `Pass an explicit path: daloy inspect ./path/to/app.ts`
  );
}

function pickApp(mod: Record<string, unknown>): App | undefined {
  for (const key of ["default", "app", "default_app"]) {
    const candidate = mod[key];
    if (isApp(candidate)) return candidate;
  }
  const factory = pickAppFactory(mod);
  if (factory) {
    const candidate = factory();
    if (isApp(candidate)) return candidate;
  }
  // Fallback: scan all named exports.
  for (const value of Object.values(mod)) {
    if (isApp(value)) return value;
  }
  return undefined;
}

function pickAppFactory(mod: Record<string, unknown>): (() => unknown) | undefined {
  for (const key of ["buildApp", "createApp"]) {
    const candidate = mod[key];
    if (isZeroArgFactory(candidate)) return candidate;
  }
  const defaultExport = mod.default;
  if (isNamedFactory(defaultExport, ["buildApp", "createApp"])) {
    return defaultExport;
  }
  return undefined;
}

function isZeroArgFactory(value: unknown): value is () => unknown {
  return typeof value === "function" && value.length === 0;
}

function isNamedFactory(value: unknown, names: readonly string[]): value is () => unknown {
  return isZeroArgFactory(value) && names.includes((value as Function).name);
}

function isApp(value: unknown): value is App {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { routes?: unknown }).routes) &&
    typeof (value as { introspect?: unknown }).introspect === "function" &&
    typeof (value as { fetch?: unknown }).fetch === "function"
  );
}
