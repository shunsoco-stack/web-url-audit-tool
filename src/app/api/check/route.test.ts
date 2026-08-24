// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditResult } from "@/lib/types";

const { auditUrlMock } = vi.hoisted(() => ({
  auditUrlMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/http-auditor", () => ({ auditUrl: auditUrlMock }));

import { POST } from "@/app/api/check/route";

const RESULT: AuditResult = {
  id: "result-1",
  inputUrl: "https://example.com/",
  source: "direct",
  depth: 0,
  scope: "internal",
  status: 200,
  statusKind: "ok",
  statusLabel: "正常",
  finalUrl: "https://example.com/",
  redirectCount: 0,
  redirectChain: [],
  redirectLoop: false,
  responseTimeMs: 120,
  contentType: "text/html",
  metadata: { title: "Example", description: "", canonical: "", h1: "", h1Count: 0 },
  internalLinks: [],
  externalLinks: [],
  issues: [],
  broken: false,
  slow: false,
  robotsAllowed: null,
  checkedAt: "2026-08-24T00:00:00.000Z",
};

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://audit.example/api/check", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Real-IP": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
      ...headers,
    },
  });
}

describe("POST /api/check", () => {
  beforeEach(() => {
    auditUrlMock.mockReset();
    auditUrlMock.mockResolvedValue(RESULT);
  });

  it("rejects unsupported content types", async () => {
    const response = await POST(
      new Request("https://audit.example/api/check", {
        method: "POST",
        body: "url=https://example.com",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
    expect(response.status).toBe(415);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects malformed JSON and invalid payloads", async () => {
    const malformed = await POST(request("{"));
    const invalid = await POST(request(JSON.stringify({ url: 42 })));
    expect(malformed.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(auditUrlMock).not.toHaveBeenCalled();
  });

  it("rejects a body over the fixed limit even without trusting the header", async () => {
    const response = await POST(request(JSON.stringify({ url: "x".repeat(17_000) })));
    expect(response.status).toBe(413);
  });

  it("sanitizes/clamps input and returns an uncached result", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          url: "https://example.com",
          source: "crawl",
          depth: 99,
          respectRobots: true,
          slowThresholdMs: 2_500,
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ result: RESULT });
    expect(auditUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({ depth: 3, source: "crawl", respectRobots: true }),
    );
  });

  it("fails fast above three concurrent checks for the same target origin", async () => {
    const releases: Array<() => void> = [];
    auditUrlMock.mockImplementation(
      () =>
        new Promise<AuditResult>((resolve) => {
          releases.push(() => resolve(RESULT));
        }),
    );
    const makeRequest = () =>
      POST(
        request(JSON.stringify({ url: "https://same-origin.example/page" }), {
          "X-Real-IP": "203.0.113.220",
        }),
      );

    const active = [makeRequest(), makeRequest(), makeRequest()];
    await vi.waitFor(() => expect(auditUrlMock).toHaveBeenCalledTimes(3));
    const rejected = await makeRequest();

    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("1");
    releases.forEach((release) => release());
    await Promise.all(active);
  });

  it("fails fast above six active checks across different origins", async () => {
    const releases: Array<() => void> = [];
    auditUrlMock.mockImplementation(
      () =>
        new Promise<AuditResult>((resolve) => {
          releases.push(() => resolve(RESULT));
        }),
    );
    const makeRequest = (index: number) =>
      POST(
        request(JSON.stringify({ url: `https://target-${index}.example/page` }), {
          "X-Real-IP": "203.0.113.221",
        }),
      );

    const active = Array.from({ length: 6 }, (_, index) => makeRequest(index));
    await vi.waitFor(() => expect(auditUrlMock).toHaveBeenCalledTimes(6));
    const rejected = await makeRequest(7);

    expect(rejected.status).toBe(503);
    expect(rejected.headers.get("retry-after")).toBe("1");
    releases.forEach((release) => release());
    await Promise.all(active);
  });

  it("limits one client to sixty checks per minute", async () => {
    const headers = { "X-Real-IP": "203.0.113.222" };
    for (let index = 0; index < 60; index += 1) {
      const response = await POST(
        request(JSON.stringify({ url: "https://rate-limit.example/" }), headers),
      );
      expect(response.status).toBe(200);
    }

    const rejected = await POST(
      request(JSON.stringify({ url: "https://rate-limit.example/" }), headers),
    );
    expect(rejected.status).toBe(429);
    expect(auditUrlMock).toHaveBeenCalledTimes(60);
  });
});
