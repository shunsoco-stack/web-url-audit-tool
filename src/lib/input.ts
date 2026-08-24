const URL_COLUMN_NAMES = new Set(["url", "uri", "link", "href", "website", "ページurl", "リンク"]);

export function normalizeInputUrl(value: string): string {
  const trimmed = value.trim().replace(/^\uFEFF/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed) || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  if (/^(?:www\.)?[\p{L}\d-]+(?:\.[\p{L}\d-]+)+(?:[/:?#].*)?$/u.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function uniqueUrls(values: string[], limit = 200): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeInputUrl(value);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

export function parsePastedUrls(value: string, limit = 200): string[] {
  return uniqueUrls(value.split(/[\r\n\t ]+/), limit);
}

export function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function looksLikeUrl(value: string): boolean {
  const normalized = normalizeInputUrl(value);
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function extractUrlsFromCsv(csv: string, limit = 200): string[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];
  const headers = rows[0].map((value) => value.trim().toLocaleLowerCase("ja-JP"));
  const namedColumn = headers.findIndex((header) => URL_COLUMN_NAMES.has(header));
  const firstDataIndex = namedColumn >= 0 ? 1 : 0;
  const column =
    namedColumn >= 0
      ? namedColumn
      : Math.max(
          0,
          rows[firstDataIndex]?.findIndex((value) => looksLikeUrl(value)) ?? 0,
        );
  return uniqueUrls(rows.slice(firstDataIndex).map((row) => row[column] ?? ""), limit);
}

export function demoUrls(origin: string): string[] {
  return [
    "/api/demo/site/home",
    "/api/demo/site/about",
    "/api/demo/site/missing-metadata",
    "/api/demo/redirect/start",
    "/api/demo/status/404",
    "/api/demo/status/410",
    "/api/demo/status/500",
  ].map((path) => new URL(path, origin).toString());
}
