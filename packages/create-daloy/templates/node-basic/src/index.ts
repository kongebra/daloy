import { serve } from "@daloyjs/core/node";
import { printStartupBanner, type StartupBannerLink } from "@daloyjs/core/banner";
import { buildApp } from "./build-app.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

serve(app, { port });

const url = `http://localhost:${port}`;
const links: StartupBannerLink[] = [
  // daloy-minimal:strip-start docs
  { label: "Swagger UI", url: `${url}/docs` },
  { label: "OpenAPI JSON", url: `${url}/openapi.json` },
  // daloy-minimal:strip-end docs
  { label: "Health", url: `${url}/healthz` },
];

printStartupBanner({ name: "DaloyJS API", url, runtime: "Node.js", links });

export default app;
