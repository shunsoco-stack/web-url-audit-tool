/** @vitest-environment node */

import { EventEmitter } from "node:events";
import type http from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  followUrl,
  MAX_ROBOTS_BODY_BYTES,
  requestOneHop,
  RobotsPolicyCache,
  type OneHopResponse,
  type RequestFactory,
} from "../http-auditor";
import { AuditDeadlineError } from "../ssrf-policy";

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = { "content-type": "text/plain" };
  destroyed = false;
  onDestroy?: () => void;

  destroy(): this {
    this.destroyed = true;
    this.onDestroy?.();
    return this;
  }
}

class FakeRequest extends EventEmitter {
  destroyed = false;

  constructor(private readonly onEnd: () => void) {
    super();
  }

  setTimeout(): this {
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }

  end(): this {
    queueMicrotask(this.onEnd);
    return this;
  }
}

function fakeFactory(
  response: FakeResponse,
  startBody: (response: FakeResponse) => void,
): { factory: RequestFactory; request: FakeRequest } {
  let responseCallback: ((response: http.IncomingMessage) => void) | undefined;
  const request = new FakeRequest(() => {
    responseCallback?.(response as unknown as http.IncomingMessage);
    startBody(response);
  });
  const factory: RequestFactory = (_options, callback) => {
    responseCallback = callback;
    return request as unknown as http.ClientRequest;
  };
  return { factory, request };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("requestOneHop safety limits", () => {
  it("destroys a response that keeps trickling bytes past the hard wall-clock limit", async () => {
    vi.useFakeTimers();
    const response = new FakeResponse();
    let interval: ReturnType<typeof setInterval> | undefined;
    const { factory, request } = fakeFactory(response, (stream) => {
      interval = setInterval(() => stream.emit("data", Buffer.from("x")), 20);
      stream.onDestroy = () => {
        if (interval) clearInterval(interval);
      };
    });

    const pending = requestOneHop("http://8.8.8.8/", {
      deadlineAt: Date.now() + 100,
      signal: new AbortController().signal,
      requestFactory: factory,
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(AuditDeadlineError);

    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(request.destroyed).toBe(true);
    expect(response.destroyed).toBe(true);
  });

  it("caps a robots response at 128 KiB before caching or parsing", async () => {
    const response = new FakeResponse();
    const { factory } = fakeFactory(response, (stream) => {
      stream.emit("data", Buffer.alloc(MAX_ROBOTS_BODY_BYTES + 4096, 97));
      stream.emit("end");
    });

    const result = await requestOneHop("http://8.8.8.8/robots.txt", {
      deadlineAt: Date.now() + 1_000,
      signal: new AbortController().signal,
      maxBodyBytes: MAX_ROBOTS_BODY_BYTES,
      requestFactory: factory,
    });

    expect(Buffer.byteLength(result.body)).toBe(MAX_ROBOTS_BODY_BYTES);
    expect(result.bodyReadable).toBe(true);
    expect(response.destroyed).toBe(true);
  });

  it("marks an unexpectedly compressed response body as unreadable", async () => {
    const response = new FakeResponse();
    response.headers = {
      "content-type": "text/html",
      "content-encoding": "gzip",
    };
    const { factory } = fakeFactory(response, () => undefined);

    const result = await requestOneHop("http://8.8.8.8/", {
      deadlineAt: Date.now() + 1_000,
      signal: new AbortController().signal,
      requestFactory: factory,
    });

    expect(result.body).toBe("");
    expect(result.bodyReadable).toBe(false);
    expect(response.destroyed).toBe(true);
  });
});

describe("redirect policy hook", () => {
  it("checks a redirect destination before issuing its request", async () => {
    const requested: string[] = [];
    const checked: string[] = [];
    const requestHop = vi.fn(async (url: string): Promise<OneHopResponse> => {
      requested.push(url);
      return {
        url,
        status: 302,
        location: "/private",
        responseTimeMs: 1,
        contentType: "text/html",
        body: "",
        bodyReadable: false,
      };
    });

    await expect(
      followUrl("https://example.com/start", {
        deadlineAt: Date.now() + 1_000,
        signal: new AbortController().signal,
        requestHop,
        beforeRequest: async (url) => {
          checked.push(url);
          if (url.endsWith("/private")) throw new Error("robots denied");
        },
      }),
    ).rejects.toThrow("robots denied");

    expect(checked).toEqual([
      "https://example.com/start",
      "https://example.com/private",
    ]);
    expect(requested).toEqual(["https://example.com/start"]);
  });
});

describe("RobotsPolicyCache", () => {
  it("evicts expired entries and least-recently-used entries", () => {
    const cache = new RobotsPolicyCache(2);
    cache.set("a", { expiresAt: 100, status: "rules", content: "a" }, 0);
    cache.set("b", { expiresAt: 100, status: "rules", content: "b" }, 0);
    expect(cache.get("a", 1)?.content).toBe("a");

    cache.set("c", { expiresAt: 100, status: "rules", content: "c" }, 1);
    expect(cache.get("b", 1)).toBeUndefined();
    expect(cache.get("a", 1)?.content).toBe("a");
    expect(cache.get("c", 1)?.content).toBe("c");

    expect(cache.get("a", 101)).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
