/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isRobotsAllowed, parseRobotsTxt } from "../robots";

describe("parseRobotsTxt", () => {
  it("parses grouped user agents and case-insensitive directives", () => {
    const groups = parseRobotsTxt(`
      # shared crawler rules
      User-Agent: FirstBot
      user-agent: SecondBot
      DISALLOW: /private
      Allow: /private/preview

      User-agent: *
      Disallow: /admin   # inline comment
      Disallow:
    `);

    expect(groups).toEqual([
      {
        agents: ["firstbot", "secondbot"],
        rules: [
          { type: "disallow", path: "/private" },
          { type: "allow", path: "/private/preview" },
        ],
      },
      {
        agents: ["*"],
        rules: [{ type: "disallow", path: "/admin" }],
      },
    ]);
  });

  it("ignores malformed lines and rules declared before a user-agent", () => {
    expect(
      parseRobotsTxt(`
        Disallow: /orphaned
        not-a-directive
        Sitemap: https://example.com/sitemap.xml
      `),
    ).toEqual([]);
  });
});

describe("isRobotsAllowed", () => {
  it("prefers the matching bot group over wildcard rules", () => {
    const robots = `
      User-agent: *
      Disallow: /

      User-agent: WebAuditPortfolioBot
      Disallow: /private
      Allow: /private/public
    `;

    expect(isRobotsAllowed(robots, "https://example.com/", "WebAuditPortfolioBot/1.0")).toBe(
      true,
    );
    expect(
      isRobotsAllowed(
        robots,
        "https://example.com/private/report",
        "WebAuditPortfolioBot/1.0",
      ),
    ).toBe(false);
    expect(
      isRobotsAllowed(
        robots,
        "https://example.com/private/public/report",
        "WebAuditPortfolioBot/1.0",
      ),
    ).toBe(true);
  });

  it("uses the longest matching rule and lets Allow win an equal-length tie", () => {
    const robots = `
      User-agent: *
      Disallow: /assets
      Allow: /assets/public
      Disallow: /same
      Allow: /same
    `;

    expect(isRobotsAllowed(robots, "https://example.com/assets/private/logo.svg")).toBe(false);
    expect(isRobotsAllowed(robots, "https://example.com/assets/public/logo.svg")).toBe(true);
    expect(isRobotsAllowed(robots, "https://example.com/same")).toBe(true);
  });

  it("supports wildcards, end anchors, and query-string matching", () => {
    const robots = `
      User-agent: *
      Disallow: /*.pdf$
      Disallow: /*?preview=true
    `;

    expect(isRobotsAllowed(robots, "https://example.com/files/guide.pdf")).toBe(false);
    expect(isRobotsAllowed(robots, "https://example.com/files/guide.pdf?download=1")).toBe(true);
    expect(isRobotsAllowed(robots, "https://example.com/article?preview=true")).toBe(false);
  });

  it("uses the rightmost wildcard match when calculating the longest match", () => {
    const robots = `
      User-agent: *
      Allow: /shop/item
      Disallow: /*item
    `;

    expect(isRobotsAllowed(robots, "https://example.com/shop/item/archive/item")).toBe(false);
  });

  it("matches adversarial wildcard rules in bounded linear time", () => {
    const wildcardCount = 1_000;
    const robots = `
      User-agent: *
      Disallow: /${"a*".repeat(wildcardCount)}blocked$
    `;
    const targetUrl = `https://example.com/${"a".repeat(40_000)}allowed`;

    const startedAt = performance.now();
    expect(isRobotsAllowed(robots, targetUrl)).toBe(true);
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("allows crawling when no group or rule applies", () => {
    const robots = `
      User-agent: OtherBot
      Disallow: /
    `;

    expect(isRobotsAllowed(robots, "https://example.com/public")).toBe(true);
    expect(isRobotsAllowed("", "https://example.com/public")).toBe(true);
  });
});
