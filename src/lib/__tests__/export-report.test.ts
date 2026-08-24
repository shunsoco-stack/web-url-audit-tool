import { describe, expect, it } from "vitest";

import { buildAuditCsv } from "../export-report";
import { parseCsvRows } from "../input";
import type { AuditResult } from "../types";

const EXPECTED_HEADERS = [
  "Input URL",
  "Scope",
  "HTTP Status",
  "Status Label",
  "Final URL",
  "Redirect Count",
  "Redirect Chain",
  "Response Time (ms)",
  "Title",
  "Description",
  "Canonical",
  "H1",
  "Internal Links",
  "External Links",
  "Issues",
  "Checked At",
];

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
    responseTimeMs: 125,
    contentType: "text/html; charset=utf-8",
    metadata: {
      title: "Audit page",
      description: "Page description",
      canonical: "https://example.com/page",
      h1: "Audit heading",
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

function exportedRows(result: AuditResult): string[][] {
  const csv = buildAuditCsv([result]);
  return parseCsvRows(csv.slice(1));
}

describe("buildAuditCsv", () => {
  it("writes a UTF-8 BOM and the complete ordered export columns", () => {
    const csv = buildAuditCsv([]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(parseCsvRows(csv.slice(1))).toEqual([EXPECTED_HEADERS]);
  });

  it("exports status, link counts, issues, and the complete redirect chain", () => {
    const result = auditResult({
      status: 301,
      statusKind: "redirect",
      statusLabel: "3xx Redirect",
      finalUrl: "https://example.com/final",
      redirectCount: 2,
      redirectChain: [
        {
          url: "https://example.com/start",
          status: 301,
          location: "https://example.com/middle",
          responseTimeMs: 30,
        },
        {
          url: "https://example.com/middle",
          status: 302,
          location: "https://example.com/final",
          responseTimeMs: 40,
        },
        {
          url: "https://example.com/final",
          status: 200,
          responseTimeMs: 55,
        },
      ],
      internalLinks: [
        { url: "https://example.com/a", scope: "internal", text: "A" },
        { url: "https://example.com/b", scope: "internal", text: "B" },
      ],
      externalLinks: [
        { url: "https://outside.example/", scope: "external", text: "Outside" },
      ],
      issues: [
        { code: "MISSING_DESCRIPTION", label: "Descriptionなし", severity: "warning" },
        { code: "SLOW_RESPONSE", label: "応答が遅い", severity: "warning" },
      ],
    });

    const [headers, row] = exportedRows(result);
    const value = Object.fromEntries(headers.map((header, index) => [header, row[index]]));

    expect(value).toMatchObject({
      "HTTP Status": "301",
      "Status Label": "3xx Redirect",
      "Final URL": "https://example.com/final",
      "Redirect Count": "2",
      "Redirect Chain":
        "301 https://example.com/start → https://example.com/middle | " +
        "302 https://example.com/middle → https://example.com/final | " +
        "200 https://example.com/final",
      "Response Time (ms)": "125",
      "Internal Links": "2",
      "External Links": "1",
      Issues: "Descriptionなし | 応答が遅い",
    });
  });

  it("quotes every CSV cell and escapes commas, quotes, and newlines losslessly", () => {
    const result = auditResult({
      inputUrl: "https://example.com/page?tags=one,two",
      metadata: {
        title: 'A "quoted", title',
        description: "Line one\nLine two",
        canonical: "https://example.com/page?tags=one,two",
        h1: 'Heading "one"',
        h1Count: 1,
      },
    });

    const csv = buildAuditCsv([result]);
    const [, row] = exportedRows(result);

    expect(csv).toContain('"https://example.com/page?tags=one,two"');
    expect(csv).toContain('"A ""quoted"", title"');
    expect(csv).toContain('"Line one\nLine two"');
    expect(row[0]).toBe(result.inputUrl);
    expect(row[8]).toBe(result.metadata.title);
    expect(row[9]).toBe(result.metadata.description);
    expect(row[11]).toBe(result.metadata.h1);
    expect(csv.slice(1).split("\r\n")[0]).toMatch(/^("[^"]*",){15}"[^"]*"$/);
  });

  it("prefixes spreadsheet formula triggers in every attacker-controlled text field", () => {
    const result = auditResult({
      inputUrl: '=HYPERLINK("https://evil.example")',
      scope: "external",
      statusLabel: "+SUM(1,1)",
      finalUrl: "-1+1",
      metadata: {
        title: "@SUM(1,1)",
        description: "=cmd|' /C calc'!A0",
        canonical: "+malicious",
        h1: "-malicious",
        h1Count: 1,
      },
      issues: [
        { code: "REQUEST_FAILED", label: "@malicious", severity: "error" },
      ],
      checkedAt: "=NOW()",
    });

    const [headers, row] = exportedRows(result);
    const value = Object.fromEntries(headers.map((header, index) => [header, row[index]]));

    expect(value).toMatchObject({
      "Input URL": '\'=HYPERLINK("https://evil.example")',
      "Status Label": "'+SUM(1,1)",
      "Final URL": "'-1+1",
      Title: "'@SUM(1,1)",
      Description: "'=cmd|' /C calc'!A0",
      Canonical: "'+malicious",
      H1: "'-malicious",
      Issues: "'@malicious",
      "Checked At": "'=NOW()",
    });
  });
});
