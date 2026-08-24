import "server-only";

import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";

import { extractPageData } from "@/lib/metadata";
import { isRobotsAllowed } from "@/lib/server/robots";
import {
  AuditDeadlineError,
  parseTargetUrl,
  resolvePublicTarget,
  TargetPolicyError,
  UrlFormatError,
} from "@/lib/server/ssrf-policy";
import type {
  AuditIssue,
  AuditIssueCode,
  AuditResult,
  CheckRequestBody,
  PageMetadata,
  RedirectStep,
  StatusKind,
} from "@/lib/types";

const USER_AGENT = "WebAuditPortfolioBot/1.0 (+https://web-url-audit-tool.vercel.app)";
const REQUEST_TIMEOUT_MS = 10_000;
const AUDIT_DEADLINE_MS = 24_000;
const MAX_BODY_BYTES = 1_500_000;
export const MAX_ROBOTS_BODY_BYTES = 128 * 1024;
const MAX_ROBOTS_CACHE_ENTRIES = 128;
const MAX_REDIRECTS = 8;
const EMPTY_METADATA: PageMetadata = {
  title: "",
  description: "",
  canonical: "",
  h1: "",
  h1Count: 0,
};

export interface OneHopResponse {
  url: string;
  status: number;
  location?: string;
  responseTimeMs: number;
  contentType: string;
  body: string;
  bodyReadable: boolean;
}

export interface FollowResponse {
  status: number;
  finalUrl: string;
  chain: RedirectStep[];
  redirectLoop: boolean;
  redirectLimit: boolean;
  responseTimeMs: number;
  contentType: string;
  body: string;
  bodyReadable: boolean;
}

export interface RobotsCacheEntry {
  expiresAt: number;
  status: "allow" | "deny" | "rules";
  content: string;
}

export type RequestFactory = (
  options: http.RequestOptions & https.RequestOptions,
  callback: (response: http.IncomingMessage) => void,
) => http.ClientRequest;

export interface OneHopOptions {
  deadlineAt: number;
  signal: AbortSignal;
  maxBodyBytes?: number;
  requestFactory?: RequestFactory;
}

interface FollowOptions extends OneHopOptions {
  maxRedirects?: number;
  beforeRequest?: (url: string) => Promise<void>;
  requestHop?: (url: string, options: OneHopOptions) => Promise<OneHopResponse>;
}

export class RobotsPolicyCache {
  private readonly entries = new Map<string, RobotsCacheEntry>();

  constructor(private readonly maxEntries = MAX_ROBOTS_CACHE_ENTRIES) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string, now = Date.now()): RobotsCacheEntry | undefined {
    this.prune(now);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, entry: RobotsCacheEntry, now = Date.now()): void {
    this.prune(now);
    this.entries.delete(key);
    while (this.entries.size >= Math.max(1, this.maxEntries)) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, entry);
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

class RobotsPolicyError extends Error {
  constructor() {
    super("robots.txt の方針によりCrawl対象から除外しました。");
    this.name = "RobotsPolicyError";
  }
}

