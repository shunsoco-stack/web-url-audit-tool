import type { AuditResult } from "@/lib/types";

const HEADERS = [
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

function safeCell(value: unknown): string {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function rowFor(result: AuditResult): string[] {
  return [
    result.inputUrl,
    result.scope,
    result.status ?? "",
    result.statusLabel,
    result.finalUrl,
    result.redirectCount,
    result.redirectChain
      .map((step) => `${step.status} ${step.url}${step.location ? ` → ${step.location}` : ""}`)
      .join(" | "),
    result.responseTimeMs ?? "",
    result.metadata.title,
    result.metadata.description,
    result.metadata.canonical,
    result.metadata.h1,
    result.internalLinks.length,
    result.externalLinks.length,
    result.issues.map((issue) => issue.label).join(" | "),
    result.checkedAt,
  ].map(safeCell);
}

function quoteCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildAuditCsv(results: AuditResult[]): string {
  const rows = [HEADERS, ...results.map(rowFor)];
  return `\uFEFF${rows.map((row) => row.map(quoteCsv).join(",")).join("\r\n")}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadAuditCsv(results: AuditResult[]): void {
  downloadBlob(
    new Blob([buildAuditCsv(results)], { type: "text/csv;charset=utf-8" }),
    `web-audit-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}

export async function downloadAuditXlsx(results: AuditResult[]): Promise<void> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const summaryRows = [
    ["WebサイトURL一括チェック・リンク監査ツール"],
    ["Exported At", new Date().toISOString()],
    ["Total URLs", results.length],
    [],
    HEADERS,
    ...results.map(rowFor),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(summaryRows);
  worksheet["!cols"] = [
    { wch: 48 },
    { wch: 12 },
    { wch: 14 },
    { wch: 18 },
    { wch: 48 },
    { wch: 16 },
    { wch: 64 },
    { wch: 18 },
    { wch: 40 },
    { wch: 56 },
    { wch: 48 },
    { wch: 36 },
    { wch: 16 },
    { wch: 16 },
    { wch: 42 },
    { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, "Audit Results");

  const issues = results.flatMap((result) =>
    result.issues.map((auditIssue) => ({
      URL: safeCell(result.inputUrl),
      Status: result.status ?? "",
      Code: auditIssue.code,
      Severity: auditIssue.severity,
      Issue: safeCell(auditIssue.label),
    })),
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(issues), "Issues");
  XLSX.writeFile(workbook, `web-audit-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
