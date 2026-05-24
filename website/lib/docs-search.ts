import type { Route } from "next";
import { cacheLife } from "next/cache";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { docsNav } from "@/components/docs-nav";

export type DocsSearchItem = {
  title: string;
  href: Route;
  description: string;
  keywords: string;
};

export type DocsSearchSection = {
  heading: string;
  items: DocsSearchItem[];
};

type DiscoveredDoc = {
  title: string;
  href: Route;
  description: string;
  keywords: string[];
  body: string;
};

const docsDir = path.join(process.cwd(), "app", "docs");

/** Per-page cap on extracted body text (chars) sent to the client. */
const BODY_INDEX_LIMIT = 2_400;

const HTML_ENTITIES: Record<string, string> = {
  "&apos;": "'",
  "&quot;": '"',
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

function decodeEntities(value: string) {
  return value.replace(/&(apos|quot|amp|lt|gt|nbsp);/g, (match) => HTML_ENTITIES[match] ?? match);
}

/**
 * Extract searchable plain text from a docs page.tsx source. We strip imports,
 * the metadata block, and JSX tags, then keep the inner text plus the contents
 * of any `code={` ... `}` template literals so things mentioned only in code
 * samples (e.g. `ui: "swagger"`) are still discoverable from cmdk.
 */
function extractBodyText(source: string): string {
  let working = source;

  // Drop imports and the metadata block — they're indexed via the metadata fields already.
  working = working.replace(/^\s*import[\s\S]*?;\s*$/gm, "");
  working = working.replace(/export\s+const\s+metadata\s*=\s*buildMetadata\(\{[\s\S]*?\}\);?/, "");

  const collected: string[] = [];

  // Pull CodeBlock template-literal payloads first so they survive tag stripping.
  for (const match of working.matchAll(/code=\{`([\s\S]*?)`\}/g)) {
    collected.push(match[1]);
  }
  working = working.replace(/code=\{`[\s\S]*?`\}/g, " ");

  // Drop JSX expression containers — most are className strings, hrefs, callbacks.
  working = working.replace(/\{[^{}]*\}/g, " ");
  // Drop opening/closing tags but keep their inner text.
  working = working.replace(/<\/?[A-Za-z][^>]*>/g, " ");

  collected.push(working);

  return decodeEntities(collected.join(" "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BODY_INDEX_LIMIT);
}

async function walkDocsPages(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => walkDocsPages(path.join(dir, entry.name))),
  );

  const pageFile = entries.some((entry) => entry.isFile() && entry.name === "page.tsx")
    ? [path.join(dir, "page.tsx")]
    : [];

  return [...pageFile, ...nestedFiles.flat()];
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getRouteFromFile(filePath: string): Route {
  const relativeDir = path.relative(docsDir, path.dirname(filePath));

  if (!relativeDir || relativeDir === ".") {
    return "/docs";
  }

  return `/docs/${relativeDir.split(path.sep).join("/")}` as Route;
}

function extractMetadata(source: string, filePath: string): DiscoveredDoc {
  const title = source.match(/title:\s*"([^"]+)"/)?.[1] ?? "Untitled";
  const description =
    source.match(/description:\s*(?:\n\s*)?"([\s\S]*?)",\s*path:/)?.[1] ??
    "Documentation page";
  const href = (source.match(/path:\s*"([^"]+)"/)?.[1] as Route | undefined) ?? getRouteFromFile(filePath);
  const keywordsBlock = source.match(/keywords:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const keywords = [...keywordsBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  return {
    title: normalizeText(title),
    href,
    description: normalizeText(description),
    keywords,
    body: extractBodyText(source),
  };
}

function getSectionForRoute(href: Route, navSectionLookup: Map<Route, string>) {
  if (navSectionLookup.has(href)) {
    return navSectionLookup.get(href) ?? "More docs";
  }

  let bestMatch: Route | "" = "";
  let matchedSection = "More docs";

  for (const [navHref, section] of navSectionLookup.entries()) {
    if (href.startsWith(`${navHref}/`) && navHref.length > bestMatch.length) {
      bestMatch = navHref;
      matchedSection = section;
    }
  }

  return matchedSection;
}

export async function getDocsSearchSections(): Promise<DocsSearchSection[]> {
  "use cache";
  cacheLife("max");

  const pageFiles = await walkDocsPages(docsDir);
  const discoveredDocs = await Promise.all(
    pageFiles.map(async (filePath) => extractMetadata(await readFile(filePath, "utf8"), filePath)),
  );

  const navOrder = new Map(docsNav.flatMap((section) => section.items.map((item, index) => [item.href, index] as const)));
  const navTitles = new Map(docsNav.flatMap((section) => section.items.map((item) => [item.href, item.title] as const)));
  const navSectionLookup = new Map(docsNav.flatMap((section) => section.items.map((item) => [item.href, section.title] as const)));

  const grouped = new Map<string, DocsSearchItem[]>();

  for (const doc of discoveredDocs) {
    const heading = getSectionForRoute(doc.href, navSectionLookup);
    const navTitle = navTitles.get(doc.href);
    const sectionItems = grouped.get(heading) ?? [];

    sectionItems.push({
      title: doc.title,
      href: doc.href,
      description: doc.description,
      keywords: [
        heading,
        doc.title,
        navTitle,
        doc.href.replaceAll("/", " "),
        doc.description,
        ...doc.keywords,
        doc.body,
      ]
        .filter(Boolean)
        .join(" "),
    });

    grouped.set(heading, sectionItems);
  }

  const orderedSections = docsNav.map((section) => section.title);
  const extraSections = [...grouped.keys()].filter((heading) => !orderedSections.includes(heading)).sort();

  return [...orderedSections, ...extraSections]
    .map((heading) => {
      const items = grouped.get(heading);

      if (!items?.length) {
        return null;
      }

      const sortedItems = items.sort((left, right) => {
        const leftOrder = navOrder.get(left.href) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = navOrder.get(right.href) ?? Number.MAX_SAFE_INTEGER;

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return left.title.localeCompare(right.title);
      });

      return { heading, items: sortedItems };
    })
    .filter((section): section is DocsSearchSection => section !== null);
}