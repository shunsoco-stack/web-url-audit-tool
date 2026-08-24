import { describe, expect, it } from "vitest";

import { extractPageData, normalizeTitle } from "../metadata";

describe("extractPageData", () => {
  it("extracts and normalizes the supported metadata fields", () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>  Web &amp; <em>SEO</em> Audit  </title>
          <meta CONTENT="A&nbsp;clear &quot;description&quot;" NAME="Description">
          <link href="/preferred?page=1#summary" rel="alternate CANONICAL">
        </head>
        <body>
          <h1> Main <span>heading</span> </h1>
          <h1>Secondary heading</h1>
        </body>
      </html>
    `;

    const { metadata } = extractPageData(html, "https://example.com/articles/current");

    expect(metadata).toEqual({
      title: "Web & SEO Audit",
      description: 'A clear "description"',
      canonical: "https://example.com/preferred?page=1",
      h1: "Main heading",
      h1Count: 2,
    });
  });

  it("returns empty metadata values for a page without metadata", () => {
    const { metadata } = extractPageData(
      "<html><head></head><body><p>Content only</p></body></html>",
      "https://example.com/empty",
    );

    expect(metadata).toEqual({
      title: "",
      description: "",
      canonical: "",
      h1: "",
      h1Count: 0,
    });
  });

  it("ignores a canonical URL that does not use HTTP or HTTPS", () => {
    const { metadata } = extractPageData(
      '<link rel="canonical" href="javascript:alert(1)">',
      "https://example.com/page",
    );

    expect(metadata.canonical).toBe("");
  });

  it("extracts unique HTTP links, classifies their scope, and skips nofollow links", () => {
    const html = `
      <a href="/about#team"> About <strong>us</strong> </a>
      <a href="https://example.com/about#history">Duplicate fragment</a>
      <a href="//example.com/contact">Contact</a>
      <a href="https://outside.example/news?a=1&amp;b=2">External &amp; news</a>
      <a href="/ignored" rel="ugc nofollow">Ignored</a>
      <a href="mailto:hello@example.com">Email</a>
      <a href="javascript:void(0)">Script</a>
    `;

    const { links } = extractPageData(html, "https://example.com/start");

    expect(links).toEqual([
      {
        url: "https://example.com/about",
        scope: "internal",
        text: "About us",
      },
      {
        url: "https://example.com/contact",
        scope: "internal",
        text: "Contact",
      },
      {
        url: "https://outside.example/news?a=1&b=2",
        scope: "external",
        text: "External & news",
      },
    ]);
  });

  it("honors the link limit", () => {
    const html = `
      <a href="/one">One</a>
      <a href="/two">Two</a>
      <a href="/three">Three</a>
    `;

    const { links } = extractPageData(html, "https://example.com/", 2);

    expect(links.map((link) => link.url)).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);
  });

  it("bounds exported metadata and anchor text lengths", () => {
    const html = `
      <title>${"T".repeat(350)}</title>
      <meta name="description" content="${"D".repeat(550)}">
      <h1>${"H".repeat(350)}</h1>
      <a href="/long">${"L".repeat(200)}</a>
    `;

    const { metadata, links } = extractPageData(html, "https://example.com/");

    expect(metadata.title).toHaveLength(300);
    expect(metadata.description).toHaveLength(500);
    expect(metadata.h1).toHaveLength(300);
    expect(links[0]?.text).toHaveLength(160);
  });
});

describe("normalizeTitle", () => {
  it("normalizes case and whitespace for duplicate-title detection", () => {
    expect(normalizeTitle("  WEB\n\t監査   Tool  ")).toBe("web 監査 tool");
  });
});
