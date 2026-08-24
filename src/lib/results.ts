import { normalizeTitle } from "@/lib/metadata";
import type { AuditResult, AuditRunSnapshot, RunComparison } from "@/lib/types";

export interface AuditSummary {
  total: number;
  ok: number;
  redirects: number;
  broken: number;
  serverErrors: number;
  slow: number;
  missingMetadata: number;
  failed: number;
}

export function hasMissingMetadata(result: AuditResult): boolean {
  return result.issues.some((issue) =>
    ["MISSING_TITLE", "MISSING_DESCRIPTION", "MISSING_CANONICAL", "MISSING_H1"].includes(
      issue.code,
    ),
  );
}

export function summarizeResults(results: AuditResult[]): AuditSummary {
  return results.reduce<AuditSummary>(
    (summary, result) => {
      summary.total += 1;
      if (result.statusKind === "ok") summary.ok += 1;
      if (result.statusKind === "redirect") summary.redirects += 1;
      if (result.broken) summary.broken += 1;
      if (result.status !== null && result.status >= 500) summary.serverErrors += 1;
      if (result.slow) summary.slow += 1;
      if (hasMissingMetadata(result)) summary.missingMetadata += 1;
      if (result.statusKind === "failed" || result.statusKind === "blocked") summary.failed += 1;
      return summary;
    },
    {
      total: 0,
      ok: 0,
      redirects: 0,
      broken: 0,
      serverErrors: 0,
      slow: 0,
      missingMetadata: 0,
      failed: 0,
    },
  );
}

export function duplicateTitleIds(results: AuditResult[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const result of results) {
    const title = normalizeTitle(result.metadata.title);
    if (!title) continue;
    const ids = groups.get(title) ?? [];
    ids.push(result.id);
    groups.set(title, ids);
  }
  return new Set(
    [...groups.values()].filter((ids) => ids.length > 1).flatMap((ids) => ids),
  );
}

function comparisonKey(result: AuditResult): string {
  try {
    const url = new URL(result.inputUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return result.inputUrl.trim().toLocaleLowerCase("en-US");
  }
}

export function compareRuns(
  previous: AuditRunSnapshot | null,
  current: AuditResult[],
): RunComparison {
  if (!previous) return { newBroken: [], fixed: [], newRedirects: [] };
  const before = new Map(previous.results.map((result) => [comparisonKey(result), result]));
  const newBroken: AuditResult[] = [];
  const fixed: AuditResult[] = [];
  const newRedirects: AuditResult[] = [];

  for (const result of current) {
    const old = before.get(comparisonKey(result));
    if (result.broken && !old?.broken) newBroken.push(result);
    if (!result.broken && old?.broken) fixed.push(result);
    if (result.statusKind === "redirect" && old?.statusKind !== "redirect") {
      newRedirects.push(result);
    }
  }
  return { newBroken, fixed, newRedirects };
}

export function shouldRecheck(result: AuditResult): boolean {
  return (
    result.broken ||
    result.statusKind === "client-error" ||
    result.statusKind === "server-error" ||
    result.statusKind === "failed" ||
    result.statusKind === "blocked"
  );
}
