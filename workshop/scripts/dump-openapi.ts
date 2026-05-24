/**
 * Dumps the OpenAPI 3.1 document of a currently-running workshop exercise
 * to ./generated/openapi.json so Hey API can codegen against it.
 *
 * Usage (in a second terminal while an exercise is serving):
 *   pnpm dev:4:5         # terminal A
 *   pnpm gen:openapi     # terminal B (this script)
 *
 * Docs: https://daloyjs.dev/docs/openapi
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const url = process.env.OPENAPI_URL ?? "http://localhost:3000/openapi.json";
const outPath = "./generated/openapi.json";

const res = await fetch(url);
if (!res.ok) {
  console.error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  console.error("Is a workshop exercise running on port 3000?");
  process.exit(1);
}

const spec = await res.json();
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(spec, null, 2), "utf8");
console.log(`Wrote ${outPath}`);
