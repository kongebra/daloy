import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Adapters & runtimes",
  description:
    "Run the same DaloyJS app on Node.js, Bun, Deno, Cloudflare Workers, Vercel Edge, Fastly Compute, AWS Lambda, Netlify Functions, and any Node-based PaaS (Heroku, Railway, Render, Fly.io). One codebase, multiple runtimes, zero rewrites.",
  path: "/docs/adapters",
  keywords: [
    "runtime adapters",
    "Cloudflare Workers TypeScript",
    "Vercel Edge framework",
    "Bun framework",
    "Deno HTTP framework",
    "AWS Lambda framework",
    "Netlify Functions",
    "Fastly Compute",
    "Heroku Node",
    "Railway Node",
    "Render Node",
    "Fly.io Node",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Adapters & runtimes</h1>
      <p>
        The DaloyJS core only ever sees <code>Request → Response</code>. Runtime-specific concerns —
        sockets, signals, edge handlers — live in thin adapters at the edge.
      </p>

      <h2>Node.js</h2>
      <CodeBlock code={`import { serve } from "@daloyjs/core/node";

const { port, close } = serve(app, {
  port: 3000,
  hostname: "0.0.0.0",
  connectionTimeoutMs: 30_000,
  shutdownTimeoutMs: 10_000,
  handleSignals: true,       // SIGTERM / SIGINT trigger graceful shutdown
  maxHeaderBytes: 16 * 1024, // 16 KiB cap (default)
  trustProxy: false,         // set true only behind a trusted reverse proxy
});

// later
await close();`} />
      <p>
        The Node adapter wires <code>requestTimeout</code>, <code>headersTimeout</code>, and{" "}
        <code>keepAliveTimeout</code> to safe values, and listens for SIGTERM/SIGINT for zero-downtime
        rolling deploys. When <code>trustProxy</code> is enabled the adapter honors{" "}
        <code>x-forwarded-proto</code> and <code>x-forwarded-host</code> when constructing the
        request URL — leave it off (the default) unless you terminate TLS at a known proxy.
      </p>

      <h2>Bun</h2>
      <CodeBlock code={`import { serve } from "@daloyjs/core/bun";

const handle = serve(app, {
  port: 3000,
  idleTimeout: 30,              // seconds; Bun default is 10
  development: false,           // disables Bun dev error pages
  // unix: "/tmp/daloy.sock",   // alternative to TCP
  // tls: { cert, key },        // HTTPS
});
console.log("Listening on " + handle.url);`} />

      <h2>Deno</h2>
      <CodeBlock code={`import { serve } from "@daloyjs/core/deno";

serve(app, {
  port: 3000,
  // HTTPS:
  // cert: Deno.readTextFileSync("./cert.pem"),
  // key:  Deno.readTextFileSync("./key.pem"),
  onListen: ({ hostname, port }) =>
    console.log("Listening on http://" + hostname + ":" + port),
});`} />
      <p>
        The Deno adapter wires an internal <code>AbortController</code> into <code>Deno.serve</code>
        and listens for SIGTERM/SIGINT, so calling the returned <code>shutdown()</code> drains
        in-flight requests before resolving.
      </p>

      <h2>Cloudflare Workers</h2>
      <CodeBlock code={`// worker.ts
import { toFetchHandler } from "@daloyjs/core/cloudflare";
import { app } from "./src/server.js";

interface Env { /* your bindings */ }

// toFetchHandler returns the { fetch } object Workers expect as the default
// export. Do NOT wrap it again — export the result directly.
export default toFetchHandler<Env>(app);`} />

      <h2>Vercel (Edge or Node.js)</h2>
      <p>
        Vercel now recommends the Node.js runtime over Edge for new functions. The DaloyJS
        adapter is runtime-agnostic, so the same code runs on either; pick a runtime per
        function and the adapter does not change.
      </p>
      <CodeBlock code={`// app/api/[[...slug]]/route.ts (Next.js App Router)
import { toRouteHandlers } from "@daloyjs/core/vercel";
import { app } from "@/server";

export const runtime = "nodejs"; // or "edge"
export const { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } =
  toRouteHandlers(app);`} />
      <CodeBlock code={`// api/[...path].ts (Vercel Node.js Functions, non-Next.js)
    import { toFetchHandler } from "@daloyjs/core/vercel";
import { app } from "../src/server.js";

    // Node.js is the default runtime. Vercel expects a default { fetch } export.
    export default toFetchHandler(app);`} />
      <CodeBlock code={`// api/[...path].ts (Vercel Edge Functions, non-Next.js)
    import { toWebHandler } from "@daloyjs/core/vercel";
    import { app } from "../src/server.js";

    export const config = { runtime: "edge" };
    export default toWebHandler(app);`} />
      <p>
        <code>toEdgeHandler</code> remains exported as a backward-compatible alias of{" "}
        <code>toWebHandler</code>; new code should prefer <code>toWebHandler</code> or{" "}
        <code>toRouteHandlers</code> for Edge/Next route handlers, and <code>toFetchHandler</code>{" "}
        for the default export shape used by Vercel Node.js Functions.
      </p>

      <h2>Netlify Edge Functions</h2>
      <p>
        Netlify Edge Functions run on a Deno-based runtime with the standard{" "}
        <code>Request</code>/<code>Response</code> API, so the Vercel adapter works unchanged.
      </p>
      <CodeBlock code={`// netlify/edge-functions/api.ts
import { toWebHandler } from "@daloyjs/core/vercel";
import { app } from "../../src/server.ts";

export default toWebHandler(app);
export const config = { path: "/api/*" };`} />

      <h2>Fastly Compute</h2>
      <p>
        Fastly Compute uses a fetch-event listener model. The Fastly adapter exposes both a
        plain handler and a one-call listener installer.
      </p>
      <CodeBlock code={`// src/index.ts (Fastly Compute @ Edge JS starter)
import { installFastlyListener } from "@daloyjs/core/fastly";
import { app } from "./server.js";

installFastlyListener(app);`} />
      <p>
        Fastly Compute does not expose <code>node:*</code> modules; avoid Node-only middleware
        (Node session store, Redis rate-limit store, multipart helpers that depend on{" "}
        <code>node:stream</code>).
      </p>

      <h2>AWS Lambda / Netlify Functions / Lambda Function URLs</h2>
      <p>
        The Lambda adapter supports API Gateway HTTP API payload format <strong>2.0</strong>,
        API Gateway REST API payload format <strong>1.0</strong>, Lambda Function URLs, and
        Netlify Functions. It handles base64-encoded bodies, v2 <code>cookies</code>, v1{" "}
        <code>multiValueHeaders</code>, and proxies the request method, path, query, and headers.
      </p>
      <CodeBlock code={`// netlify/functions/api.ts
import { toLambdaHandler } from "@daloyjs/core/lambda";
import { app } from "../../src/server.js";

export const handler = toLambdaHandler(app);
export const config = { path: "/api/*" };`} />
      <CodeBlock code={`// AWS Lambda Function URL or API Gateway HTTP API
import { toLambdaHandler } from "@daloyjs/core/lambda";
import { app } from "./server.js";

export const handler = toLambdaHandler(app);`} />

      <h2>Heroku, Railway, Render, Fly.io (and any Node PaaS)</h2>
      <p>
        These platforms run a long-lived Node process. Use the Node adapter as-is and listen on
        the platform-provided <code>PORT</code>. Graceful shutdown is wired automatically —
        the adapter listens for SIGTERM so rolling deploys drain in-flight requests.
      </p>
      <CodeBlock code={`// src/server.ts
import { serve } from "@daloyjs/core/node";
import { app } from "./app.js";

serve(app, {
  port: Number(process.env.PORT ?? 3000),
  hostname: "0.0.0.0",
});`} />
      <p>
        For <strong>Heroku</strong> and <strong>Railway</strong>, add a <code>start</code> script and a{" "}
        <code>Procfile</code> (Heroku only):
      </p>
      <CodeBlock language="bash" code={`# Procfile
web: node dist/server.js`} />
      <p>
        For <strong>Render</strong>, set the start command to <code>node dist/server.js</code> and the
        health-check path to a cheap route like <code>/healthz</code>.
      </p>
      <p>
        For <strong>Fly.io</strong>, ship a Dockerfile (see the{" "}
        <a href="/docs/deployment">Deployment</a> page for the distroless template) and a{" "}
        <code>fly.toml</code> with a matching internal port:
      </p>
      <CodeBlock language="toml" code={`# fly.toml
app = "my-daloy-api"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true

  [http_service.concurrency]
    type = "requests"
    soft_limit = 200
    hard_limit = 250

[[http_service.checks]]
  interval = "10s"
  timeout = "2s"
  grace_period = "5s"
  method = "GET"
  path = "/healthz"`} />

      <h2>Roll your own</h2>
      <p>If your runtime exposes the <code>fetch</code> standard, you don&apos;t need an adapter:</p>
      <CodeBlock code={`addEventListener("fetch", (event) => event.respondWith(app.fetch(event.request)));`} />
    </>
  );
}
