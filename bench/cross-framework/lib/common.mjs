// Shared helpers for the bench scripts.
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(__dirname);

export const DEFAULT_PORT = 3456;

export function machineInfo() {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    totalMemGiB: +(os.totalmem() / 1024 ** 3).toFixed(2),
    loadAvg: os.loadavg(),
    onBattery: undefined, // populated below if powerstate is available
  };
}

export function parseArgs(argv) {
  return Object.fromEntries(
    argv.slice(2)
      .filter((a) => a.startsWith("--"))
      .map((a) => {
        const [k, v] = a.replace(/^--/, "").split("=");
        return [k, v ?? "true"];
      }),
  );
}

export function startServer(file, { port = DEFAULT_PORT, extraEnv = {}, readyTimeoutMs = 20_000 } = {}) {
  const child = spawn(
    process.execPath,
    ["--no-warnings", "--import", "tsx", path.join(ROOT, file)],
    {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), NODE_ENV: "production", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return new Promise((resolve, reject) => {
    let resolved = false;
    let stderrBuf = "";
    const onStdout = (buf) => {
      if (resolved) return;
      if (buf.toString().includes(`READY ${port}`)) {
        resolved = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", (buf) => { stderrBuf += buf.toString(); });
    child.once("exit", (code) => {
      if (!resolved) {
        reject(new Error(`Server exited with code ${code} before READY.\nstderr: ${stderrBuf}`));
      }
    });
    setTimeout(() => {
      if (!resolved) {
        try { child.kill("SIGKILL"); } catch {}
        reject(new Error(`Server did not emit READY within ${readyTimeoutMs}ms.\nstderr: ${stderrBuf}`));
      }
    }, readyTimeoutMs);
  });
}

export async function killServer(child) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((r) => child.once("exit", () => r(true))),
    wait(3_000, false),
  ]);
  if (!exited) child.kill("SIGKILL");
  await wait(250);
}

// Population stats. Operates on a numeric array.
export function stats(xs) {
  if (xs.length === 0) return { n: 0 };
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median,
    stddev: Math.sqrt(variance),
  };
}

export function pct(xs, p) {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// HTTP GET with timeout. Returns { status, body } or throws.
export async function httpRequest(url, { method = "GET", headers = {}, body, timeoutMs = 5_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, body: text, headers: Object.fromEntries(res.headers) };
  } finally {
    clearTimeout(t);
  }
}

// Wait for a server to respond 200 to a probe URL. Used as a soft readiness check.
export async function waitForHealthy(port, pathOk = "/static", { timeoutMs = 10_000, headers } = {}) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await httpRequest(`http://127.0.0.1:${port}${pathOk}`, { timeoutMs: 1_000, headers });
      if (r.status === 200) return Date.now() - start;
    } catch (e) {
      lastErr = e;
    }
    await wait(20);
  }
  throw new Error(`Server not healthy within ${timeoutMs}ms: ${lastErr?.message ?? "(no response)"}`);
}

// Format a number with thousands separator.
export function fmt(n) {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}
