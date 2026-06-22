"use strict";

/**
 * Rethrow an error unless it is one the function under test is *documented* to
 * throw. Fuzzing should only flag UNEXPECTED crashes: a declared rejection
 * (e.g. `BadRequestError` on malformed input) is correct behavior, not a bug.
 *
 * @param {unknown} err - The thrown value.
 * @param {string[]} expectedNames - Allowed `error.name` values to swallow.
 * @throws Re-throws `err` when its name is not in `expectedNames`.
 */
function rethrowIfUnexpected(err, expectedNames) {
  const name =
    err && typeof err === "object"
      ? err.name || (err.constructor && err.constructor.name)
      : undefined;
  if (typeof name === "string" && expectedNames.includes(name)) return;
  throw err;
}

module.exports = { rethrowIfUnexpected };
