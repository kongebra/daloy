"use strict";
const { FuzzedDataProvider } = require("@jazzer.js/core");

// @daloyjs/core is ESM; load it once via a cached dynamic import.
let mod;
const load = () => (mod ||= import("../dist/ip-restriction.js"));

// parseIp normalizes an untrusted IPv4/IPv6 string and is documented to return
// undefined (never throw) on anything it does not recognize. Any thrown error
// is a real finding, so there is no try/catch here.
module.exports.fuzz = async function (data) {
  const { parseIp } = await load();
  const fdp = new FuzzedDataProvider(data);
  parseIp(fdp.consumeRemainingAsString());
};
