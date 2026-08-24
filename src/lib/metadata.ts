import type { DiscoveredLink, PageMetadata } from "@/lib/types";

const TAG_RE = /<[^>]*>/g;
const SPACE_RE = /\s+/g;
const ATTRIBUTE_RE = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x?[\da-f]+|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, token: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      };
      const lower = token.toLowerCase();
      if (named[lower]) return named[lower];
      const radix = lower.startsWith("#x") ? 16 : 10;
      const raw = lower.replace(/^#x?/, "");
      const codePoint = Number.parseInt(raw, radix);
      if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return entity;
      return String.fromCodePoint(codePoint);
    },
  );
}

function cleanText(value: string | undefined, maxLength: number): string {
  if (!value) return "";
  return decodeEntities(value.replace(TAG_RE, " "))
    .replace(SPACE_RE, " ")
    .trim()
    .slice(0, maxLength);
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  let match: RegExpExecArray | null;
  ATTRIBUTE_RE.lastIndex = 0;
  while ((match = ATTRIBUTE_RE.exec(tag))) {
    result[match[1].toLowerCase()] = decodeEntities(
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  }
  return result;
}

function resolveHttpUrl(value: string, baseUrl: string): string {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function extractMeta(html: string, name: string): string {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const attrs = attributes(tag);
    if ((attrs.name ?? "").toLowerCase() === name) {
      return cleanText(attrs.content, 500);
    }
  }
  return "";
}

function extractCanonical(html: string, baseUrl: string): string {
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const attrs = attributes(tag);
    const relations = (attrs.rel ?? "").toLowerCase().split(SPACE_RE);
    if (relations.includes("canonical")) {
      return resolveHttpUrl(attrs.href ?? "", baseUrl);
    }
  }
  return "";
}

export function extractPageData(
  html: string,
  pageUrl: string,
  linkLimit = 250,
): { metadata: PageMetadata; links: DiscoveredLink[] } {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const h1Matches = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)];
  const metadata: PageMetadata = {
    title: cleanText(titleMatch?.[1], 300),
    description: extractMeta(html, "description"),
    canonical: extractCanonical(html, pageUrl),
    h1: cleanText(h1Matches[0]?.[1], 300),
    h1Count: h1Matches.length,
  };

  const links: DiscoveredLink[] = [];
  const seen = new Set<string>();
  const pageOrigin = new URL(pageUrl).origin;
  const anchorTags = html.match(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi) ?? [];

  for (const tag of anchorTags) {
    if (links.length >= linkLimit) break;
    const openingTag = tag.match(/^<a\b[^>]*>/i)?.[0] ?? tag;
    const attrs = attributes(openingTag);
    const relations = (attrs.rel ?? "").toLowerCase().split(SPACE_RE);
    if (relations.includes("nofollow")) continue;
    const url = resolveHttpUrl(attrs.href ?? "", pageUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({
      url,
      scope: new URL(url).origin === pageOrigin ? "internal" : "external",
      text: cleanText(tag.replace(/^<a\b[^>]*>/i, "").replace(/<\/a\s*>$/i, ""), 160),
    });
  }

  return { metadata, links };
}

export function normalizeTitle(title: string): string {
  return title.toLocaleLowerCase("ja-JP").replace(SPACE_RE, " ").trim();
}
