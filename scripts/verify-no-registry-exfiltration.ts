/**
 * Registry-exfiltration / TLS-bypass / credential-injection CI gate
 * (Socket GemStuffer class).
 *
 * Socket's 2026-05-13 write-up
 * (https://socket.dev/blog/gemstuffer) documents the **GemStuffer**
 * campaign, in which a malicious Ruby script — using only the standard
 * library — exfiltrated scraped data by building a `.gem` archive in
 * `/tmp`, fabricating a credential file under a `HOME` override, and
 * publishing the archive directly to `rubygems.org/api/v1/gems` via a
 * hard-coded API key. SSL certificate verification was disabled to
 * suppress cert errors during the scraping phase. Variants that didn't
 * even shell out to `gem push` built the request by hand with
 * `Net::HTTP::Post`, defeating any "no shell-out" gate by staying inside
 * a single Ruby process.
 *
 * The same technique translates verbatim to a malicious Node package
 * that uses only `node:fs`, `node:os`, and the global `fetch`:
 *
 *   1. **TLS verification bypass** to scrape internal or victim-side
 *      endpoints without cert warnings —
 *      `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"`, or an
 *      `https.Agent({ rejectUnauthorized: false })`, or a `fetch` /
 *      `tls.connect` option of `rejectUnauthorized: false`.
 *   2. **`HOME` / npm-credential-file mutation** to inject a publish
 *      token into a fabricated home directory and then run `npm publish`
 *      / `pnpm publish` (already blocked by `verify-no-remote-exec`'s
 *      `child_process` ban) OR to leak a token from the consumer's real
 *      `~/.npmrc` by reading `os.homedir() + "/.npmrc"`.
 *   3. **Direct POST to a package-registry publish endpoint** — the
 *      "skip-the-CLI" GemStuffer variant translated to Node would
 *      construct a `fetch("https://registry.npmjs.org/-/npm/v1/...",
 *      { method: "POST", body: tarball })` (or the equivalent for
 *      RubyGems, PyPI, crates.io, Hex.pm) inside the runtime source
 *      itself. No `child_process` is needed; the entire exfil pipeline
 *      runs inside one Node process using only stdlib + global `fetch`.
 *
 * Daloy's runtime source (`src/**`) MUST NOT do any of the above. This
 * gate refuses to merge a PR that adds:
 *
 *   - `rejectUnauthorized: false` (any object-literal property
 *     assigning the literal `false` to `rejectUnauthorized`) — used by
 *     `https`, `tls`, `node-fetch`, `undici`, etc.
 *   - `NODE_TLS_REJECT_UNAUTHORIZED` as an environment-variable mutation
 *     target (`process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"`).
 *   - `process.env.HOME = ...` mutation (GemStuffer's HOME redirect).
 *   - String literals referencing the publish path of any major package
 *     registry: `registry.npmjs.org/-/npm/v1/...`, `rubygems.org/api/v1`,
 *     `upload.pypi.org`, `crates.io/api/v1/crates/new`, `hex.pm/api/...`.
 *   - Reads of `~/.npmrc`, `~/.yarnrc`, `~/.netrc`, `~/.gem/credentials`
 *     (host credential files the malicious package would slurp).
 *
 * This gate is the regression net for the GemStuffer attack class.
 * Combined with `verify-no-remote-exec` (no `child_process` / no `vm` /
 * no `eval` / no `new Function` / no remote dynamic `import`), a
 * malicious republish of `@daloyjs/core` has no in-process exfiltration
 * channel: it cannot shell out to `npm publish`, it cannot fetch an
 * internal endpoint with cert verification disabled, and it cannot POST
 * a tarball to a registry endpoint directly from runtime code.
 *
 * Exit code:
 *   0 — no forbidden primitives found in `src/**`.
 *   1 — at least one was found; offending lines printed to stderr.
 *
 * @since 0.50.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";

const SRC_ROOT = new URL("../src/", import.meta.url);

export interface ForbiddenRegistryExfilCall {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

interface ForbiddenPattern {
  readonly re: RegExp;
  readonly reason: string;
  /** When true the pattern is checked against the line WITH string literals
   *  intact (so host-name string matches still work). When false it is
   *  checked against the line with string literals stripped (so a doc
   *  string mentioning the pattern doesn't trip). */
  readonly keepStrings: boolean;
}

