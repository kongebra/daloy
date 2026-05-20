import { CodeBlock } from "../../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Secure-by-default (0.16.0)",
  description:
    "Daloy 0.16.0 auto-applies secureHeaders() and rejects cross-origin state-changing requests unless cors() is registered. Learn the new defaults, escape hatches, and per-route opt-ins.",
  path: "/docs/security/secure-defaults",
  keywords: [
    "DaloyJS secure defaults",
    "secureHeaders auto",
    "CORS cross-origin guard",
    "CORS origin allowlist",
    "0.16.0 breaking changes",
    "secureDefaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Secure-by-default (0.16.0)</h1>
      <p>
        Daloy <strong>0.16.0</strong> is the first release in the
        &ldquo;secure-by-default&rdquo; series. It flips secure headers and
        cross-origin write protection on by default, adds a per-route content
        type opt-in, and keeps a single master escape hatch (
        <code>secureDefaults: false</code>) plus per-feature opt-outs for the
        rare cases where you genuinely need the old behavior.
      </p>

      <h2>What flipped</h2>

      <h3>
        1. <code>secureHeaders()</code> is now auto-applied
      </h3>
      <p>
        Every <code>new App()</code> instance ships <code>secureHeaders()</code>{" "}
        with the same sensible defaults the middleware has always had: HSTS,{" "}
        <code>X-Frame-Options: DENY</code>,{" "}
        <code>X-Content-Type-Options: nosniff</code>, a strict{" "}
        <code>Referrer-Policy</code>, and a baseline CSP. No code change
        required.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";

const app = new App();
// secureHeaders() already attached — no app.use(secureHeaders()) needed.`}
      />

      <p>
        If you call <code>app.use(secureHeaders(...))</code> with your own
        configuration, the auto-installed instance is automatically removed so
        your overrides win instead of being silently shadowed by the
        framework&apos;s defaults.
      </p>
      <CodeBlock
        code={`import { App, secureHeaders } from "@daloyjs/core";

const app = new App();
app.use(
  secureHeaders({
    contentSecurityPolicy: "default-src 'self'; script-src 'self' 'nonce-{nonce}'",
    frameOptions: "SAMEORIGIN",
  }),
);
// The framework's default secureHeaders is dropped; your config is the only one active.`}
      />

      <p>
        Want the headers configured at construction time instead? Pass a{" "}
        <code>secureHeaders</code> object to <code>new App()</code>:
      </p>
      <CodeBlock
        code={`const app = new App({
  secureHeaders: { frameOptions: "SAMEORIGIN" },
});`}
      />

      <p>
        To opt out entirely (e.g. you serve content from a CDN that injects its
        own headers):
      </p>
      <CodeBlock code={`const app = new App({ secureHeaders: false });`} />

      <h3>
        2. Cross-origin <code>POST</code> / <code>PUT</code> /{" "}
        <code>PATCH</code> / <code>DELETE</code> require <code>cors()</code>
      </h3>
      <p>
        State-changing requests carrying an <code>Origin</code> header from a
        different origin than the request URL are now rejected with{" "}
        <code>403 problem+json</code> unless the matched route has a{" "}
        <code>cors()</code> policy that allows that origin. Read-only methods (
        <code>GET</code>, <code>HEAD</code>, <code>OPTIONS</code>), same-origin
        requests, and requests without an <code>Origin</code> header (or with{" "}
        <code>Origin: null</code> from a sandboxed iframe) pass through
        unchanged.
      </p>
      <CodeBlock
        code={`import { App, cors } from "@daloyjs/core";

const app = new App();
app.use(cors({ origin: ["https://app.example.com"] }));
// Register this before the routes it should apply to.
// Cross-origin POST from https://app.example.com now passes through to your handler.`}
      />

      <p>
        Per-route opt-in works too — register the <code>cors()</code> hook on
        the specific routes that need it via{" "}
        <code>route({"{ hooks: cors({...}) }"})</code>.
      </p>

      <p>
        To disable the guard entirely (you handle cross-origin admission another
        way, e.g. via <code>csrf()</code> with the <code>fetch-metadata</code>{" "}
        strategy):
      </p>
      <CodeBlock
        code={`const app = new App({ corsCrossOriginGuard: false });`}
      />

      <h3>
        3. Per-route <code>accepts</code> field
      </h3>
      <p>
        New <code>route({"{ accepts: [...] }"})</code> field overrides the
        global <code>allowedContentTypes</code> allowlist for a single route.
        Useful for legacy form-encoded webhook receivers without loosening the
        default allowlist for the rest of your app.
      </p>
      <CodeBlock
        code={`app.route({
  method: "POST",
  path: "/legacy/webhook",
  operationId: "legacyWebhook",
  accepts: ["application/x-www-form-urlencoded"],
  request: { body: z.object({ payload: z.string() }) },
  responses: { 200: { description: "ok" } },
  handler: async ({ body }) => ({ status: 200 as const, body: { ok: true } }),
});`}
      />

      <h2>The master escape hatch</h2>
      <p>
        If you&apos;re upgrading from <code>0.15.x</code> and need to ship the
        upgrade without any behavior changes, pass{" "}
        <code>secureDefaults: false</code> to restore the pre-0.16 behavior
        wholesale:
      </p>
      <CodeBlock code={`const app = new App({ secureDefaults: false });`} />
      <p>
        This is intentionally one-shot: there is no per-feature granular master
        flag because the per-feature opt-outs already exist (
        <code>secureHeaders: false</code>,{" "}
        <code>corsCrossOriginGuard: false</code>). Use{" "}
        <code>secureDefaults: false</code> as a time-boxed migration hatch, not
        a permanent posture.
      </p>

      <h2>Detection markers (advanced)</h2>
      <p>
        The framework detects <code>secureHeaders()</code> and{" "}
        <code>cors()</code> registration via two exported symbols. If you wrap
        these middleware in your own helpers, stamp the marker on your returned
        hooks to get the same behavior:
      </p>
      <CodeBlock
        code={`import {
  cors,
  secureHeaders,
  CORS_HOOK_MARKER,
  CORS_ORIGIN_ALLOW_MARKER,
  SECURE_HEADERS_MARKER,
} from "@daloyjs/core";

export function myCors() {
  const hooks = cors({ origin: ["https://app.example.com"] });
  // already stamped with CORS_HOOK_MARKER and CORS_ORIGIN_ALLOW_MARKER.
  return hooks;
}

export function myCustomHeaders() {
  const hooks = secureHeaders({ frameOptions: "SAMEORIGIN" });
  // already stamped; the auto-installed instance will be dropped when you use() this.
  return hooks;
}`}
      />

      <h2>Migration checklist</h2>
      <ul>
        <li>
          Audit any custom <code>secureHeaders()</code> call sites. Behavior is
          the same — the auto-installed instance is automatically replaced when
          you register your own.
        </li>
        <li>
          Audit any cross-origin <code>POST</code> / <code>PUT</code> /{" "}
          <code>PATCH</code> / <code>DELETE</code> tests / integrations.
          Register <code>cors()</code> (recommended) or pass{" "}
          <code>corsCrossOriginGuard: false</code> (if you handle cross-origin
          admission via <code>csrf({"{ strategy: 'fetch-metadata' }"})</code>,
          for example).
        </li>
        <li>
          For legacy form-encoded routes, add{" "}
          <code>accepts: [&quot;application/x-www-form-urlencoded&quot;]</code>{" "}
          on the route definition.
        </li>
        <li>
          If you must ship the upgrade with zero behavior change while you
          triage, set <code>secureDefaults: false</code> as a temporary escape
          hatch.
        </li>
      </ul>

      <h2>
        What&apos;s <em>not</em> in this slice
      </h2>
      <p>
        The full secure-defaults plan in the roadmap lists many additional flips
        (CSP nonces default-on, per-content-type body caps, response-schema
        validation in development, conditional
        <code>/openapi.json</code> in production,{" "}
        <code>frame-ancestors &apos;none&apos;</code> as immovable,
        trailing-slash canonicalization, etc.). Those will land in additive{" "}
        <code>0.16.x</code> patches and follow-up minor releases. The four-item
        slice above is what shipped first because it is the
        highest-impact-per-line-of-breaking-change subset.
      </p>
    </>
  );
}
