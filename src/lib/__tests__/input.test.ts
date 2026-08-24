import { describe, expect, it } from "vitest";

import {
  demoUrls,
  extractUrlsFromCsv,
  normalizeInputUrl,
  parseCsvRows,
  parsePastedUrls,
  uniqueUrls,
} from "../input";

describe("normalizeInputUrl", () => {
  it.each([
    [" example.com/path?q=1 ", "https://example.com/path?q=1"],
    ["www.example.com", "https://www.example.com"],
    ["例.jp/監査", "https://例.jp/監査"],
    ["\uFEFFhttps://example.com", "https://example.com"],
    ["HTTPS://Example.com/Case", "HTTPS://Example.com/Case"],
    ["mailto:team@example.com", "mailto:team@example.com"],
    ["not a url", "not a url"],
    ["   ", ""],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeInputUrl(input)).toBe(expected);
  });
});

describe("URL list input", () => {
  it("normalizes, removes blanks, and deduplicates while preserving first-seen order", () => {
    expect(
      uniqueUrls([
        " Example.com/First ",
        "",
        "https://SECOND.example/path",
        "example.com/first",
        "https://second.example/PATH",
        "third.example",
      ]),
    ).toEqual([
      "https://Example.com/First",
      "https://SECOND.example/path",
      "https://third.example",
    ]);
  });

  it("splits pasted URLs on spaces, tabs, and either newline style", () => {
    expect(
      parsePastedUrls(
        "one.example\ttwo.example\r\nhttps://three.example/path\nONE.example",
      ),
    ).toEqual([
      "https://one.example",
      "https://two.example",
      "https://three.example/path",
    ]);
  });

  it("applies the URL limit after deduplication", () => {
    expect(uniqueUrls(["one.example", "ONE.example", "two.example", "three.example"], 2)).toEqual([
      "https://one.example",
      "https://two.example",
    ]);
  });
});

describe("CSV input", () => {
  it("parses RFC-style quoted commas, escaped quotes, CRLF, and embedded newlines", () => {
    const csv =
      'URL,Label\r\n"https://example.com/a?tags=one,two","Alpha, Beta"\r\n' +
      '"https://example.com/quoted","She said ""hello""\r\non two lines"\r\n';

    expect(parseCsvRows(csv)).toEqual([
      ["URL", "Label"],
      ["https://example.com/a?tags=one,two", "Alpha, Beta"],
      ["https://example.com/quoted", 'She said "hello"\r\non two lines'],
    ]);
  });

  it("imports a quoted URL column by its case-insensitive header and deduplicates URLs", () => {
    const csv =
      '\uFEFF"Name"," URL ","Note"\r\n' +
      '"First","example.com/a?tags=one,two","quoted, value"\r\n' +
      '"Duplicate","EXAMPLE.COM/A?TAGS=ONE,TWO","same URL"\r\n' +
      '"Second","https://example.com/b","plain"\r\n';

    expect(extractUrlsFromCsv(csv)).toEqual([
      "https://example.com/a?tags=one,two",
      "https://example.com/b",
    ]);
  });

  it("uses the first URL-looking column when no recognized header exists", () => {
    const csv =
      "Page One,example.com/one,Owner A\n" +
      "Page Two,https://example.com/two,Owner B\n";

    expect(extractUrlsFromCsv(csv)).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);
  });

  it("returns no URLs for an empty CSV", () => {
    expect(extractUrlsFromCsv("\r\n\r\n")).toEqual([]);
  });
});

describe("demoUrls", () => {
  it("builds the complete safe demo dataset against the supplied origin", () => {
    expect(demoUrls("https://audit.example/workbench?mode=demo")).toEqual([
      "https://audit.example/api/demo/site/home",
      "https://audit.example/api/demo/site/about",
      "https://audit.example/api/demo/site/missing-metadata",
      "https://audit.example/api/demo/redirect/start",
      "https://audit.example/api/demo/status/404",
      "https://audit.example/api/demo/status/410",
      "https://audit.example/api/demo/status/500",
    ]);
  });
});
