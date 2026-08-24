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

function matchLength(rulePath: string, pathname: string): number {
  if (!rulePath) return 0;
  const anchored = rulePath.endsWith("$");
  const escaped = rulePath
    .replace(/[$]$/, "")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}${anchored ? "$" : ""}`);
  const match = pathname.match(regex);
  return match?.[0]?.length ?? -1;
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
