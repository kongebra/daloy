import { serve } from "@daloyjs/core/deno";
import { buildApp } from "./build-app.ts";

const app = buildApp();
const port = Number(Deno.env.get("PORT") ?? 3000);

serve(app, {
  port,
  onListen: ({ hostname, port: actualPort }) => {
    console.log(`DaloyJS (Deno) listening on http://${hostname}:${actualPort}`);
    // daloy-minimal:strip-start docs
    console.log(`  Swagger UI:   http://${hostname}:${actualPort}/docs`);
    console.log(`  OpenAPI JSON: http://${hostname}:${actualPort}/openapi.json`);
    // daloy-minimal:strip-end docs
    console.log(`  Health:       http://${hostname}:${actualPort}/healthz`);
  },
});
