export type AuditSource = "direct" | "csv" | "crawl" | "demo";
export type LinkScope = "internal" | "external";

export type StatusKind =
  | "ok"
  | "redirect"
  | "client-error"
  | "server-error"
  | "blocked"
  | "failed";

export type AuditIssueCode =
  | "INVALID_URL"
  | "BLOCKED_TARGET"
  | "REQUEST_FAILED"
  | "ROBOTS_BLOCKED"
  | "BROKEN_404"
  | "GONE_410"
  | "CLIENT_ERROR"
  | "SERVER_ERROR"
  | "REDIRECT_LOOP"
  | "REDIRECT_LIMIT"
  | "SLOW_RESPONSE"
  | "MISSING_TITLE"
  | "MISSING_DESCRIPTION"
  | "MISSING_CANONICAL"
  | "MISSING_H1";

export interface AuditIssue {
  code: AuditIssueCode;
  label: string;
  severity: "info" | "warning" | "error";
}

export interface RedirectStep {
  url: string;
  status: number;
  location?: string;
  responseTimeMs: number;
}

export interface PageMetadata {
  title: string;
  description: string;
  canonical: string;
  h1: string;
  h1Count: number;
}

export interface DiscoveredLink {
  url: string;
  scope: LinkScope;
  text: string;
}

export interface AuditResult {
  id: string;
  inputUrl: string;
  source: AuditSource;
  depth: number;
  scope: LinkScope;
  status: number | null;
  statusKind: StatusKind;
  statusLabel: string;
  finalUrl: string;
  redirectCount: number;
  redirectChain: RedirectStep[];
  redirectLoop: boolean;
  responseTimeMs: number | null;
  contentType: string;
  metadata: PageMetadata;
  internalLinks: DiscoveredLink[];
  externalLinks: DiscoveredLink[];
  issues: AuditIssue[];
  broken: boolean;
  slow: boolean;
  robotsAllowed: boolean | null;
  checkedAt: string;
  errorCode?: AuditIssueCode;
  errorMessage?: string;
}

export interface CheckRequestBody {
  url: string;
  baseOrigin?: string;
  slowThresholdMs?: number;
  source?: AuditSource;
  depth?: number;
  respectRobots?: boolean;
}

export interface AuditRunSnapshot {
  id: string;
  name: string;
  createdAt: string;
  results: AuditResult[];
}

export interface RunComparison {
  newBroken: AuditResult[];
  fixed: AuditResult[];
  newRedirects: AuditResult[];
}