const robotsCache = new RobotsPolicyCache();

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function requestOneHop(
  rawUrl: string,
  options: OneHopOptions,
): Promise<OneHopResponse> {
  const target = await resolvePublicTarget(rawUrl, {
    deadlineAt: options.deadlineAt,
    signal: options.signal,
  });
  const remainingMs = options.deadlineAt - Date.now();
  if (remainingMs <= 0 || options.signal.aborted) throw new AuditDeadlineError();
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, remainingMs);
  const maxBodyBytes = Math.max(1, options.maxBodyBytes ?? MAX_BODY_BYTES);

  return new Promise<OneHopResponse>((resolve, reject) => {
    const startedAt = performance.now();
    const originalHostname = target.url.hostname.replace(/^\[|\]$/g, "");
    const transport = target.url.protocol === "https:" ? https : http;
    let settled = false;
    let activeResponse: http.IncomingMessage | undefined;
    const timers: { hard?: ReturnType<typeof setTimeout> } = {};
    const onAbort = () => abortRequest();

    const cleanup = () => {
      if (timers.hard) clearTimeout(timers.hard);
      options.signal.removeEventListener("abort", onAbort);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const succeed = (result: OneHopResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const requestFactory = options.requestFactory ?? (transport.request as RequestFactory);
    const request = requestFactory(
      {
        protocol: target.url.protocol,
        hostname: target.address,
        family: target.family,
        port: target.url.port || (target.url.protocol === "https:" ? 443 : 80),
        path: `${target.url.pathname}${target.url.search}`,
        method: "GET",
        agent: false,
        maxHeaderSize: 32 * 1024,
        headers: {
          Host: target.url.host,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Encoding": "identity",
          "User-Agent": USER_AGENT,
          "Cache-Control": "no-cache",
        },
        ...(target.url.protocol === "https:"
          ? {
              servername: originalHostname,
              rejectUnauthorized: true,
            }
          : {}),
      },
      (response) => {
        activeResponse = response;
        if (settled) {
          response.destroy();
          return;
        }
        const responseTimeMs = Math.max(1, Math.round(performance.now() - startedAt));
        const status = response.statusCode ?? 0;
        const locationHeader = response.headers.location;
        const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
        const contentTypeHeader = response.headers["content-type"];
        const contentType = Array.isArray(contentTypeHeader)
          ? (contentTypeHeader[0] ?? "")
          : (contentTypeHeader ?? "");

            if (isRedirectStatus(status)) {
              succeed({
                url: target.url.toString(),
                status,
                location,
                responseTimeMs,
                contentType,
                body: "",
                bodyReadable: false,
              });
              response.destroy();
              return;
            }

            const contentEncoding = response.headers["content-encoding"];
            const canReadBody = !contentEncoding || contentEncoding === "identity";
            if (!canReadBody) {
              succeed({
                url: target.url.toString(),
                status,
                location,
                responseTimeMs,
                contentType,
                body: "",
                bodyReadable: false,
              });
              response.destroy();
              return;
            }

            const chunks: Buffer[] = [];
            let size = 0;
            response.on("data", (chunk: Buffer | string) => {
              if (settled) return;
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              const remaining = maxBodyBytes - size;
              if (remaining > 0) {
                chunks.push(buffer.subarray(0, remaining));
                size += Math.min(buffer.length, remaining);
              }
              if (size >= maxBodyBytes) {
                succeed({
                  url: target.url.toString(),
                  status,
                  location,
                  responseTimeMs,
                  contentType,
                  body: Buffer.concat(chunks).toString("utf8"),
                  bodyReadable: true,
                });
                response.destroy();
              }
            });
            response.on("end", () => {
              if (settled) return;
              succeed({
                url: target.url.toString(),
                status,
                location,
                responseTimeMs,
                contentType,
                body: Buffer.concat(chunks).toString("utf8"),
                bodyReadable: true,
              });
            });
            response.on("error", (error) => {
              fail(error);
            });
            response.on("aborted", () => fail(new Error("Response aborted")));
      },
    );

    request.setTimeout(timeoutMs, () => {
      abortRequest(new Error("Request timeout"));
    });
    request.on("error", (error) => {
      fail(error);
    });

    function abortRequest(error = new AuditDeadlineError()): void {
      if (settled) return;
      settled = true;
      cleanup();
      activeResponse?.destroy(error);
      request.destroy(error);
      reject(error);
    }

    timers.hard = setTimeout(() => abortRequest(), timeoutMs);
    options.signal.addEventListener("abort", onAbort, { once: true });
    if (options.signal.aborted) {
      abortRequest();
      return;
    }
    request.end();
  });
}

export async function followUrl(
  rawUrl: string,
  options: FollowOptions,
): Promise<FollowResponse> {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const requestHop = options.requestHop ?? requestOneHop;
  let currentUrl = rawUrl;
  let finalResponse: OneHopResponse | null = null;
  let redirectLoop = false;
  let redirectLimit = false;
  const chain: RedirectStep[] = [];
  const seen = new Set<string>();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remainingMs = options.deadlineAt - Date.now();
    if (remainingMs <= 0 || options.signal.aborted) throw new AuditDeadlineError();
    const normalizedUrl = new URL(currentUrl);
    normalizedUrl.hash = "";
    const normalized = normalizedUrl.toString();
    if (seen.has(normalized)) {
      redirectLoop = true;
      break;
    }
    seen.add(normalized);

    await options.beforeRequest?.(normalized);
    if (options.signal.aborted) throw new AuditDeadlineError();
    const response = await requestHop(normalized, options);
    finalResponse = response;
    chain.push({
      url: response.url,
      status: response.status,
      location: response.location,
      responseTimeMs: response.responseTimeMs,
    });

    if (!isRedirectStatus(response.status) || !response.location) break;

    const nextUrl = new URL(response.location, response.url).toString();
    if (seen.has(nextUrl)) {
      redirectLoop = true;
      currentUrl = nextUrl;
      break;
    }
    if (hop === maxRedirects) {
      redirectLimit = true;
      break;
    }
    currentUrl = nextUrl;
  }

  if (!finalResponse) throw new Error("No response received");
  return {
    status: finalResponse.status,
    finalUrl: redirectLoop ? currentUrl : finalResponse.url,
    chain,
    redirectLoop,
    redirectLimit,
    responseTimeMs: chain.reduce((sum, step) => sum + step.responseTimeMs, 0),
    contentType: finalResponse.contentType,
    body: finalResponse.body,
    bodyReadable: finalResponse.bodyReadable,
  };
}

