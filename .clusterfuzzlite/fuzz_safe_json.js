"use strict";
const { FuzzedDataProvider } = require("@jazzer.js/core");
const { rethrowIfUnexpected } = require("./_guard.js");

// @daloyjs/core is ESM; load it once via a cached dynamic import.
let mod;
const load = () => (mod ||= import("../dist/security.js"));

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Assert no prototype-pollution key survived as an OWN enumerable property at
 * any depth of the parsed result.
 *
 * @param {unknown} value - Parsed value to inspect.
 * @param {number} depth - Current recursion depth (bounded to avoid hangs).
 */
function assertNoForbiddenKeys(value, depth) {
  if (depth > 50 || value === null || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN.has(key)) {
      throw new Error(`prototype-pollution key survived safeJsonParse: ${key}`);
    }
    assertNoForbiddenKeys(value[key], depth + 1);
  }
}

// safeJsonParse is the prototype-pollution-safe JSON gate. It is documented to
// throw BadRequestError on invalid JSON and to strip __proto__/constructor/
// prototype keys. The fuzzer asserts it never throws anything else and never
// returns an object carrying a forbidden own key.
module.exports.fuzz = async function (data) {
  const { safeJsonParse } = await load();
  const fdp = new FuzzedDataProvider(data);
  const text = fdp.consumeRemainingAsString();
  let parsed;
  try {
    parsed = safeJsonParse(text);
  } catch (err) {
    rethrowIfUnexpected(err, ["BadRequestError"]);
    return;
  }
  assertNoForbiddenKeys(parsed, 0);
};