/**
 * Patterns that must NEVER appear in `src/**`. Documented inline against
 * the GemStuffer TTPs they would enable in a Node port of the attack.
 */
const FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  // ---- TLS verification bypass (GemStuffer's `VERIFY_NONE`) ----
  {
    re: /\brejectUnauthorized\s*:\s*false\b/,
    reason:
      "`rejectUnauthorized: false` disables TLS certificate validation (GemStuffer-class VERIFY_NONE); " +
      "use the system CA bundle and a real hostname instead",
    keepStrings: false,
  },
  {
    re: /\bNODE_TLS_REJECT_UNAUTHORIZED\b/,
    reason:
      "`NODE_TLS_REJECT_UNAUTHORIZED` mutation disables TLS certificate validation " +
      "process-wide (GemStuffer-class VERIFY_NONE); never set this from library code",
    keepStrings: true,
  },
  // ---- HOME / credential-file mutation (GemStuffer's HOME override) ----
  {
    // `process.env.HOME =` (assignment, not read). Use a negative
    // lookahead for `==` / `===` so equality comparisons don't trip.
    re: /\bprocess\.env\.HOME\s*=(?!=)/,
    reason:
      "`process.env.HOME = ...` redirects the home directory and is the GemStuffer " +
      "credential-injection primitive; library code must never mutate HOME",
    keepStrings: false,
  },
  // ---- Direct POST to a package-registry publish endpoint ----
  // The full publish-path literals below are the actual exfiltration
  // endpoints — a runtime mention of any of them inside `src/**` is a
  // strong IOC of the "POST tarball to registry from inside the
  // process" variant. The bare host names (e.g. just `registry.npmjs.org`)
  // are NOT blocked — clients legitimately reference registry hosts in
  // user-facing docs / error messages — only the publish API paths.
  {
    re: /registry\.npmjs\.org\/-\/npm\/v1\//,
    reason:
      "npm publish-API path in source can exfiltrate data as a tarball POST (GemStuffer class); " +
      "Daloy never publishes from runtime — remove this string",
    keepStrings: true,
  },
  {
    re: /rubygems\.org\/api\/v1\/gems\b/,
    reason:
      "RubyGems publish-API path in source can exfiltrate data as a `.gem` POST (GemStuffer class); " +
      "Daloy never publishes from runtime — remove this string",
    keepStrings: true,
  },
  {
    re: /upload\.pypi\.org\/legacy/,
    reason:
      "PyPI publish-API path in source can exfiltrate data as a wheel POST (GemStuffer class); " +
      "Daloy never publishes from runtime — remove this string",
    keepStrings: true,
  },
  {
    re: /crates\.io\/api\/v1\/crates\/new\b/,
    reason:
      "crates.io publish-API path in source can exfiltrate data as a crate POST (GemStuffer class); " +
      "Daloy never publishes from runtime — remove this string",
    keepStrings: true,
  },
  // ---- Reads of host credential files ----
  {
    re: /\/\.npmrc\b/,
    reason:
      "library code must not reference `~/.npmrc`; GemStuffer-class attacks slurp host npm tokens " +
      "from the user's home directory",
    keepStrings: true,
  },
  {
    re: /\/\.yarnrc(?:\.yml)?\b/,
    reason:
      "library code must not reference `~/.yarnrc` / `~/.yarnrc.yml`; GemStuffer-class attacks slurp " +
      "host yarn tokens from the user's home directory",
    keepStrings: true,
  },
  {
    re: /\/\.netrc\b/,
    reason:
      "library code must not reference `~/.netrc`; GemStuffer-class attacks slurp host HTTP " +
      "credentials from the user's home directory",
    keepStrings: true,
  },
  {
    re: /\/\.gem\/credentials\b/,
    reason:
      "library code must not reference `~/.gem/credentials`; this is the exact path GemStuffer " +
      "writes a fabricated RubyGems token to",
    keepStrings: true,
  },
];

