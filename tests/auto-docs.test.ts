import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, createApp, _resetPackageJsonCacheForTests } from "../src/index.js";

function withRoute(app: App): App {
  app.route({
    method: "GET",
    path: "/books/:id",
    operationId: "getBookById",
    tags: ["Books"],
    request: { params: z.object({ id: z.string() }) as any },
    responses: {
      200: {
        description: "Found",
        body: z.object({ id: z.string(), title: z.string() }) as any,
      },
    },
    handler: async ({ params }) => ({
      status: 200 as const,
      body: { id: (params as any).id, title: "Test" },
    }),
  });
  return app;
}

test("docs option is off by default: /docs and /openapi.json are not registered", async () => {
  const app = withRoute(new App({ logger: false }));
  const ids = app.introspect().map((r) => r.operationId).sort();
  assert.deepEqual(ids, ["getBookById"]);
  const docs = await app.request("/docs");
  assert.equal(docs.status, 404);
  const spec = await app.request("/openapi.json");
  assert.equal(spec.status, 404);
});

test("docs: true mounts /docs (scalar by default) and /openapi.json", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: true,
      openapi: { info: { title: "Bookstore API", version: "1.0.0" } },
    }),
  );

  const spec = await app.request("/openapi.json");
  assert.equal(spec.status, 200);
  const json: any = await spec.json();
  assert.equal(json.openapi, "3.1.0");
  assert.equal(json.info.title, "Bookstore API");
  assert.equal(json.info.version, "1.0.0");
  // User route appears in the generated spec.
  assert.ok(json.paths["/books/{id}"]);
  // Auto-mounted routes appear too, with the default "Docs" tag.
  assert.ok(json.paths["/openapi.json"]);
  assert.ok(json.paths["/docs"]);
  assert.deepEqual(json.paths["/docs"].get.tags, ["Docs"]);

  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
  assert.match(
    docs.headers.get("content-type") ?? "",
    /^text\/html/,
  );
  // Scalar UI is the default.
  const html = await docs.text();
  assert.match(html, /api-reference/);
  assert.match(html, /Bookstore API/);
  // Strict CSP is applied.
  const csp = docs.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /cdn\.jsdelivr\.net/);
  assert.equal(docs.headers.get("x-content-type-options"), "nosniff");
});

test("docs: { ui: 'swagger' } selects Swagger UI", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: { ui: "swagger" },
      title: "Swagger Demo",
      version: "2.0.0",
    }),
  );

  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  assert.match(html, /SwaggerUIBundle/);
  assert.match(html, /Swagger Demo/);
});

test("docs: { scalar } forwards Scalar UI configuration", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: {
        path: "/reference",
        openapiPath: "/reference/openapi.json",
        scalar: {
          theme: "kepler",
          layout: "classic",
          customCss: ":root { --scalar-color-accent: #2563eb; }",
          hideTestRequestButton: true,
        },
      },
      title: "Styled Docs",
      version: "2.0.0",
    }),
  );

  const docs = await app.request("/reference");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  assert.match(html, /data-configuration='/);
  assert.match(html, /&quot;theme&quot;:&quot;kepler&quot;/);
  assert.match(html, /&quot;layout&quot;:&quot;classic&quot;/);
  assert.match(html, /&quot;hideTestRequestButton&quot;:true/);
  assert.match(html, /&quot;url&quot;:&quot;\/reference\/openapi\.json&quot;/);
});

test("docs: { path, openapiPath } honours custom mount points", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: { path: "/api/docs", openapiPath: "/api/openapi.json" },
      openapi: { info: { title: "Custom", version: "0.1.0" } },
    }),
  );

  assert.equal((await app.request("/docs")).status, 404);
  assert.equal((await app.request("/openapi.json")).status, 404);

  const docs = await app.request("/api/docs");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  assert.match(html, /\/api\/openapi\.json/);

  const spec = await app.request("/api/openapi.json");
  assert.equal(spec.status, 200);
});

test("docs: false explicitly disables the auto-mount", async () => {
  const app = withRoute(
    new App({ logger: false, docs: false, openapi: { info: { title: "X", version: "1" } } }),
  );
  assert.equal((await app.request("/docs")).status, 404);
  assert.equal((await app.request("/openapi.json")).status, 404);
});

test("docs: 'auto' is enabled when production is false", async () => {
  const app = withRoute(
    new App({ logger: false, docs: "auto", production: false }),
  );
  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
});