function robotsCacheKey(url: URL): string {
  return url.origin;
}

async function robotsPermission(
  targetUrl: string,
  deadlineAt: number,
  signal: AbortSignal,
): Promise<boolean> {
  const url = new URL(targetUrl);
  const key = robotsCacheKey(url);
  const cached = robotsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.status === "allow") return true;
    if (cached.status === "deny") return false;
    return isRobotsAllowed(cached.content, targetUrl);
  }

  const robotsUrl = new URL("/robots.txt", url.origin).toString();
  try {
    // robots.txt itself is fetched without a beforeRequest hook, preventing
    // recursive robots checks while still applying SSRF and redirect guards.
    const response = await followUrl(robotsUrl, {
      deadlineAt,
      signal,
      maxRedirects: 3,
      maxBodyBytes: MAX_ROBOTS_BODY_BYTES,
    });
    const expiresAt = Date.now() + 10 * 60 * 1000;
    if (response.status === 401 || response.status === 403 || response.status >= 500) {
      robotsCache.set(key, { expiresAt, status: "deny", content: "" });
      return false;
    }
    if (response.status === 404) {
      robotsCache.set(key, { expiresAt, status: "allow", content: "" });
      return true;
    }
    if (response.status >= 200 && response.status < 300) {
      if (!response.bodyReadable) {
        robotsCache.set(key, { expiresAt, status: "deny", content: "" });
        return false;
      }
      robotsCache.set(key, { expiresAt, status: "rules", content: response.body });
      return isRobotsAllowed(response.body, targetUrl);
    }
    robotsCache.set(key, { expiresAt, status: "deny", content: "" });
    return false;
  } catch (error) {
    if (error instanceof AuditDeadlineError) throw error;
    return false;
  }
}

function issue(code: AuditIssueCode, label: string, severity: AuditIssue["severity"]): AuditIssue {
  return { code, label, severity };
}

function statusDetails(status: number, redirected: boolean): { kind: StatusKind; label: string } {
  if (redirected || (status >= 300 && status < 400)) {
    return { kind: "redirect", label: "Redirect" };
  }
  if (status >= 200 && status < 300) return { kind: "ok", label: "正常" };
  if (status >= 400 && status < 500) return { kind: "client-error", label: "Client Error" };
  if (status >= 500) return { kind: "server-error", label: "Server Error" };
  return { kind: "failed", label: "確認失敗" };
}

function scopeFor(url: string, baseOrigin: string | undefined): "internal" | "external" {
  if (!baseOrigin) return "internal";
  try {
    return new URL(url).origin === new URL(baseOrigin).origin ? "internal" : "external";
  } catch {
    return "external";
  }
}

function errorResult(
  body: CheckRequestBody,
  code: AuditIssueCode,
  message: string,
  blocked: boolean,
): AuditResult {
  return {
    id: randomUUID(),
    inputUrl: body.url,
    source: body.source ?? "direct",
    depth: body.depth ?? 0,
    scope: scopeFor(body.url, body.baseOrigin),
    status: null,
    statusKind: blocked ? "blocked" : "failed",
    statusLabel: blocked ? "安全上ブロック" : "確認失敗",
    finalUrl: body.url,
    redirectCount: 0,
    redirectChain: [],
    redirectLoop: false,
    responseTimeMs: null,
    contentType: "",
    metadata: EMPTY_METADATA,
    internalLinks: [],
    externalLinks: [],
    issues: [issue(code, message, "error")],
    broken: false,
    slow: false,
    robotsAllowed: body.respectRobots ? false : null,
    checkedAt: new Date().toISOString(),
    errorCode: code,
    errorMessage: message,
  };
}

