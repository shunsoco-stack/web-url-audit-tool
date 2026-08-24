import { auditUrl } from "@/lib/server/http-auditor";
import { parseTargetUrl } from "@/lib/server/ssrf-policy";
import type { CheckRequestBody } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MAX_CONTENT_LENGTH = 16 * 1024;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const MAX_ACTIVE_CHECKS = 6;
const MAX_ACTIVE_PER_ORIGIN = 3;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const activeByOrigin = new Map<string, number>();
let activeChecks = 0;

function clientKey(request: Request): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anonymous"
  );
}

function allowRequest(request: Request): { allowed: boolean; remaining: number } {
  const now = Date.now();
  if (rateBuckets.size > 1_000) {
    for (const [bucketKey, value] of rateBuckets) {
      if (value.resetAt <= now) rateBuckets.delete(bucketKey);
    }
  }
  const key = clientKey(request);
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1 };
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= MAX_REQUESTS_PER_WINDOW,
    remaining: Math.max(0, MAX_REQUESTS_PER_WINDOW - bucket.count),
  };
}

function json(
  data: unknown,
  status = 200,
  remaining?: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(remaining === undefined ? {} : { "X-RateLimit-Remaining": String(remaining) }),
      ...extraHeaders,
    },
  });
}

function targetOriginKey(rawUrl: string): string {
  try {
    const target = parseTargetUrl(rawUrl);
    target.hostname = target.hostname.replace(/\.$/, "");
    return target.origin;
  } catch {
    return "invalid-or-blocked-target";
  }
}

function acquireCheckSlot(origin: string):
  | { acquired: true; release: () => void }
  | { acquired: false; reason: "global" | "origin" } {
  if (activeChecks >= MAX_ACTIVE_CHECKS) return { acquired: false, reason: "global" };
  const originActive = activeByOrigin.get(origin) ?? 0;
  if (originActive >= MAX_ACTIVE_PER_ORIGIN) {
    return { acquired: false, reason: "origin" };
  }

  activeChecks += 1;
  activeByOrigin.set(origin, originActive + 1);
  let released = false;
  return {
    acquired: true,
    release: () => {
      if (released) return;
      released = true;
      activeChecks = Math.max(0, activeChecks - 1);
      const remainingForOrigin = (activeByOrigin.get(origin) ?? 1) - 1;
      if (remainingForOrigin <= 0) activeByOrigin.delete(origin);
      else activeByOrigin.set(origin, remainingForOrigin);
    },
  };
}

function isBody(value: unknown): value is CheckRequestBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.url === "string" &&
    body.url.length <= 2048 &&
    (body.baseOrigin === undefined || typeof body.baseOrigin === "string") &&
    (body.slowThresholdMs === undefined || typeof body.slowThresholdMs === "number") &&
    (body.depth === undefined || typeof body.depth === "number") &&
    (body.respectRobots === undefined || typeof body.respectRobots === "boolean")
  );
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ error: "Content-Type must be application/json" }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_CONTENT_LENGTH) {
    return json({ error: "Request body is too large" }, 413);
  }

  const rate = allowRequest(request);
  if (!rate.allowed) {
    return json({ error: "Too many checks. Please wait and retry." }, 429, rate.remaining);
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_CONTENT_LENGTH) {
      return json({ error: "Request body is too large" }, 413, rate.remaining);
    }
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Malformed JSON" }, 400, rate.remaining);
  }
  if (!isBody(body)) {
    return json({ error: "Invalid request payload" }, 400, rate.remaining);
  }

  const auditBody: CheckRequestBody = {
    url: body.url,
    baseOrigin: body.baseOrigin?.slice(0, 2048),
    slowThresholdMs: body.slowThresholdMs,
    source: ["direct", "csv", "crawl", "demo"].includes(body.source ?? "")
      ? body.source
      : "direct",
    depth: Math.min(3, Math.max(0, Math.trunc(body.depth ?? 0))),
    respectRobots: Boolean(body.respectRobots),
  };

  const slot = acquireCheckSlot(targetOriginKey(auditBody.url));
  if (!slot.acquired) {
    const sameOrigin = slot.reason === "origin";
    return json(
      {
        error: sameOrigin
          ? "This target already has three active checks. Please retry shortly."
          : "The audit service is busy. Please retry shortly.",
      },
      sameOrigin ? 429 : 503,
      rate.remaining,
      { "Retry-After": "1" },
    );
  }

  try {
    const result = await auditUrl(auditBody);
    return json({ result }, 200, rate.remaining);
  } finally {
    slot.release();
  }
}