const STRING_LITERAL_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

/**
 * Find the start index of a line comment (`//`) that is NOT inside a
 * string literal. Mirrors the helper in `verify-no-remote-exec.ts` so
 * URLs embedded in string literals (`"https://..."`) aren't mistakenly
 * truncated as line comments.
 */
function findLineCommentStart(s: string): number {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      i++;
      continue;
    }
    if (inSingle) {
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      continue;
    }
    if (inBacktick) {
      if (c === "`") inBacktick = false;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === "`") {
      inBacktick = true;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") return i;
  }
  return -1;
}

export function findForbiddenRegistryExfilCalls(
  file: string,
  source: string,
): readonly ForbiddenRegistryExfilCall[] {
  const out: ForbiddenRegistryExfilCall[] = [];
  const lines = source.split(/\r?\n/);
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    let working = raw;
    if (inBlockComment) {
      const end = working.indexOf("*/");
      if (end < 0) continue;
      working = working.slice(end + 2);
      inBlockComment = false;
    }
    const blockOpen = working.lastIndexOf("/*");
    const blockClose = working.lastIndexOf("*/");
    if (blockOpen >= 0 && blockClose < blockOpen) {
      working = working.slice(0, blockOpen);
      inBlockComment = true;
    }
    // Strip inline block comments (`/* ... */` on the same line) before
    // the line-comment scan so a token inside an inline block comment
    // does not trip the gate.
    working = working.replace(/\/\*[\s\S]*?\*\//g, " ");
    const lineCommentIndex = findLineCommentStart(working);
    const noComments = lineCommentIndex >= 0 ? working.slice(0, lineCommentIndex) : working;
    if (noComments.trim().length === 0) continue;

    const codeOnly = noComments.replace(STRING_LITERAL_RE, '""');
    for (const pattern of FORBIDDEN_PATTERNS) {
      const haystack = pattern.keepStrings ? noComments : codeOnly;
      if (pattern.re.test(haystack)) {
        out.push({ file, line: i + 1, text: raw.trim(), reason: pattern.reason });
        break;
      }
    }
  }
  return out;
}

async function* walk(dir: URL): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) {
      yield* walk(child);
    } else if (entry.isFile() && /\.(?:m?ts|m?js)$/.test(entry.name)) {
      yield child.pathname;
    }
  }
}

async function main(): Promise<void> {
  let total = 0;
  try {
    await stat(SRC_ROOT);
  } catch (err) {
    console.error(
      `verify-no-registry-exfiltration: cannot stat src/: ${(err as Error).message}`,
    );
    process.exitCode = 1;
    return;
  }
  for await (const absolute of walk(SRC_ROOT)) {
    const rel = "src/" + relative(SRC_ROOT.pathname, absolute);
    const text = await readFile(absolute, "utf8");
    const findings = findForbiddenRegistryExfilCalls(rel, text);
    for (const f of findings) {
      console.error(
        `${f.file}:${f.line}: forbidden registry-exfiltration primitive (${f.reason}): ${f.text}`,
      );
      total++;
    }
  }
  if (total > 0) {
    console.error(
      `verify-no-registry-exfiltration: ${total} forbidden primitive${total === 1 ? "" : "s"} found. ` +
        "Core source must not disable TLS verification, mutate HOME, reference host credential " +
        "files, or include package-registry publish-API paths. These are the runtime primitives " +
        "the GemStuffer class of supply-chain attack uses to scrape and exfiltrate data through a " +
        "public package registry. See https://socket.dev/blog/gemstuffer.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-registry-exfiltration.ts")) {
  await main();
}
