import "server-only";

interface RobotRule {
  type: "allow" | "disallow";
  path: string;
}

interface RobotGroup {
  agents: string[];
  rules: RobotRule[];
}

function cleanLine(line: string): string {
  return line.replace(/#.*$/, "").trim();
}

export function parseRobotsTxt(content: string): RobotGroup[] {
  const groups: RobotGroup[] = [];
  let group: RobotGroup | null = null;
  let hasRule = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = cleanLine(rawLine);
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "user-agent") {
      if (!group || hasRule) {
        group = { agents: [], rules: [] };
        groups.push(group);
        hasRule = false;
      }
      group.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && group) {
      if (value || key === "allow") {
        group.rules.push({ type: key, path: value });
      }
      hasRule = true;
    }
  }
  return groups;
}

interface LiteralSegment {
  value: string;
  prefix: number[];
}

// KMP prefix tables keep glob matching linear without RegExp backtracking.
function compileLiteral(value: string): LiteralSegment {
  const prefix = new Array<number>(value.length).fill(0);
  for (let index = 1, matched = 0; index < value.length; index += 1) {
    while (matched > 0 && value[index] !== value[matched]) {
      matched = prefix[matched - 1];
    }
    if (value[index] === value[matched]) matched += 1;
    prefix[index] = matched;
  }
  return { value, prefix };
}

function findFirstLiteral(
  target: string,
  literal: LiteralSegment,
  start: number,
  end = target.length,
): number {
  let matched = 0;
  for (let index = start; index < end; index += 1) {
    while (matched > 0 && target[index] !== literal.value[matched]) {
      matched = literal.prefix[matched - 1];
    }
    if (target[index] === literal.value[matched]) matched += 1;
    if (matched === literal.value.length) {
      return index - literal.value.length + 1;
    }
  }
  return -1;
}

function findLastLiteral(target: string, literal: LiteralSegment, start: number): number {
  let last = -1;
  let matched = 0;
  for (let index = start; index < target.length; index += 1) {
    while (matched > 0 && target[index] !== literal.value[matched]) {
      matched = literal.prefix[matched - 1];
    }
    if (target[index] === literal.value[matched]) matched += 1;
    if (matched === literal.value.length) {
      last = index - literal.value.length + 1;
      matched = literal.prefix[matched - 1];
    }
  }
  return last;
}

function matchLength(rulePath: string, pathname: string): number {
  if (!rulePath) return 0;

  const anchored = rulePath.endsWith("$");
  const pattern = anchored ? rulePath.slice(0, -1) : rulePath;
  const hasWildcard = pattern.includes("*");

  if (!hasWildcard) {
    const matches = anchored ? pathname === pattern : pathname.startsWith(pattern);
    return matches ? pattern.length : -1;
  }

  const startsWithWildcard = pattern.startsWith("*");
  const endsWithWildcard = pattern.endsWith("*");
  const literals = pattern
    .split("*")
    .filter((value) => value.length > 0)
    .map(compileLiteral);

  if (literals.length === 0) return pathname.length;

  let cursor = 0;
  let literalIndex = 0;

  if (!startsWithWildcard) {
    const first = literals[0];
    if (!pathname.startsWith(first.value)) return -1;
    cursor = first.value.length;
    literalIndex = 1;
  }

  if (endsWithWildcard) {
    for (; literalIndex < literals.length; literalIndex += 1) {
      const literal = literals[literalIndex];
      const match = findFirstLiteral(pathname, literal, cursor);
      if (match < 0) return -1;
      cursor = match + literal.value.length;
    }
    return pathname.length;
  }

  const finalLiteral = literals[literals.length - 1];
  const finalStart = anchored ? pathname.length - finalLiteral.value.length : pathname.length;

  for (; literalIndex < literals.length - 1; literalIndex += 1) {
    const literal = literals[literalIndex];
    const match = findFirstLiteral(pathname, literal, cursor, finalStart);
    if (match < 0) return -1;
    cursor = match + literal.value.length;
  }

  if (anchored) {
    if (finalStart < cursor || !pathname.startsWith(finalLiteral.value, finalStart)) return -1;
    return pathname.length;
  }

  const match = findLastLiteral(pathname, finalLiteral, cursor);
  return match < 0 ? -1 : match + finalLiteral.value.length;
}

export function isRobotsAllowed(
  content: string,
  targetUrl: string,
  userAgent = "WebAuditPortfolioBot",
): boolean {
  const groups = parseRobotsTxt(content);
  const agent = userAgent.toLowerCase();
  const exact = groups.filter((group) =>
    group.agents.some((candidate) => candidate !== "*" && agent.includes(candidate)),
  );
  const applicable = exact.length
    ? exact
    : groups.filter((group) => group.agents.includes("*"));
  const path = `${new URL(targetUrl).pathname}${new URL(targetUrl).search}`;
  let best: { length: number; allowed: boolean } | null = null;

  for (const group of applicable) {
    for (const rule of group.rules) {
      const length = matchLength(rule.path, path);
      if (
        length >= 0 &&
        (!best || length > best.length || (length === best.length && rule.type === "allow"))
      ) {
        best = { length, allowed: rule.type === "allow" };
      }
    }
  }
  return best?.allowed ?? true;
}
