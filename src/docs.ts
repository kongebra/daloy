/**
 * Built-in API documentation handlers.
 *
 * Both serve a single self-contained HTML page that loads the spec at
 * `specUrl` from a CDN. No build step, no extra deps.
 *
 * (You can self-host the assets if your CSP forbids CDNs.)
 */

export type ScalarJsonPrimitive = string | number | boolean | null;
export type ScalarJsonValue =
  | ScalarJsonPrimitive
  | ScalarJsonValue[]
  | { [key: string]: ScalarJsonValue | undefined };

export type ScalarTheme =
  | "alternate"
  | "default"
  | "moon"
  | "purple"
  | "solarized"
  | "bluePlanet"
  | "saturn"
  | "kepler"
  | "mars"
  | "deepSpace"
  | "laserwave"
  | "none";

export interface ScalarReferenceConfiguration {
  [key: string]: ScalarJsonValue | undefined;
  theme?: ScalarTheme;
  customCss?: string;
  darkMode?: boolean;
  forceDarkModeState?: "dark" | "light";
  withDefaultFonts?: boolean;
  favicon?: string;
  layout?: "modern" | "classic";
  hideClientButton?: boolean;
  hideDarkModeToggle?: boolean;
  hideModels?: boolean;
  hideSearch?: boolean;
  hideTestRequestButton?: boolean;
  showOperationId?: boolean;
  showSidebar?: boolean;
  showDeveloperTools?: "always" | "localhost" | "never";
  defaultOpenFirstTag?: boolean;
  defaultOpenAllTags?: boolean;
  expandAllModelSections?: boolean;
  expandAllResponses?: boolean;
  documentDownloadType?: "json" | "yaml" | "both" | "direct" | "none";
  operationTitleSource?: "summary" | "path";
  orderRequiredPropertiesFirst?: boolean;
  orderSchemaPropertiesBy?: "alpha" | "preserve";
  searchHotKey?: string;
  baseServerURL?: string;
  proxyUrl?: string;
  oauth2RedirectUri?: string;
  persistAuth?: boolean;
  telemetry?: boolean;
  tagsSorter?: "alpha";
  operationsSorter?: "alpha" | "method";
  authentication?: { [key: string]: ScalarJsonValue | undefined };
  defaultHttpClient?: { [key: string]: ScalarJsonValue | undefined };
  metaData?: { [key: string]: ScalarJsonValue | undefined };
  mcp?: { [key: string]: ScalarJsonValue | undefined };
  pathRouting?: { [key: string]: ScalarJsonValue | undefined };
  servers?: ScalarJsonValue[];
  content?: never;
  fetch?: never;
  generateHeadingSlug?: never;
  generateModelSlug?: never;
  generateOperationSlug?: never;
  generateTagSlug?: never;
  generateWebhookSlug?: never;
  onBeforeRequest?: never;
  onDocumentSelect?: never;
  onLoaded?: never;
  onRequestSent?: never;
  onServerChange?: never;
  onShowMore?: never;
  onSidebarClick?: never;
  onSpecUpdate?: never;
  plugins?: never;
  redirect?: never;
  sources?: never;
  spec?: never;
  url?: never;
}

export interface DocsOptions {
  specUrl: string;
  title?: string;
  assets?: {
    scalarScriptUrl?: string;
    swaggerUiCssUrl?: string;
    swaggerUiBundleUrl?: string;
  };
  scriptNonce?: string;
}

export interface ScalarHtmlOptions extends DocsOptions {
  configuration?: ScalarReferenceConfiguration;
}

export interface DocsContentSecurityPolicyOptions {
  assetOrigins?: string[];
  scriptNonce?: string;
  allowInlineStyles?: boolean;
}

export interface HtmlResponseOptions extends DocsContentSecurityPolicyOptions {
  contentSecurityPolicy?: string;
}

const JSDELIVR_ORIGIN = "https://cdn.jsdelivr.net";

function nonceAttr(nonce: string | undefined): string {
  return nonce ? ` nonce="${escapeHtml(nonce)}"` : "";
}

export function scalarHtml(opts: ScalarHtmlOptions): string {
  const title = escapeHtml(opts.title ?? "API Reference");
  const url = escapeHtml(opts.specUrl);
  const scriptUrl = escapeHtml(
    opts.assets?.scalarScriptUrl ??
      `${JSDELIVR_ORIGIN}/npm/@scalar/api-reference`,
  );
  const nonce = nonceAttr(opts.scriptNonce);
  const configuration = scalarConfigurationAttr(
    opts.specUrl,
    opts.configuration,
  );
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head><body>
<script id="api-reference" data-url="${url}"${configuration}${nonce}></script>
<script src="${scriptUrl}"${nonce}></script>
</body></html>`;
}

export function swaggerUiHtml(opts: DocsOptions): string {
  const title = escapeHtml(opts.title ?? "API Docs");
  const url = escapeHtml(opts.specUrl);
  const cssUrl = escapeHtml(
    opts.assets?.swaggerUiCssUrl ??
      `${JSDELIVR_ORIGIN}/npm/swagger-ui-dist/swagger-ui.css`,
  );
  const bundleUrl = escapeHtml(
    opts.assets?.swaggerUiBundleUrl ??
      `${JSDELIVR_ORIGIN}/npm/swagger-ui-dist/swagger-ui-bundle.js`,
  );
  const nonce = nonceAttr(opts.scriptNonce);
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="${cssUrl}" />
</head><body>
<div id="swagger"></div>
<script src="${bundleUrl}"${nonce}></script>
<script${nonce}>window.onload=()=>SwaggerUIBundle({url:"${url}",dom_id:"#swagger"});</script>
</body></html>`;
}

export function docsContentSecurityPolicy(
  opts: DocsContentSecurityPolicyOptions = {},
): string {
  const assetOrigins = opts.assetOrigins ?? [JSDELIVR_ORIGIN];
  const scriptSrc = ["'self'", ...assetOrigins];
  if (opts.scriptNonce) scriptSrc.push(`'nonce-${opts.scriptNonce}'`);
  else scriptSrc.push("'unsafe-inline'");

  const styleSrc = ["'self'", ...assetOrigins];
  if (opts.allowInlineStyles !== false) styleSrc.push("'unsafe-inline'");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    "img-src 'self' data: https:",
    "connect-src 'self'",
  ].join("; ");
}

export function htmlResponse(
  html: string,
  opts: HtmlResponseOptions = {},
): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        opts.contentSecurityPolicy ??
        docsContentSecurityPolicy({
          assetOrigins: opts.assetOrigins,
          scriptNonce: opts.scriptNonce,
          allowInlineStyles: opts.allowInlineStyles,
        }),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

function scalarConfigurationAttr(
  specUrl: string,
  configuration: ScalarReferenceConfiguration | undefined,
): string {
  if (!configuration) return "";
  const {
    content: _content,
    fetch: _fetch,
    plugins: _plugins,
    sources: _sources,
    spec: _spec,
    url: _url,
    ...uiConfiguration
  } = configuration;
  return ` data-configuration='${escapeHtml(JSON.stringify({ ...uiConfiguration, url: specUrl }))}'`;
}