export async function auditUrl(body: CheckRequestBody): Promise<AuditResult> {
  const slowThresholdMs = Math.min(30_000, Math.max(100, body.slowThresholdMs ?? 2_000));
  const deadlineAt = Date.now() + AUDIT_DEADLINE_MS;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(), AUDIT_DEADLINE_MS);
  try {
    const parsed = parseTargetUrl(body.url.trim());
    const normalizedUrl = parsed.toString();
    const beforeRequest = body.respectRobots
      ? async (targetUrl: string) => {
          if (!(await robotsPermission(targetUrl, deadlineAt, deadlineController.signal))) {
            throw new RobotsPolicyError();
          }
        }
      : undefined;

    const response = await followUrl(normalizedUrl, {
      deadlineAt,
      signal: deadlineController.signal,
      maxRedirects: MAX_REDIRECTS,
      beforeRequest,
    });
    const redirected = response.chain.some((step) => isRedirectStatus(step.status));
    const { kind, label } = statusDetails(response.status, redirected);
    const html =
      response.bodyReadable &&
      /(?:text\/html|application\/xhtml\+xml)/i.test(response.contentType);
    const pageData = html
      ? extractPageData(response.body, response.finalUrl)
      : { metadata: EMPTY_METADATA, links: [] };
    const internalLinks = pageData.links.filter((link) => link.scope === "internal");
    const externalLinks = pageData.links.filter((link) => link.scope === "external");
    const issues: AuditIssue[] = [];
    const broken = response.status === 404 || response.status === 410;
    const slow = response.responseTimeMs >= slowThresholdMs;

    if (response.status === 404) issues.push(issue("BROKEN_404", "404 リンク切れ", "error"));
    if (response.status === 410) issues.push(issue("GONE_410", "410 Gone", "error"));
    if (response.status >= 400 && response.status < 500 && !broken) {
      issues.push(issue("CLIENT_ERROR", `${response.status} Client Error`, "error"));
    }
    if (response.status >= 500) {
      issues.push(issue("SERVER_ERROR", `${response.status} Server Error`, "error"));
    }
    if (response.redirectLoop) {
      issues.push(issue("REDIRECT_LOOP", "Redirect Loop", "error"));
    }
    if (response.redirectLimit) {
      issues.push(issue("REDIRECT_LIMIT", "Redirect上限超過", "error"));
    }
    if (slow) issues.push(issue("SLOW_RESPONSE", "応答が閾値を超過", "warning"));
    if (html && response.status >= 200 && response.status < 400) {
      if (!pageData.metadata.title) issues.push(issue("MISSING_TITLE", "Titleなし", "warning"));
      if (!pageData.metadata.description) {
        issues.push(issue("MISSING_DESCRIPTION", "Descriptionなし", "warning"));
      }
      if (!pageData.metadata.canonical) {
        issues.push(issue("MISSING_CANONICAL", "Canonicalなし", "warning"));
      }
      if (!pageData.metadata.h1) issues.push(issue("MISSING_H1", "H1なし", "warning"));
    }

    return {
      id: randomUUID(),
      inputUrl: normalizedUrl,
      source: body.source ?? "direct",
      depth: Math.min(3, Math.max(0, body.depth ?? 0)),
      scope: scopeFor(normalizedUrl, body.baseOrigin),
      status: response.status,
      statusKind: response.redirectLoop || response.redirectLimit ? "failed" : kind,
      statusLabel: response.redirectLoop
        ? "Redirect Loop"
        : response.redirectLimit
          ? "Redirect上限超過"
          : label,
      finalUrl: response.finalUrl,
      redirectCount: response.chain.filter(
        (step) => isRedirectStatus(step.status) && Boolean(step.location),
      ).length,
      redirectChain: response.chain,
      redirectLoop: response.redirectLoop,
      responseTimeMs: response.responseTimeMs,
      contentType: response.contentType,
      metadata: pageData.metadata,
      internalLinks,
      externalLinks,
      issues,
      broken,
      slow,
      robotsAllowed: body.respectRobots ? true : null,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof RobotsPolicyError) {
      return errorResult(body, "ROBOTS_BLOCKED", error.message, true);
    }
    if (error instanceof UrlFormatError) {
      return errorResult(body, "INVALID_URL", error.message, false);
    }
    if (error instanceof TargetPolicyError) {
      return errorResult(body, "BLOCKED_TARGET", error.message, true);
    }
    if (error instanceof TypeError) {
      return errorResult(body, "INVALID_URL", "有効なURLを入力してください。", false);
    }
    if (error instanceof AuditDeadlineError) {
      return errorResult(
        body,
        "REQUEST_FAILED",
        "監査が24秒の安全な処理上限を超えたため停止しました。",
        false,
      );
    }
    console.error("[audit] outbound request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown failure",
      code:
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : undefined,
    });
    return errorResult(
      body,
      "REQUEST_FAILED",
      "接続・TLS・Timeout等によりURLを確認できませんでした。",
      false,
    );
  } finally {
    clearTimeout(deadlineTimer);
  }
}
