import type { DiscoveredLink, PageMetadata } from "@/lib/types";

const SPACE_RE = /\s+/g;
const ATTRIBUTE_RE = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/g;
const MAX_URL_LENGTH = 2_048;

interface ScannedTag {
  closing: boolean;
  end: number;
  name: string;
  start: number;
}

interface OpenElement {
  attributes: Record<string, string>;
  contentStart: number;
}

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

function stripMarkup(value: string): string {
  const pieces: string[] = [];
  let cursor = 0;
  let textStart = 0;

  while (cursor < value.length) {
    const tagStart = value.indexOf("<", cursor);
    if (tagStart === -1) break;

    if (value.startsWith("<!--", tagStart)) {
      pieces.push(value.slice(textStart, tagStart));
      const commentEnd = value.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) {
        textStart = value.length;
        break;
      }
      cursor = commentEnd + 3;
      textStart = cursor;
      continue;
    }

    const tag = scanTagAt(value, tagStart);
    if (!tag) {
      cursor = tagStart + 1;
      continue;
    }
    if (tag.end === -1) break;

    pieces.push(value.slice(textStart, tagStart));
    cursor = tag.end + 1;
    textStart = cursor;

    if (!tag.closing && (tag.name === "script" || tag.name === "style")) {
      const closingTag = findRawTextClosingTag(value, tag.name, cursor);
      if (!closingTag) {
        textStart = value.length;
        break;
      }
      cursor = closingTag.end + 1;
      textStart = cursor;
    }
  }

  pieces.push(value.slice(textStart));
  return pieces.join(" ");
}

function cleanText(value: string | undefined, maxLength: number): string {
  if (!value) return "";
  return decodeEntities(stripMarkup(value))
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
  if (!value || value.length > MAX_URL_LENGTH) return "";
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    const resolved = url.toString();
    return resolved.length <= MAX_URL_LENGTH ? resolved : "";
  } catch {
    return "";
  }
}

function isAsciiNameCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    character === ":" ||
    character === "-"
  );
}

function findTagEnd(html: string, from: number): number {
  let quote = "";

  for (let index = from; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }

  return -1;
}

function scanTagAt(html: string, start: number): ScannedTag | null {
  let cursor = start + 1;
  let closing = false;

  if (html[cursor] === "/") {
    closing = true;
    cursor += 1;
  }

  const nameStart = cursor;
  while (cursor < html.length && isAsciiNameCharacter(html[cursor])) {
    cursor += 1;
  }
  if (cursor === nameStart) return null;

  const end = findTagEnd(html, cursor);
  return {
    closing,
    end,
    name: html.slice(nameStart, cursor).toLowerCase(),
    start,
  };
}

function matchesAsciiCaseInsensitive(
  value: string,
  position: number,
  expected: string,
): boolean {
  if (position + expected.length > value.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    const actualCode = value.charCodeAt(position + index);
    const foldedCode =
      actualCode >= 65 && actualCode <= 90 ? actualCode + 32 : actualCode;
    if (foldedCode !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function findRawTextClosingTag(
  html: string,
  name: "script" | "style",
  from: number,
): ScannedTag | null {
  let cursor = from;

  while (cursor < html.length) {
    const start = html.indexOf("</", cursor);
    if (start === -1) return null;
    const nameStart = start + 2;
    const boundary = html[nameStart + name.length] ?? "";
    if (
      matchesAsciiCaseInsensitive(html, nameStart, name) &&
      (!boundary || !isAsciiNameCharacter(boundary))
    ) {
      const end = findTagEnd(html, nameStart + name.length);
      if (end === -1) return null;
      return { closing: true, end, name, start };
    }
    cursor = nameStart;
  }

  return null;
}

export function extractPageData(
  html: string,
  pageUrl: string,
  linkLimit = 250,
): { metadata: PageMetadata; links: DiscoveredLink[] } {
  let title = "";
  let titleFound = false;
  let openTitle: number | undefined;
  let description = "";
  let descriptionFound = false;
  let canonical = "";
  let canonicalFound = false;
  let h1 = "";
  let firstH1Found = false;
  let h1Count = 0;
  let openH1: number | undefined;
  let openAnchor: OpenElement | undefined;

  const links: DiscoveredLink[] = [];
  const seen = new Set<string>();
  const pageOrigin = new URL(pageUrl).origin;
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart === -1) break;

    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) break;
      cursor = commentEnd + 3;
      continue;
    }

    const tag = scanTagAt(html, tagStart);
    if (!tag) {
      cursor = tagStart + 1;
      continue;
    }
    if (tag.end === -1) break;
    cursor = tag.end + 1;

    if (!tag.closing && (tag.name === "script" || tag.name === "style")) {
      const closingTag = findRawTextClosingTag(html, tag.name, cursor);
      if (!closingTag) break;
      cursor = closingTag.end + 1;
      continue;
    }

    if (tag.closing) {
      if (tag.name === "title" && openTitle !== undefined) {
        title = cleanText(html.slice(openTitle, tag.start), 300);
        titleFound = true;
        openTitle = undefined;
      } else if (tag.name === "h1" && openH1 !== undefined) {
        const value = cleanText(html.slice(openH1, tag.start), 300);
        if (!firstH1Found) {
          h1 = value;
          firstH1Found = true;
        }
        h1Count += 1;
        openH1 = undefined;
      } else if (tag.name === "a" && openAnchor) {
        if (links.length < linkLimit) {
          const relations = (openAnchor.attributes.rel ?? "")
            .toLowerCase()
            .split(SPACE_RE);
          const url = resolveHttpUrl(openAnchor.attributes.href ?? "", pageUrl);
          if (!relations.includes("nofollow") && url && !seen.has(url)) {
            seen.add(url);
            links.push({
              url,
              scope: new URL(url).origin === pageOrigin ? "internal" : "external",
              text: cleanText(html.slice(openAnchor.contentStart, tag.start), 160),
            });
          }
        }
        openAnchor = undefined;
      }
      continue;
    }

    if (tag.name === "title" && !titleFound && openTitle === undefined) {
      openTitle = tag.end + 1;
    } else if (tag.name === "h1" && openH1 === undefined) {
      openH1 = tag.end + 1;
    } else if (tag.name === "meta" && !descriptionFound) {
      const attrs = attributes(html.slice(tag.start, tag.end + 1));
      if ((attrs.name ?? "").toLowerCase() === "description") {
        description = cleanText(attrs.content, 500);
        descriptionFound = true;
      }
    } else if (tag.name === "link" && !canonicalFound) {
      const attrs = attributes(html.slice(tag.start, tag.end + 1));
      const relations = (attrs.rel ?? "").toLowerCase().split(SPACE_RE);
      if (relations.includes("canonical")) {
        canonical = resolveHttpUrl(attrs.href ?? "", pageUrl);
        canonicalFound = true;
      }
    } else if (
      tag.name === "a" &&
      openAnchor === undefined &&
      links.length < linkLimit
    ) {
      openAnchor = {
        attributes: attributes(html.slice(tag.start, tag.end + 1)),
        contentStart: tag.end + 1,
      };
    }
  }

  return {
    metadata: { title, description, canonical, h1, h1Count },
    links,
  };
}

export function normalizeTitle(title: string): string {
  return title.toLocaleLowerCase("ja-JP").replace(SPACE_RE, " ").trim();
}
