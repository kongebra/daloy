import { dirname } from "node:path"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))

const FALLBACK_CORE_PACKAGE_VERSION = "0.13.2"

function getPublishedCorePackageVersion() {
  if (process.env.NEXT_PUBLIC_CORE_PACKAGE_VERSION) {
    return process.env.NEXT_PUBLIC_CORE_PACKAGE_VERSION
  }

  try {
    return execSync("npm view @daloyjs/core version", {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return FALLBACK_CORE_PACKAGE_VERSION
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    viewTransition: true,
    // Tree-shake/inline these packages into the importer's chunk so they
    // don't end up as standalone vendor chunks with random hash names that
    // some corporate web filters (Zscaler/Umbrella/Forcepoint) block as
    // suspicious-looking files. See `webpack` hook below for the matching
    // deterministic chunk-name configuration.
    optimizePackageImports: ["cmdk", "@phosphor-icons/react"],
  },
  // Pin the workspace root to this site so Next.js doesn't walk up into the
  // framework's `src/` (which has a `middleware.ts` that is NOT a Next.js
  // edge middleware).
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  env: {
    NEXT_PUBLIC_CORE_PACKAGE_VERSION: getPublishedCorePackageVersion(),
  },
  // Force deterministic, human-readable chunk filenames. The default hashed
  // IDs (e.g. `0z914mjk4kksg.js`) look like DGA/obfuscated payloads to many
  // corporate proxies and get blocked with a 403 before reaching the browser.
  // Named chunks like `vendor-cmdk-<hash>.js` reliably pass those filters.
  // NOTE: only applied when building with webpack (`next build --webpack`).
  // Turbopack production builds use their own chunk naming.
  webpack(config, { dev }) {
    if (!dev) {
      config.optimization = {
        ...config.optimization,
        chunkIds: "named",
        moduleIds: "named",
      }
    }
    return config
  },
  async redirects() {
    return [
      // The sidebar labels the docs landing page "Introduction" but it lives at
      // /docs. External links and bookmarks pointing at /docs/introduction
      // should land on the same page instead of 404ing.
      { source: "/docs/introduction", destination: "/docs", permanent: true },
    ]
  },
}

export default nextConfig
