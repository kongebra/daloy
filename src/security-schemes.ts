/**
 * Ergonomic builders for OpenAPI 3.1 Security Scheme objects.
 *
 * These return plain JSON objects shaped exactly like the spec expects, so the
 * output of any builder can be dropped straight into
 * `generateOpenAPI(app, { securitySchemes: { ... } })`.
 *
 * Spec reference:
 *   https://spec.openapis.org/oas/v3.1.0#security-scheme-object
 */

export type ApiKeyLocation = "header" | "query" | "cookie";

export interface HttpBearerSchemeOptions {
  /** Hint about the bearer token format (e.g. "JWT"). */
  bearerFormat?: string;
  description?: string;
}

export interface HttpBasicSchemeOptions {
  description?: string;
}

export interface ApiKeySchemeOptions {
  in: ApiKeyLocation;
  name: string;
  description?: string;
}

export interface OAuth2ImplicitFlow {
  authorizationUrl: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

export interface OAuth2PasswordFlow {
  tokenUrl: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

export interface OAuth2ClientCredentialsFlow {
  tokenUrl: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

export interface OAuth2AuthorizationCodeFlow {
  authorizationUrl: string;
  tokenUrl: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

export interface OAuth2Flows {
  implicit?: OAuth2ImplicitFlow;
  password?: OAuth2PasswordFlow;
  clientCredentials?: OAuth2ClientCredentialsFlow;
  authorizationCode?: OAuth2AuthorizationCodeFlow;
}

export interface OAuth2SchemeOptions {
  flows: OAuth2Flows;
  description?: string;
}

export interface OpenIdConnectSchemeOptions {
  openIdConnectUrl: string;
  description?: string;
}

export interface HttpBearerScheme {
  type: "http";
  scheme: "bearer";
  bearerFormat?: string;
  description?: string;
}

export interface HttpBasicScheme {
  type: "http";
  scheme: "basic";
  description?: string;
}

export interface ApiKeyScheme {
  type: "apiKey";
  in: ApiKeyLocation;
  name: string;
  description?: string;
}

export interface OAuth2Scheme {
  type: "oauth2";
  flows: OAuth2Flows;
  description?: string;
}

export interface OpenIdConnectScheme {
  type: "openIdConnect";
  openIdConnectUrl: string;
  description?: string;
}

export type SecurityScheme =
  | HttpBearerScheme
  | HttpBasicScheme
  | ApiKeyScheme
  | OAuth2Scheme
  | OpenIdConnectScheme;

/**
 * Build an OpenAPI Security Scheme Object for HTTP Bearer authentication
 * (e.g. `Authorization: Bearer <token>`).
 *
 * @example
 * ```ts
 * import { App, httpBearerScheme } from "@daloyjs/core";
 * import { generateOpenAPI } from "@daloyjs/core/openapi";
 *
 * const app = new App();
 * const doc = generateOpenAPI(app, {
 *   info: { title: "Books API", version: "1.0.0" },
 *   securitySchemes: { bearerAuth: httpBearerScheme({ bearerFormat: "JWT" }) },
 * });
 * ```
 *
 * @param options - Optional `bearerFormat` hint and `description`.
 * @returns A spec-shaped `{ type, scheme, ... }` object.
 * @since 0.1.0
 */
export function httpBearerScheme(options: HttpBearerSchemeOptions = {}): HttpBearerScheme {
  const scheme: HttpBearerScheme = { type: "http", scheme: "bearer" };
  if (options.bearerFormat !== undefined) scheme.bearerFormat = options.bearerFormat;
  if (options.description !== undefined) scheme.description = options.description;
  return scheme;
}

/**
 * Build an OpenAPI Security Scheme Object for HTTP Basic authentication
 * (`Authorization: Basic <base64>`).
 *
 * @param options - Optional human-readable `description`.
 * @returns A spec-shaped `{ type: "http", scheme: "basic", ... }` object.
 * @since 0.1.0
 */
export function httpBasicScheme(options: HttpBasicSchemeOptions = {}): HttpBasicScheme {
  const scheme: HttpBasicScheme = { type: "http", scheme: "basic" };
  if (options.description !== undefined) scheme.description = options.description;
  return scheme;
}

/**
 * Build an OpenAPI Security Scheme Object for an API key delivered in a
 * request header, query parameter, or cookie.
 *
 * @example
 * ```ts
 * apiKeyScheme({ in: "header", name: "x-api-key" })
 * ```
 *
 * @param options - Required `in` location and `name`, plus optional `description`.
 * @returns A spec-shaped `{ type: "apiKey", in, name, ... }` object.
 * @throws {TypeError} When `in` is not `"header" | "query" | "cookie"` or `name` is empty.
 * @since 0.1.0
 */
export function apiKeyScheme(options: ApiKeySchemeOptions): ApiKeyScheme {
  if (options.in !== "header" && options.in !== "query" && options.in !== "cookie") {
    throw new TypeError(
      `apiKeyScheme: "in" must be one of "header" | "query" | "cookie", got "${String(options.in)}"`
    );
  }
  if (typeof options.name !== "string" || options.name.length === 0) {
    throw new TypeError(`apiKeyScheme: "name" must be a non-empty string`);
  }
  const scheme: ApiKeyScheme = {
    type: "apiKey",
    in: options.in,
    name: options.name,
  };
  if (options.description !== undefined) scheme.description = options.description;
  return scheme;
}

/**
 * Build an OpenAPI Security Scheme Object for OAuth 2.0. At least one flow
 * (implicit, password, client credentials, or authorization code) must be
 * declared.
 *
 * @example
 * ```ts
 * oauth2Scheme({
 *   flows: {
 *     authorizationCode: {
 *       authorizationUrl: "https://example.com/oauth/authorize",
 *       tokenUrl: "https://example.com/oauth/token",
 *       scopes: { "orders:read": "Read your orders" },
 *     },
 *   },
 * })
 * ```
 *
 * @param options - Object with at least one `flows.*` entry.
 * @returns A spec-shaped `{ type: "oauth2", flows, ... }` object.
 * @throws {TypeError} When no OAuth2 flow is declared.
 * @since 0.1.0
 */
export function oauth2Scheme(options: OAuth2SchemeOptions): OAuth2Scheme {
  const flows = options.flows ?? {};
  const hasFlow =
    flows.implicit !== undefined ||
    flows.password !== undefined ||
    flows.clientCredentials !== undefined ||
    flows.authorizationCode !== undefined;
  if (!hasFlow) {
    throw new TypeError(`oauth2Scheme: at least one OAuth2 flow is required`);
  }
  const scheme: OAuth2Scheme = { type: "oauth2", flows };
  if (options.description !== undefined) scheme.description = options.description;
  return scheme;
}

/**
 * Build an OpenAPI Security Scheme Object for OpenID Connect Discovery.
 * The `openIdConnectUrl` must be a non-empty string (typically ending in
 * `/.well-known/openid-configuration`).
 *
 * @param options - Object with the required `openIdConnectUrl`.
 * @returns A spec-shaped `{ type: "openIdConnect", openIdConnectUrl, ... }` object.
 * @throws {TypeError} When `openIdConnectUrl` is missing or empty.
 * @since 0.1.0
 */
export function openIdConnectScheme(
  options: OpenIdConnectSchemeOptions
): OpenIdConnectScheme {
  if (typeof options.openIdConnectUrl !== "string" || options.openIdConnectUrl.length === 0) {
    throw new TypeError(
      `openIdConnectScheme: "openIdConnectUrl" must be a non-empty string`
    );
  }
  const scheme: OpenIdConnectScheme = {
    type: "openIdConnect",
    openIdConnectUrl: options.openIdConnectUrl,
  };
  if (options.description !== undefined) scheme.description = options.description;
  return scheme;
}
