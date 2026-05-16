import { serve } from "@daloyjs/core/bun";
import { printStartupBanner, type StartupBannerLink } from "@daloyjs/core/banner";
import { buildApp } from "./build-app.ts";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

const handle = serve(app, {
  port,
  // Bun closes idle keep-alive connections after this many seconds.
  idleTimeout: 30,
});

const url = handle.url ? String(handle.url) : `http://localhost:${port}`;
const links: StartupBannerLink[] = [
  // daloy-minimal:strip-start docs
  { label: "Swagger UI", url: `${url}/docs` },
  { label: "OpenAPI JSON", url: `${url}/openapi.json` },
  // daloy-minimal:strip-end docs
  { label: "Health", url: `${url}/healthz` },
];

printStartupBanner({ name: "DaloyJS API", url, runtime: "Bun", links });

export default app;
