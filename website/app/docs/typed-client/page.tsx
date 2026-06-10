import Link from "next/link";

import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Typed API clients",
  description:
    "Generate fully typed TypeScript clients from your DaloyJS OpenAPI spec with Hey API. Get end-to-end type safety between server and client with no drift.",
  path: "/docs/typed-client",
  keywords: [
    "typed API client",
    "OpenAPI client TypeScript",
    "Hey API client",
    "end-to-end type safety",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Typed clients</h1>
      <p>
        DaloyJS ships <strong>two</strong> ways to call your API with full
        type-safety. Use whichever fits your consumer.
      </p>

      <h2>1. In-process typed client (zero codegen)</h2>
      <p>
        For TypeScript consumers in the same monorepo (tests, internal tools,
        Next.js server actions):
      </p>
      <CodeBlock
        code={`import { createClient } from "@daloyjs/core/client";
import { App } from "@daloyjs/core";
import { z } from "zod";

// Chain .route() calls so the App type accumulates each route.
const app = new App()
  .route({
    method: "GET",
    path: "/books/:id",
    operationId: "getBookById",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "OK", body: z.object({ id: z.string(), title: z.string() }) },
      404: { description: "Not Found" },
    },
    handler: ({ params }) => ({ status: 200, body: { id: params.id, title: "Dune" } }),
  });

const client = createClient(app, { baseUrl: "http://localhost:3000" });

const r = await client.getBookById({ params: { id: "1" } });
//    ^? { status: 200; body: { id: string; title: string } }
//      | { status: 404; body: ProblemJson }

if (r.status === 200) {
  console.log(r.body.title); // string, fully typed
}`}
      />

      <p>
        The client is keyed by <code>operationId</code>, returns a discriminated
        union of <code>{`{status, body, headers}`}</code>, and infers everything
        from the route definition itself. No build step.
      </p>

      <div role="note">
        <p>
          <strong>Inference requires method chaining.</strong> Each{" "}
          <code>app.route(...)</code> call returns a new <code>App</code> type
          that accumulates the route, so chain your registrations (
          <code>new App().route(a).route(b)</code>) and let TypeScript infer the
          variable&apos;s type. Two things erase inference and collapse the
          client back to a loose, untyped surface:
        </p>
        <ul>
          <li>
            Annotating the instance with a bare{" "}
            <code>const app: App = ...</code> (or returning <code>: App</code>{" "}
            from a factory). The widening annotation discards the accumulated
            routes, so let the type be inferred instead.
          </li>
          <li>
            Registering routes as separate statements (
            <code>app.route(a); app.route(b);</code>) on a previously-declared
            variable. The variable keeps its original type, so the new routes
            never reach the client.
          </li>
        </ul>
        <p>
          If you import <code>app</code> from another module, export it without
          a widening annotation (
          <code>export const app = new App().route(...)...;</code>) so its
          inferred type, and the typed client, crosses the module boundary
          intact.
        </p>
      </div>

      <h2>2. Hey API SDK (cross-language, cross-repo, build-time)</h2>
      <p>
        For consumers outside the monorepo or in other languages, generate a
        fully typed fetch SDK with{" "}
        <a
          href="https://heyapi.dev/openapi-ts/get-started"
          target="_blank"
          rel="noreferrer"
        >
          @hey-api/openapi-ts
        </a>
        .
      </p>

      <CodeBlock language="bash" code={`pnpm add -D @hey-api/openapi-ts`} />

      <CodeBlock
        code={`// openapi-ts.config.ts
import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./generated/openapi.json",
  output: { path: "./generated/client", format: "prettier" },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk"],
});`}
      />

      <CodeBlock
        language="json"
        code={`// package.json
"scripts": {
  "gen:openapi": "node --import tsx/esm scripts/dump-openapi.ts",
  "gen:client":  "openapi-ts",
  "gen":         "pnpm gen:openapi && pnpm gen:client"
}`}
      />

      <CodeBlock
        language="bash"
        code={`pnpm gen
# writes:
#   generated/openapi.json
#   generated/client/{client.gen.ts, sdk.gen.ts, types.gen.ts, index.ts}`}
      />

      <h2>Using the generated SDK</h2>
      <CodeBlock
        code={`import { client } from "./generated/client";
import { getBookById } from "./generated/client/sdk.gen";

client.setConfig({ baseUrl: "https://api.example.com" });

const { data, error } = await getBookById({ path: { id: "1" } });
if (error) console.error(error);
else console.log(data.title);`}
      />

      <h2>Which one should I use?</h2>
      <table>
        <thead>
          <tr>
            <th>Use case</th>
            <th>Pick</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Same-repo TypeScript caller (tests, internal tools)</td>
            <td>
              In-process <code>createClient</code>
            </td>
          </tr>
          <tr>
            <td>Web app / mobile RN bundle in a separate repo</td>
            <td>Hey API SDK</td>
          </tr>
          <tr>
            <td>Non-TypeScript consumer (Python, Swift, Kotlin)</td>
            <td>OpenAPI doc + their preferred generator</td>
          </tr>
          <tr>
            <td>Public SDK for third parties</td>
            <td>Hey API SDK, published as its own package</td>
          </tr>
        </tbody>
      </table>

      <p>
        Need a bigger contract to validate your generator output? Use the{" "}
        <Link href="/docs/tutorials/fake-rest-api">large fake REST demo</Link>{" "}
        as the stress case instead of a minimal tutorial app.
      </p>
    </>
  );
}