test("docs: 'auto' is disabled when production is true", async () => {
  const app = withRoute(
    new App({ logger: false, docs: "auto", production: true }),
  );
  assert.equal((await app.request("/docs")).status, 404);
  assert.equal((await app.request("/openapi.json")).status, 404);
});

test("docs: { enabled: 'auto' } object form respects production flag", async () => {
  const dev = withRoute(
    new App({
      logger: false,
      docs: { enabled: "auto" },
      production: false,
    }),
  );
  assert.equal((await dev.request("/docs")).status, 200);

  const prod = withRoute(
    new App({
      logger: false,
      docs: { enabled: "auto" },
      production: true,
    }),
  );
  assert.equal((await prod.request("/docs")).status, 404);
});

test("docs: true with no openapi options falls back to default info", async () => {
  // Stub out cwd to a directory with no package.json so the autofill path
  // returns empty and the hardcoded fallback ("DaloyJS API" / "0.0.0") wins.
  const realCwd = process.cwd;
  (process as { cwd: () => string }).cwd = () => "/__nonexistent_for_test__";
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(new App({ logger: false, docs: true }));
    const spec = await app.request("/openapi.json");
    const json: any = await spec.json();
    assert.equal(json.info.title, "DaloyJS API");
    assert.equal(json.info.version, "0.0.0");
  } finally {
    (process as { cwd: () => string }).cwd = realCwd;
    _resetPackageJsonCacheForTests();
  }
});

test("docs: package.json name/version autofill info when not explicitly set", async () => {
  // Default cwd is the repo root, so the autofill should pick up
  // `@daloyjs/core` and the current version from this repo's package.json.
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(new App({ logger: false, docs: true }));
    const json: any = await (await app.request("/openapi.json")).json();
    assert.equal(typeof json.info.title, "string");
    assert.equal(typeof json.info.version, "string");
    assert.notEqual(json.info.title, "DaloyJS API"); // proves autofill ran
    assert.notEqual(json.info.version, "0.0.0");
    assert.match(json.info.title, /daloy/i);
  } finally {
    _resetPackageJsonCacheForTests();
  }
});

test("docs: explicit openapi.info overrides package.json autofill", async () => {
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(
      new App({
        logger: false,
        docs: true,
        openapi: { info: { title: "Explicit", version: "9.9.9" } },
      }),
    );
    const json: any = await (await app.request("/openapi.json")).json();
    assert.equal(json.info.title, "Explicit");
    assert.equal(json.info.version, "9.9.9");
  } finally {
    _resetPackageJsonCacheForTests();
  }
});

test("docs: top-level title/version override package.json autofill", async () => {
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(
      new App({
        logger: false,
        docs: true,
        title: "Top-Level",
        version: "1.2.3",
      }),
    );
    const json: any = await (await app.request("/openapi.json")).json();
    assert.equal(json.info.title, "Top-Level");
    assert.equal(json.info.version, "1.2.3");
  } finally {
    _resetPackageJsonCacheForTests();
  }
});

test("createApp({ docs: true }) behaves identically to new App({ docs: true })", async () => {
  _resetPackageJsonCacheForTests();
  const app = withRoute(
    createApp({
      logger: false,
      docs: true,
      openapi: { info: { title: "Factory", version: "1.0.0" } },
    }),
  );
  const res = await app.request("/openapi.json");
  assert.equal(res.status, 200);
  const json: any = await res.json();
  assert.equal(json.info.title, "Factory");
  assert.equal(json.info.version, "1.0.0");
  assert.ok(json.paths["/books/{id}"], "user routes are preserved");
});

test("createApp() is exported as a plain factory of App", () => {
  const app = createApp();
  assert.ok(app instanceof App);
});

test("docs: top-level title/version/description flow into the spec info", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: true,
      title: "Books",
      version: "3.2.1",
      description: "A library service",
    }),
  );
  const json: any = await (await app.request("/openapi.json")).json();
  assert.equal(json.info.title, "Books");
  assert.equal(json.info.version, "3.2.1");
  assert.equal(json.info.description, "A library service");
});

test("docs: openapi.info overrides top-level title/version/description", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: true,
      title: "Fallback",
      version: "0.0.0",
      openapi: { info: { title: "Override", version: "9.9.9" } },
    }),
  );
  const json: any = await (await app.request("/openapi.json")).json();
  assert.equal(json.info.title, "Override");
  assert.equal(json.info.version, "9.9.9");
});

test("docs: tags option overrides the default ['Docs'] tag", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: { tags: ["Meta"] },
      openapi: { info: { title: "T", version: "1" } },
    }),
  );
  const json: any = await (await app.request("/openapi.json")).json();
  assert.deepEqual(json.paths["/docs"].get.tags, ["Meta"]);
  assert.deepEqual(json.paths["/openapi.json"].get.tags, ["Meta"]);
});

