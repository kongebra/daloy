"use strict";
const { FuzzedDataProvider } = require("@jazzer.js/core");

// @daloyjs/core is ESM; load it once via a cached dynamic import.
let mod;
const load = () => (mod ||= import("../dist/cookie.js"));

// readRequestCookie parses an untrusted Cookie header and is documented to
// NEVER throw — it returns string | null, swallowing percent-decode errors and
// rejecting cookie-tossing duplicates. Any thrown error is therefore a genuine
// finding, so there is no try/catch here: let it propagate to the fuzzer.
module.exports.fuzz = async function (data) {
  const { readRequestCookie } = await load();
  const fdp = new FuzzedDataProvider(data);
  const header = fdp.consumeString(fdp.consumeIntegralInRange(0, 8192));
  const name = fdp.consumeRemainingAsString();
  readRequestCookie(header, name);
};
