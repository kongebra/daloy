"use strict";
const { FuzzedDataProvider } = require("@jazzer.js/core");
const { rethrowIfUnexpected } = require("./_guard.js");

// @daloyjs/core is ESM; load it once via a cached dynamic import.
let mod;
const load = () => (mod ||= import("../dist/pagination.js"));

// decodeCursor base64url-decodes + JSON-parses an untrusted pagination cursor
// and strips prototype-pollution keys. Documented to throw BadRequestError on
// malformed/oversized input; nothing else should escape.
module.exports.fuzz = async function (data) {
  const { decodeCursor } = await load();
  const fdp = new FuzzedDataProvider(data);
  const cursor = fdp.consumeRemainingAsString();
  try {
    decodeCursor(cursor);
  } catch (err) {
    rethrowIfUnexpected(err, ["BadRequestError"]);
  }
};
