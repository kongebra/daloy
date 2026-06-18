/**
 * Side-effect-free entry that exposes the bookstore example {@link App} as a
 * named `app` export.
 *
 * `examples/basic.ts` is the runnable demo — it calls `serve(...)` and boots an
 * HTTP listener as an import side effect. This file is import-only, so
 * `daloy inspect --check examples/app.ts` (run in CI) can load the app and
 * contract-check its OpenAPI surface without opening a port.
 */
import { buildExampleApp } from "./build-app.ts";

/** The bookstore example app, built once for inspection / contract tooling. */
export const app = buildExampleApp();
