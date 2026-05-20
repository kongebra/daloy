import { CodeBlock } from "../../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Compression middleware (0.25.0)",
  description:
    "Daloy 0.25.0 adds portable response compression with CompressionStream, BREACH-aware skip rules, safe cache headers, and ETag handling.",
  path: "/docs/security/compression",
  keywords: [
    "DaloyJS 0.25.0",
    "compression middleware",
    "CompressionStream",
    "BREACH guard",
    "Vary Accept-Encoding",
    "weak ETag",
    "secureDefaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Compression middleware (0.25.0)</h1>
      <p>
        Daloy <strong>0.25.0</strong> ships a focused compression slice: a
        first-party <code>compression()</code> middleware that uses the
        web-standard <code>CompressionStream</code> API instead of a Node-only
        compression package.
      </p>

      <CodeBlock
        code={`import { App, compression } from "@daloyjs/core";

const app = new App({ env: "production" });

app.use(compression());
`}
        language="ts"
      />

      <h2>What it compresses</h2>
      <p>
        The middleware negotiates <code>br</code>, <code>gzip</code>, and{" "}
        <code>deflate</code> from the request <code>Accept-Encoding</code>
        header and the runtime codecs available through{" "}
        <code>CompressionStream</code>. Runtime support is probed once and
        cached. If the platform has no supported codec, the middleware becomes a
        silent no-op instead of breaking older runtimes.
      </p>
      <p>
        The default <code>minimumSize</code> is <code>1024</code> bytes. Small
        responses are left alone, and Daloy also checks the compressed byte
        length after encoding. If compression made the payload larger, the
        original response is kept.
      </p>

      <h2>Security skip rules</h2>
      <p>
        Compression can become an oracle when secrets and attacker-controlled
        bytes share the same compressed response. Daloy keeps those guards built
        in rather than asking every app to remember the same list.
      </p>
      <ul>
        <li>
          Skips responses with <code>Set-Cookie</code>.
        </li>
        <li>
          Skips requests with <code>Authorization</code>.
        </li>
        <li>
          Skips requests carrying session, CSRF, XSRF, <code>__Host-</code>, or{" "}
          <code>__Secure-</code> cookies.
        </li>
        <li>
          Skips any response that already has <code>Content-Encoding</code>.
        </li>
        <li>
          Skips non-<code>GET</code> / non-<code>HEAD</code> requests and
          non-2xx responses.
        </li>
        <li>
          Skips already-compressed content types such as images, video, audio,
          archives, fonts, WebAssembly, and PDFs. <code>image/svg+xml</code> is
          carved back in because it is XML text.
        </li>
      </ul>

      <h2>Cache and ETag behavior</h2>
      <p>
        Every response that reaches <code>compression()</code> gets{" "}
        <code>Vary: Accept-Encoding</code>, even when Daloy decides not to
        compress that specific response. That keeps downstream caches keyed by
        the negotiation surface from the first response onward.
      </p>
      <p>
        If a compressed response already has a strong ETag such as{" "}
        <code>&quot;abc&quot;</code>, Daloy downgrades it to{" "}
        <code>W/&quot;abc&quot;</code>. The ETag was computed over the upstream
        body, not the compressed wire bytes, so a weak validator is the honest
        one.
      </p>

      <h2>No compression level knob</h2>
      <p>
        <code>CompressionStream</code> uses the runtime default. Daloy refuses
        any <code>compressLevel</code> option at construction, including{" "}
        <code>6</code>, because exposing the knob invites expensive level-9
        compression for tiny byte savings under load.
      </p>

      <CodeBlock
        code={`app.use(compression({
  minimumSize: 2 * 1024,
  encodings: ["gzip"],
  authCookieNames: ["tenant-auth"],
  excludeContentTypes: ["application/x-parquet"],
}));`}
        language="ts"
      />

      <h2>Ordering</h2>
      <p>
        Register <code>compression()</code> after middleware that may add{" "}
        <code>Set-Cookie</code>, <code>Content-Encoding</code>, or{" "}
        <code>ETag</code> headers. Daloy runs <code>onSend</code> hooks in
        registration order, so the compression hook should see the final
        response headers before it decides whether to encode the body.
      </p>
    </>
  );
}
