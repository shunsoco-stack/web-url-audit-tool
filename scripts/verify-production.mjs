#!/usr/bin/env node

const REQUEST_TIMEOUT_MS = 35_000;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function formatValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function assertEqual(actual, expected, label) {
  assert(
    Object.is(actual, expected),
    `${label}: expected ${formatValue(expected)}, received ${formatValue(actual)}`,
  );
}

function assertStatusChain(result, expected) {
  assert(Array.isArray(result.redirectChain), "redirectChain must be an array");
  const actual = result.redirectChain.map((step) => step?.status);
  assertEqual(
    actual.join(" → "),
    expected.join(" → "),
    "redirect status chain",
  );
}

function assertIssue(result, code) {
  assert(
    Array.isArray(result.issues) && result.issues.some((issue) => issue?.code === code),
    `expected issue ${code}, received ${formatValue(result.issues)}`,
  );
}

function normalizeBaseUrl(rawValue) {
  if (!rawValue) {
    fail(
      "Base URL is required. Pass it as the first argument or set AUDIT_BASE_URL.\n" +
        "Example: npm run verify:production -- https://your-app.vercel.app",
    );
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    fail("Base URL must be an absolute HTTP or HTTPS URL.");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    fail("Base URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    fail("Base URL must not contain credentials.");
  }
  return new URL("/", parsed);
}

const baseUrl = normalizeBaseUrl(process.argv[2] ?? process.env.AUDIT_BASE_URL);
const checkUrl = new URL("/api/check", baseUrl);

function demoUrl(pathname) {
  return new URL(pathname, baseUrl).toString();
}

async function check(targetUrl) {
  const response = await fetch(checkUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "web-url-audit-production-verifier/1.0",
    },
    body: JSON.stringify({
      url: targetUrl,
      baseOrigin: baseUrl.origin,
      slowThresholdMs: 30_000,
      source: "demo",
      depth: 0,
      respectRobots: false,
    }),
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail(
      `POST /api/check returned non-JSON HTTP ${response.status}: ${text.slice(0, 240)}`,
    );
  }

  assert(
    response.ok,
    `POST /api/check returned HTTP ${response.status}: ${formatValue(payload)}`,
  );
  assert(
    payload && typeof payload === "object" && payload.result && typeof payload.result === "object",
    `POST /api/check response is missing result: ${formatValue(payload)}`,
  );
  return payload.result;
}

const cases = [
  {
    name: "200 response and metadata",
    target: demoUrl("/api/demo/site/home"),
    verify(result) {
      assertEqual(result.status, 200, "HTTP status");
      assertEqual(result.statusKind, "ok", "status kind");
      assertEqual(result.broken, false, "broken flag");
      assertEqual(result.finalUrl, this.target, "final URL");
      assertEqual(result.metadata?.title, "株式会社ミナト｜コーポレートサイト", "title");
      assertEqual(result.metadata?.h1, "株式会社ミナト", "H1");
      assertEqual(result.metadata?.canonical, this.target, "canonical URL");
      assert(
        typeof result.metadata?.description === "string" &&
          result.metadata.description.length > 0,
        "meta description must be present",
      );
      assert(
        typeof result.responseTimeMs === "number" && result.responseTimeMs > 0,
        "response time must be a positive number",
      );
    },
  },
  {
    name: "301 to 302 redirect chain",
    target: demoUrl("/api/demo/redirect/start"),
    verify(result) {
      assertEqual(result.status, 200, "final HTTP status");
      assertEqual(result.statusKind, "redirect", "status kind");
      assertEqual(result.redirectCount, 2, "redirect count");
      assertEqual(result.redirectLoop, false, "redirect loop flag");
      assertEqual(result.finalUrl, demoUrl("/api/demo/site/about"), "final URL");
      assertStatusChain(result, [301, 302, 200]);
      assertEqual(
        result.redirectChain[0]?.location,
        demoUrl("/api/demo/redirect/middle"),
        "first redirect location",
      );
      assertEqual(
        result.redirectChain[1]?.location,
        demoUrl("/api/demo/site/about"),
        "second redirect location",
      );
    },
  },
  {
    name: "404 broken link",
    target: demoUrl("/api/demo/status/404"),
    verify(result) {
      assertEqual(result.status, 404, "HTTP status");
      assertEqual(result.statusKind, "client-error", "status kind");
      assertEqual(result.broken, true, "broken flag");
      assertIssue(result, "BROKEN_404");
    },
  },
  {
    name: "410 gone link",
    target: demoUrl("/api/demo/status/410"),
    verify(result) {
      assertEqual(result.status, 410, "HTTP status");
      assertEqual(result.statusKind, "client-error", "status kind");
      assertEqual(result.broken, true, "broken flag");
      assertIssue(result, "GONE_410");
    },
  },
  {
    name: "500 server error",
    target: demoUrl("/api/demo/status/500"),
    verify(result) {
      assertEqual(result.status, 500, "HTTP status");
      assertEqual(result.statusKind, "server-error", "status kind");
      assertEqual(result.broken, false, "broken flag");
      assertIssue(result, "SERVER_ERROR");
    },
  },
  {
    name: "redirect loop detection",
    target: demoUrl("/api/demo/redirect/loop-a"),
    verify(result) {
      assertEqual(result.statusKind, "failed", "status kind");
      assertEqual(result.redirectLoop, true, "redirect loop flag");
      assertEqual(result.redirectCount, 2, "redirect count");
      assertStatusChain(result, [302, 302]);
      assertIssue(result, "REDIRECT_LOOP");
    },
  },
  {
    name: "invalid URL rejection",
    target: "not a valid URL",
    verify(result) {
      assertEqual(result.status, null, "HTTP status");
      assertEqual(result.statusKind, "failed", "status kind");
      assertEqual(result.errorCode, "INVALID_URL", "error code");
      assertIssue(result, "INVALID_URL");
    },
  },
  {
    name: "private IP SSRF block",
    target: "http://127.0.0.1/",
    verify(result) {
      assertEqual(result.status, null, "HTTP status");
      assertEqual(result.statusKind, "blocked", "status kind");
      assertEqual(result.errorCode, "BLOCKED_TARGET", "error code");
      assertIssue(result, "BLOCKED_TARGET");
    },
  },
];

const startedAt = Date.now();
const outcomes = [];

console.log(`Production API verification: ${baseUrl.origin}`);

for (const testCase of cases) {
  const caseStartedAt = Date.now();
  try {
    const result = await check(testCase.target);
    testCase.verify(result);
    const durationMs = Date.now() - caseStartedAt;
    outcomes.push({ name: testCase.name, passed: true, durationMs });
    console.log(`PASS  ${testCase.name} (${durationMs} ms)`);
  } catch (error) {
    const durationMs = Date.now() - caseStartedAt;
    const message = error instanceof Error ? error.message : String(error);
    outcomes.push({ name: testCase.name, passed: false, durationMs, message });
    console.error(`FAIL  ${testCase.name} (${durationMs} ms): ${message}`);
  }
}

const passed = outcomes.filter((outcome) => outcome.passed).length;
const failed = outcomes.length - passed;
const elapsedMs = Date.now() - startedAt;

console.log(`Summary: ${passed}/${outcomes.length} passed, ${failed} failed (${elapsedMs} ms)`);

if (failed > 0) {
  process.exitCode = 1;
}
