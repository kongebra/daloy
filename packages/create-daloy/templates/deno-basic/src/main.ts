import { serve } from "@daloyjs/core/deno";
import { printStartupBanner, type StartupBannerLink } from "@daloyjs/core/banner";
import { buildApp } from "./build-app.ts";

const app = buildApp();
const port = Number(Deno.env.get("PORT") ?? 3000);

serve(app, {
  port,
  onListen: ({ hostname, port: actualPort }) => {
    const url = `http://${hostname}:${actualPort}`;
    const links: StartupBannerLink[] = [
      // daloy-minimal:strip-start docs
      { label: "API docs", url: `${url}/docs` },
      { label: "OpenAPI JSON", url: `${url}/openapi.json` },
      { label: "OpenAPI YAML", url: `${url}/openapi.yaml` },
      // daloy-minimal:strip-end docs
      { label: "Health", url: `${url}/healthz` },
    ];
    printStartupBanner({ name: "DaloyJS API", url, runtime: "Deno", links });
  },
});
