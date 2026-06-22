"use strict";
const { FuzzedDataProvider } = require("@jazzer.js/core");
const { rethrowIfUnexpected } = require("./_guard.js");

// @daloyjs/core is ESM; load it once via a cached dynamic import.
let mod;
const load = () => (mod ||= import("../dist/scheduler.js"));

// parseCron parses an untrusted 5-field cron expression (and @aliases).
// Documented to throw CronParseError on anything malformed; any other throw —
// or a hang on a pathological range/step field — is a finding.
module.exports.fuzz = async function (data) {
  const { parseCron } = await load();
  const fdp = new FuzzedDataProvider(data);
  const expr = fdp.consumeRemainingAsString();
  try {
    parseCron(expr);
  } catch (err) {
    rethrowIfUnexpected(err, ["CronParseError"]);
  }
};