test("docs: empty tags array omits the tags field on auto-mounted ops", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: { tags: [] },
      openapi: { info: { title: "T", version: "1" } },
    }),
  );
  const json: any = await (await app.request("/openapi.json")).json();
  assert.equal(json.paths["/docs"].get.tags, undefined);
  assert.equal(json.paths["/openapi.json"].get.tags, undefined);
});

test("docs auto-mount works inside a group() without duplicate-route errors", () => {
  // The constructor mounts docs on the parent; child apps created by group()
  // must skip the auto-mount so they don't try to re-register the same routes
  // (which would throw "Duplicate route").
  const app = new App({
    logger: false,
    docs: true,
    openapi: { info: { title: "G", version: "1" } },
  });
  assert.doesNotThrow(() => {
    app.group("/v1", { tags: ["v1"] }, (v1) => {
      v1.route({
        method: "GET",
        path: "/ping",
        operationId: "v1ping",
        responses: { 200: { description: "ok" } },
        handler: async () => ({ status: 200 as const, body: undefined }),
      });
    });
  });
});

test("docs auto-mount respects the openapi.servers and securitySchemes options", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: true,
      openapi: {
        info: { title: "S", version: "1.0.0" },
        servers: [{ url: "https://api.example.com" }],
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
        },
      },
    }),
  );
  const json: any = await (await app.request("/openapi.json")).json();
  assert.deepEqual(json.servers, [{ url: "https://api.example.com" }]);
  assert.deepEqual(json.components.securitySchemes, {
    bearerAuth: { type: "http", scheme: "bearer" },
  });
});

test("docs: deno.json autofills info when no package.json is present", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "daloy-deno-"));
  writeFileSync(
    join(dir, "deno.json"),
    JSON.stringify({
      name: "my-deno-app",
      version: "4.2.0",
      description: "deno-only project",
    }),
  );
  const realCwd = process.cwd;
  (process as { cwd: () => string }).cwd = () => dir;
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(new App({ logger: false, docs: true }));
    const json: any = await (await app.request("/openapi.json")).json();
    assert.equal(json.info.title, "my-deno-app");
    assert.equal(json.info.version, "4.2.0");
    assert.equal(json.info.description, "deno-only project");
  } finally {
    (process as { cwd: () => string }).cwd = realCwd;
    _resetPackageJsonCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs: deno.jsonc autofills info and strips JSONC line + block comments", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "daloy-denoc-"));
  writeFileSync(
    join(dir, "deno.jsonc"),
    `{
  // app name
  "name": "jsonc-app",
  /* multi-line
     block comment */
  "version": "1.1.1"
}`,
  );
  const realCwd = process.cwd;
  (process as { cwd: () => string }).cwd = () => dir;
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(new App({ logger: false, docs: true }));
    const json: any = await (await app.request("/openapi.json")).json();
    assert.equal(json.info.title, "jsonc-app");
    assert.equal(json.info.version, "1.1.1");
  } finally {
    (process as { cwd: () => string }).cwd = realCwd;
    _resetPackageJsonCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs: deno.json ignores empty-string name/version/description fields", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "daloy-empty-"));
  writeFileSync(
    join(dir, "deno.json"),
    JSON.stringify({ name: "", version: "", description: "" }),
  );
  const realCwd = process.cwd;
  (process as { cwd: () => string }).cwd = () => dir;
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(new App({ logger: false, docs: true }));
    const json: any = await (await app.request("/openapi.json")).json();
    // Empty strings should be ignored, falling back to defaults.
    assert.equal(json.info.title, "DaloyJS API");
    assert.equal(json.info.version, "0.0.0");
    assert.equal(json.info.description, undefined);
  } finally {
    (process as { cwd: () => string }).cwd = realCwd;
    _resetPackageJsonCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs: malformed manifest is swallowed and returns empty autofill", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "daloy-bad-"));
  writeFileSync(join(dir, "deno.json"), "{ not json");
  const realCwd = process.cwd;
  (process as { cwd: () => string }).cwd = () => dir;
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(new App({ logger: false, docs: true }));
    const json: any = await (await app.request("/openapi.json")).json();
    assert.equal(json.info.title, "DaloyJS API");
    assert.equal(json.info.version, "0.0.0");
  } finally {
    (process as { cwd: () => string }).cwd = realCwd;
    _resetPackageJsonCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});
