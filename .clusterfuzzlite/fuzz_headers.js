"use strict";
const { FuzzedDataProvider } = require("@jazzer.js/core");
const { rethrowIfUnexpected } = require("./_guard.js");

// @daloyjs/core is ESM; load it once via a cached dynamic import.
let mod;
const load = () => (mod ||= import("../dist/security.js"));

// sanitizeHeaderName (RFC 7230 token grammar) and sanitizeHeaderValue (CR/LF/
// NUL rejection) are the header-injection guards. Both are documented to throw
// BadRequestError on illegal input. The fuzzer additionally asserts that any
// value sanitizeHeaderValue ACCEPTS truly contains no CR/LF/NUL byte.
module.exports.fuzz = async function (data) {
  const { sanitizeHeaderName, sanitizeHeaderValue } = await load();
  const fdp = new FuzzedDataProvider(data);
  const candidate = fdp.consumeRemainingAsString();

  try {
    sanitizeHeaderName(candidate);
  } catch (err) {
    rethrowIfUnexpected(err, ["BadRequestError"]);
  }

  try {
    const accepted = sanitizeHeaderValue(candidate);
    if (/[\r\n\0]/.test(accepted)) {
      throw new Error("sanitizeHeaderValue accepted a CR/LF/NUL value");
    }
  } catch (err) {
    rethrowIfUnexpected(err, ["BadRequestError"]);
  }
};
