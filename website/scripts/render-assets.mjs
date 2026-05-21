#!/usr/bin/env node
/**
 * Rasterizes every SVG in `public/assets/source/` to PNG at platform-specific
 * sizes. Sources stay the canonical brand assets; PNGs are committed so
 * social platforms (X, Bluesky, Google profiles, app stores, etc.) and
 * Apple Touch / PWA manifests can consume them directly.
 *
 * Why PNG (and not JPEG):
 *   - The brand mark is vector with sharp anti-aliased curves; JPEG's lossy
 *     chroma subsampling produces visible halos around the strokes.
 *   - PNG supports the transparent corners on the masked monochrome mark.
 *   - Modern social platforms accept PNG up to a few MB without issue.
 *
 * Re-render the assets after editing any source SVG:
 *   pnpm run assets:render
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, "..", "public", "assets");
const SOURCE_DIR = path.join(ASSETS_DIR, "source");

/**
 * @typedef {object} Job
 * @property {string} src        Source SVG file in /public/assets/source/.
 * @property {string} out        Output PNG path relative to /public/assets/.
 * @property {number} width      Target width in px (height inferred unless `height` set).
 * @property {number} [height]   Target height in px (for non-1:1 aspect outputs).
 * @property {string} [bg]       Optional flat background color (e.g. "#0c0c0c").
 */

/** @type {Job[]} */
const JOBS = [
  // ── Browser favicons ────────────────────────────────────────────────────
  { src: "icon-dark.svg", out: "favicon-16.png", width: 16 },
  { src: "icon-dark.svg", out: "favicon-32.png", width: 32 },
  { src: "icon-dark.svg", out: "favicon-48.png", width: 48 },

  // ── iOS / Apple Touch ──────────────────────────────────────────────────
  // Apple recommends 180×180 with a fully-opaque background (no transparency).
  { src: "icon-dark.svg", out: "apple-touch-icon.png", width: 180 },

  // ── PWA / Android manifest icons ───────────────────────────────────────
  { src: "icon-dark.svg", out: "icon-192.png", width: 192 },
  { src: "icon-dark.svg", out: "icon-512.png", width: 512 },

  // ── Social profile pictures (X, Bluesky, Google, GitHub org) ───────────
  // 1000×1000 is the largest universally-accepted profile size and crops
  // cleanly to circles on X/Bluesky. 400×400 is the recommended X minimum.
  { src: "icon-dark.svg", out: "social-avatar-400.png", width: 400 },
  { src: "icon-dark.svg", out: "social-avatar-512.png", width: 512 },
  { src: "icon-dark.svg", out: "social-avatar-1000.png", width: 1000 },
  // Google Business / Workspace profile recommends 720×720 minimum.
  { src: "icon-dark.svg", out: "google-profile-720.png", width: 720 },
  // Light-background avatar variant for surfaces that need contrast.
  { src: "icon-light.svg", out: "social-avatar-light-1000.png", width: 1000 },

  // ── Social banners ─────────────────────────────────────────────────────
  // X header: 1500×500 (3:1). Bluesky banner: 3000×1000 (3:1). Same SVG.
  { src: "banner-social.svg", out: "banner-x-1500x500.png", width: 1500, height: 500 },
  {
    src: "banner-social.svg",
    out: "banner-bluesky-3000x1000.png",
    width: 3000,
    height: 1000,
  },

  // ── Static OG image fallback (some crawlers prefer a static URL) ───────
  { src: "og-image.svg", out: "og-image.png", width: 1200, height: 630 },
];

async function renderJob(/** @type {Job} */ job) {
  const srcPath = path.join(SOURCE_DIR, job.src);
  const outPath = path.join(ASSETS_DIR, job.out);
  const svg = await readFile(srcPath);
  // Default to a square output when no height is given. This is critical for
  // sharp's resize() with fit:"fill" — passing height:undefined silently
  // produces the wrong aspect ratio (sharp falls back to "inside" and
  // multiplies by the SVG's intrinsic ratio, which is unreliable for some
  // sources). Every icon job in this script is square; banners pass both.
  const targetWidth = job.width;
  const targetHeight = job.height ?? job.width;
  // Adaptive density: oversample 4× the target so anti-aliasing has headroom,
  // capped to avoid running into sharp's pixel-limit guard on huge banners.
  const targetMax = Math.max(targetWidth, targetHeight);
  const density = Math.min(1200, Math.max(96, targetMax * 4));
  const pipeline = sharp(svg, {
    density,
    // Banners can exceed sharp's default 268MP guard at 4× oversample.
    limitInputPixels: false,
  }).resize({
    width: targetWidth,
    height: targetHeight,
    fit: "fill",
    kernel: "lanczos3",
  });
  if (job.bg) {
    pipeline.flatten({ background: job.bg });
  }
  // Small icons compress dramatically better as 8-bit indexed PNGs without
  // visible quality loss; large social art keeps full 24-bit color.
  const usePalette = targetMax <= 64;
  await pipeline
    .png({
      compressionLevel: 9,
      palette: usePalette,
      quality: usePalette ? 90 : 100,
      effort: 10,
    })
    .toFile(outPath);
  return outPath;
}

async function main() {
  await mkdir(ASSETS_DIR, { recursive: true });
  const failures = [];
  for (const job of JOBS) {
    try {
      const out = await renderJob(job);
      const sizeLabel = job.height ? `${job.width}x${job.height}` : `${job.width}`;
      console.log(`  rendered  ${path.relative(ASSETS_DIR, out)}  (${sizeLabel}px)`);
    } catch (err) {
      failures.push({ job, err });
      console.error(`  failed    ${job.out}:`, err instanceof Error ? err.message : err);
    }
  }
  // Build a combined multi-resolution favicon.ico (16, 32, 48 PNG inputs).
  // sharp doesn't write ICO directly, so we keep the per-size PNGs and the
  // app/favicon.ico file untouched — browsers happily use either.
  if (failures.length > 0) {
    console.error(`\n${failures.length} asset(s) failed to render.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nDone. ${JOBS.length} asset(s) written to ${path.relative(process.cwd(), ASSETS_DIR)}/.`);
  // Quick byte-size summary for the README.
  const sizes = await Promise.all(
    JOBS.map(async (j) => {
      const fp = path.join(ASSETS_DIR, j.out);
      const buf = await readFile(fp);
      return { name: j.out, bytes: buf.length };
    }),
  );
  const total = sizes.reduce((acc, s) => acc + s.bytes, 0);
  console.log(`Total bytes: ${(total / 1024).toFixed(1)} KiB`);
  // Write a manifest so build steps can verify nothing was deleted.
  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: "scripts/render-assets.mjs",
    source: "public/assets/source/",
    files: sizes,
  };
  await writeFile(
    path.join(ASSETS_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
