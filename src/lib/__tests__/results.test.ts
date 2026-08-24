import { describe, expect, it } from "vitest";

import type { AuditResult, AuditRunSnapshot, StatusKind } from "../types";
import {
  compareRuns,
  duplicateTitleIds,
  hasMissingMetadata,
  shouldRecheck,
  summarizeResults,
} from "../results";

function auditResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    id: "result-1",
    inputUrl: "https://example.com/page",
    source: "direct",
    depth: 0,
    scope: "internal",
    status: 200,
    statusKind: "ok",
    statusLabel: "2xx 正常",
    finalUrl: "https://example.com/page",
    redirectCount: 0,
    redirectChain: [],
    redirectLoop: false,
    responseTimeMs: 120,
    contentType: "text/html; charset=utf-8",
    metadata: {
      title: "Page title",
      description: "Page description",
      canonical: "https://example.com/page",
      h1: "Page heading",
      h1Count: 1,
    },
    internalLinks: [],
    externalLinks: [],
    issues: [],
    broken: false,
    slow: false,
    robotsAllowed: true,
    checkedAt: "2026-08-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeResults", () => {
  it("counts every dashboard category independently", () => {
    const results = [
      auditResult({
        id: "ok",
        slow: true,
        issues: [
          { code: "MISSING_TITLE", label: "Titleなし", severity: "warning" },
        ],
      }),
      auditResult({ id: "redirect", status: 301, statusKind: "redirect" }),
      auditResult({
        id: "broken",
        status: 404,
        statusKind: "client-error",
        broken: true,
      }),
      auditResult({ id: "server", status: 500, statusKind: "server-error" }),
      auditResult({ id: "failed", status: null, statusKind: "failed" }),
      auditResult({ id: "blocked", status: null, statusKind: "blocked" }),
    ];

    expect(summarizeResults(results)).toEqual({
      total: 6,
      ok: 1,
      redirects: 1,
      broken: 1,
      serverErrors: 1,
      slow: 1,
      missingMetadata: 1,
      failed: 2,
    });
  });

  it("returns zeroes for an empty result set", () => {
    expect(summarizeResults([])).toEqual({
      total: 0,
      ok: 0,
      redirects: 0,
      broken: 0,
      serverErrors: 0,
      slow: 0,
      missingMetadata: 0,
      failed: 0,
    });
  });
});

describe("metadata issue filtering", () => {
  it.each([
    "MISSING_TITLE",
    "MISSING_DESCRIPTION",
    "MISSING_CANONICAL",
    "MISSING_H1",
  ] as const)("matches the %s issue", (code) => {
    const result = auditResult({
      issues: [{ code, label: code, severity: "warning" }],
    });

    expect(hasMissingMetadata(result)).toBe(true);
  });

  it("does not match unrelated issues", () => {
    expect(
      hasMissingMetadata(
        auditResult({
          issues: [{ code: "SLOW_RESPONSE", label: "遅い", severity: "warning" }],
        }),
      ),
    ).toBe(false);
  });
});

describe("duplicateTitleIds", () => {
  it("finds all IDs in case- and whitespace-normalized title groups", () => {
    const duplicates = duplicateTitleIds([
      auditResult({ id: "a", metadata: { ...auditResult().metadata, title: " Web   Audit " } }),
      auditResult({ id: "b", metadata: { ...auditResult().metadata, title: "web\n audit" } }),
      auditResult({ id: "c", metadata: { ...auditResult().metadata, title: "Unique" } }),
      auditResult({ id: "blank-1", metadata: { ...auditResult().metadata, title: "" } }),
      auditResult({ id: "blank-2", metadata: { ...auditResult().metadata, title: "   " } }),
    ]);

    expect([...duplicates].sort()).toEqual(["a", "b"]);
  });
});

describe("compareRuns", () => {
  it("reports new broken URLs, fixed URLs, and new redirects against the prior run", () => {
    const previousResults = [
      auditResult({ id: "old-new-broken", inputUrl: "https://EXAMPLE.com/new-broken#old" }),
      auditResult({
        id: "old-fixed",
        inputUrl: "https://example.com/fixed#before",
        status: 404,
        statusKind: "client-error",
        broken: true,
      }),
      auditResult({ id: "old-moved", inputUrl: "https://example.com/moved" }),
      auditResult({
        id: "old-still-broken",
        inputUrl: "https://example.com/still-broken",
        status: 410,
        statusKind: "client-error",
        broken: true,
      }),
      auditResult({
        id: "old-redirect",
        inputUrl: "https://example.com/already-redirect",
        status: 301,
        statusKind: "redirect",
      }),
    ];
    const previous: AuditRunSnapshot = {
      id: "run-before",
      name: "前回監査",
      createdAt: "2026-08-23T00:00:00.000Z",
      results: previousResults,
    };
    const current = [
      auditResult({
        id: "new-broken",
        inputUrl: "https://example.com/new-broken#current",
        status: 404,
        statusKind: "client-error",
        broken: true,
      }),
      auditResult({ id: "fixed", inputUrl: "https://example.com/fixed" }),
      auditResult({
        id: "new-redirect",
        inputUrl: "https://example.com/moved",
        status: 301,
        statusKind: "redirect",
      }),
      auditResult({
        id: "still-broken",
        inputUrl: "https://example.com/still-broken",
        status: 404,
        statusKind: "client-error",
        broken: true,
      }),
      auditResult({
        id: "still-redirect",
        inputUrl: "https://example.com/already-redirect",
        status: 302,
        statusKind: "redirect",
      }),
      auditResult({
        id: "brand-new-broken",
        inputUrl: "https://example.com/not-in-previous-run",
        status: 404,
        statusKind: "client-error",
        broken: true,
      }),
    ];

    const comparison = compareRuns(previous, current);

    expect(comparison.newBroken.map(({ id }) => id)).toEqual([
      "new-broken",
      "brand-new-broken",
    ]);
    expect(comparison.fixed.map(({ id }) => id)).toEqual(["fixed"]);
    expect(comparison.newRedirects.map(({ id }) => id)).toEqual(["new-redirect"]);
  });

  it("returns empty comparison groups without a prior snapshot", () => {
    expect(compareRuns(null, [auditResult({ broken: true })])).toEqual({
      newBroken: [],
      fixed: [],
      newRedirects: [],
    });
  });

  it("normalizes invalid URL keys by trimming and lowercasing them", () => {
    const previous: AuditRunSnapshot = {
      id: "run-before",
      name: "前回監査",
      createdAt: "2026-08-23T00:00:00.000Z",
      results: [
        auditResult({
          inputUrl: "  INVALID TARGET  ",
          status: 404,
          statusKind: "client-error",
          broken: true,
        }),
      ],
    };

    expect(compareRuns(previous, [auditResult({ inputUrl: "invalid target" })]).fixed).toHaveLength(1);
  });
});

describe("shouldRecheck", () => {
  it.each([
    ["ok", false],
    ["redirect", false],
    ["client-error", true],
    ["server-error", true],
    ["failed", true],
    ["blocked", true],
  ] satisfies Array<[StatusKind, boolean]>)
  ("returns %s => %s", (statusKind, expected) => {
    expect(shouldRecheck(auditResult({ statusKind }))).toBe(expected);
  });

  it("rechecks a broken result even if its status kind is otherwise OK", () => {
    expect(shouldRecheck(auditResult({ statusKind: "ok", broken: true }))).toBe(true);
  });
});
