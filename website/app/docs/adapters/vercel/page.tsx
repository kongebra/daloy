import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Vercel adapter",
  description:
    "Deploy a DaloyJS REST API to Vercel Node.js Functions or Edge Functions. One app object, two standalone function shapes.",
  path: "/docs/adapters/vercel",
  keywords: [
    "DaloyJS Vercel adapter",
    "Vercel Functions",
    "Vercel Edge Functions",
    "toWebHandler",
    "toFetchHandler",
    "Fluid compute",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Vercel</h1>
      <p>
        Vercel has two standalone places you can mount a DaloyJS REST API
        handler, Node.js Functions and Edge Functions. Each target expects a
        slightly different export shape; the underlying <code>app</code> object
        is identical.
      </p>

      <h2>When to choose Vercel</h2>
      <ul>
        <li>You want a standalone DaloyJS REST API on Vercel Functions.</li>
        <li>
          You want Fluid compute (the default since 2025) with per-request
          billing.
        </li>
        <li>You want preview deployments per PR with zero CI config.</li>
      </ul>

      <h2>Scaffold</h2>
      <p>
        The current Vercel starter creates an Edge Function REST API. If you
        prefer the Node.js runtime, use the <code>toFetchHandler</code>{" "}
        entrypoint shown below.
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api --template vercel-edge
cd my-api
pnpm vercel dev`}
      />

      <h2>1. Vercel Node.js Functions (standalone API)</h2>
      <p>
        For a standalone DaloyJS REST API on the Node.js runtime, use a
        catch-all file in <code>/api</code>. Vercel Node.js Functions expect a
        default export with a <code>fetch</code> method.
      </p>
      <CodeBlock
        language="ts"
        code={`// api/[...path].ts
import { toFetchHandler } from "@daloyjs/core/vercel";
import { app } from "../src/server.ts";

// Node.js is the default runtime. No runtime export needed.
export default toFetchHandler(app);`}
      />

      <h2>2. Vercel Edge Functions (standalone API)</h2>
      <CodeBlock
        language="ts"
        code={`// api/[...path].ts
import { toWebHandler } from "@daloyjs/core/vercel";
import { app } from "../src/server.ts";

export const runtime = "edge";
export default toWebHandler(app);`}
      />
      <p>
        <code>toEdgeHandler</code> is still exported as a backward-compatible
        alias of <code>toWebHandler</code>; new code should prefer{" "}
        <code>toWebHandler</code>.
      </p>

      <h2>vercel.json</h2>
      <p>
        Most projects don&apos;t need <code>vercel.json</code> at all. Add it
        for per-function memory/duration limits or to pin a region.
      </p>
      <CodeBlock
        language="json"
        code={`{
  "functions": {
    "api/[...path].ts": { "memory": 1024, "maxDuration": 30 }
  },
  "regions": ["fra1"]
}`}
      />
      <p>
        The legacy <code>builds</code> property is deprecated, use{" "}
        <code>functions</code> instead.
      </p>

      <h2>Deploy</h2>
      <CodeBlock
        language="bash"
        code={`# preview
pnpm vercel deploy

# production
pnpm vercel deploy --prod

# env vars (encrypted)
pnpm vercel env add SESSION_SECRET production`}
      />

      <h2>Storage</h2>
      <p>
        <strong>
          Vercel KV and Vercel Postgres no longer exist as Vercel-owned
          products.
        </strong>{" "}
        They were sunset in December 2024 and existing stores were migrated
        automatically, Vercel KV to Upstash Redis, Vercel Postgres to Neon. For
        new projects, add the equivalent integration from the{" "}
        <a
          href="https://vercel.com/marketplace"
          target="_blank"
          rel="noreferrer"
        >
          Vercel Marketplace
        </a>{" "}
        (Neon for Postgres, Upstash for Redis), the integration provisions the
        store and injects the connection env vars into your project.
      </p>
      <p>
        Vercel Blob and Edge Config are still first-party Vercel products. See{" "}
        <Link href="/docs/databases/neon">Neon</Link> for the Postgres setup and{" "}
        <Link href="/docs/security/rate-limit-redis">
          distributed rate-limit store
        </Link>{" "}
        for the Redis setup.
      </p>

      <h2>Gotchas</h2>
      <ul>
        <li>
          Edge runtime has no <code>node:*</code>: keep middleware portable, and
          prefer fetch-based drivers (Neon serverless, PlanetScale, Turso) when
          running on Edge.
        </li>
        <li>
          Standalone Vercel Node functions want a <strong>default</strong>{" "}
          export with <code>&#123; fetch &#125;</code>. Use{" "}
          <code>toFetchHandler</code>.
        </li>
        <li>
          Vercel sets <code>process.env</code> on Node functions; on Edge,
          secrets are bundled at build time, so don&apos;t read them outside the
          handler.
        </li>
      </ul>

      <h2>See also</h2>
      <ul>
        <li>
          <Link href="/docs/adapters">Adapters overview</Link>
        </li>
        <li>
          <Link href="/docs/scaffolder">Scaffolder</Link>
        </li>
        <li>
          <Link href="/docs/databases/neon">Neon on Vercel</Link>
        </li>
      </ul>
    </>
  );
}
