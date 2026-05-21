import { readFile } from "node:fs/promises";

export interface ForbiddenLockfileSource {
  line: number;
  reason:
    | "git dependency source"
    | "non-registry tarball source"
    | "known-malicious package (Lazarus BeaverTail / InvisibleFerret)";
  text: string;
}

const GIT_SOURCE_PATTERN =
  /(?:specifier:\s*)?(?:github:|gitlab:|bitbucket:|gist:|git\+|git:\/\/|ssh:\/\/git@|git@github\.com:|git@gitlab\.com:|git@bitbucket\.org:)/i;
const TARBALL_PATTERN = /tarball:\s*(?<url>https?:\/\/[^}\s]+)/i;
const REGISTRY_TARBALL_PREFIX = "https://registry.npmjs.org/";

/**
 * Known-malicious npm package names that must NEVER appear in
 * Daloy's `pnpm-lock.yaml`, either as direct dependencies or as
 * resolved transitive deps.
 *
 * **Lazarus BeaverTail / InvisibleFerret (Socket 2025-03-10,
 * https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages):**
 * six typosquatted packages published by Lazarus-linked npm
 * aliases that embed BeaverTail (browser-credential + crypto-wallet
 * stealer) and download the InvisibleFerret backdoor as a
 * second-stage payload. The names mimic widely-trusted validator
 * libraries (`is-buffer-validator` typosquats Feross Aboukhadijeh's
 * `is-buffer`, etc.). At write time the packages remain live on
 * the npm registry pending removal — pinning the names here means
 * that a future PR that accidentally pulls one of them in (e.g. via
 * a transitive dep update) is rejected at CI before merge.
 *
 * The package list is conservative and exact-match only: it does
 * NOT touch the legitimate `is-buffer` package, only the typosquat
 * `is-buffer-validator`.
 */
const KNOWN_MALICIOUS_PACKAGES: ReadonlySet<string> = new Set([
  // Lazarus BeaverTail / InvisibleFerret (March 2025)
  "is-buffer-validator",
  "yoojae-validator",
  "event-handle-package",
  "array-empty-validator",
  "react-event-dependency",
  "auth-validator",
]);

/**
 * Match a pnpm-lock.yaml `packages:` key or `/<name>@<version>:`
 * snapshot key against the malicious-package blocklist. pnpm v9+
 * lockfile v9 uses keys like `'is-buffer-validator@1.0.0':` under
 * `packages:` and `snapshots:`, and a `name:` field under each
 * package entry. We grep all three shapes.
 */
function findMaliciousPackageOnLine(line: string): string | null {
  const trimmed = line.trim();
  // Pattern A: pnpm v9 lockfile key — `'name@version':` or `name@version:`
  //            with optional leading slash for v6 compatibility.
  const keyMatch =
    /^['"]?\/?(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)@[^:'"]+['"]?\s*:/i.exec(
      trimmed,
    );
  if (keyMatch) {
    const name = keyMatch[1]!;
    if (KNOWN_MALICIOUS_PACKAGES.has(name)) return name;
  }
  // Pattern B: explicit `name: <name>` field inside a package entry.
  const nameField = /^name:\s*['"]?(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)['"]?\s*$/i
    .exec(trimmed);
  if (nameField) {
    const name = nameField[1]!;
    if (KNOWN_MALICIOUS_PACKAGES.has(name)) return name;
  }
  // Pattern C: a dependency-map entry like `is-buffer-validator: 1.0.0`
  //            under `dependencies:` / `devDependencies:` / `specifiers:`.
  const depEntry =
    /^(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?):\s*[\^~]?[\d.]+/i.exec(trimmed);
  if (depEntry) {
    const name = depEntry[1]!;
    if (KNOWN_MALICIOUS_PACKAGES.has(name)) return name;
  }
  return null;
}

export function findForbiddenLockfileSources(lockfile: string): ForbiddenLockfileSource[] {
  const findings: ForbiddenLockfileSource[] = [];
  const lines = lockfile.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const text = rawLine.trim();
    if (GIT_SOURCE_PATTERN.test(text)) {
      findings.push({ line: index + 1, reason: "git dependency source", text });
      continue;
    }

    const tarball = TARBALL_PATTERN.exec(text)?.groups?.url;
    if (tarball && !tarball.startsWith(REGISTRY_TARBALL_PREFIX)) {
      findings.push({ line: index + 1, reason: "non-registry tarball source", text });
      continue;
    }

    const malicious = findMaliciousPackageOnLine(rawLine);
    if (malicious !== null) {
      findings.push({
        line: index + 1,
        reason: "known-malicious package (Lazarus BeaverTail / InvisibleFerret)",
        text,
      });
    }
  }
  return findings;
}

async function main(): Promise<void> {
  const lockfile = await readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
  const findings = findForbiddenLockfileSources(lockfile);
  if (findings.length === 0) return;

  for (const finding of findings) {
    console.error(`${finding.reason} on line ${finding.line}: ${finding.text}`);
  }
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify-lockfile-sources.ts")) {
  await main();
}
