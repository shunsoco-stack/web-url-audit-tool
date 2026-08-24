/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

import {
  AuditDeadlineError,
  isBlockedIpv4,
  isBlockedIpv6,
  isPublicAddress,
  parseTargetUrl,
  resolvePublicTarget,
  TargetPolicyError,
  UrlFormatError,
} from "../ssrf-policy";

describe("IP address policy", () => {
  it.each([
    "0.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "168.63.129.16",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
  ])("blocks non-public IPv4 address %s", (address) => {
    expect(isBlockedIpv4(address)).toBe(true);
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34"])(
    "allows global IPv4 address %s",
    (address) => {
      expect(isBlockedIpv4(address)).toBe(false);
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
    "100::1",
    "2001::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "2001::1",
    "2001:db8::1",
    "2002::1",
    "3fff::1",
    "5f00::1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "::ffff:8.8.8.8",
  ])("blocks non-public IPv6 address %s", (address) => {
    expect(isBlockedIpv6(address)).toBe(true);
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "allows global IPv6 address %s",
    (address) => {
      expect(isBlockedIpv6(address)).toBe(false);
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it("treats malformed addresses as non-public", () => {
    expect(isBlockedIpv4("999.1.1.1")).toBe(true);
    expect(isBlockedIpv6("not-an-ip")).toBe(true);
    expect(isPublicAddress("not-an-ip")).toBe(false);
  });
});

describe("parseTargetUrl", () => {
  it("accepts a public HTTP(S) URL and removes its fragment", () => {
    const url = parseTargetUrl("  https://Example.COM/path?q=1#section  ");

    expect(url.toString()).toBe("https://example.com/path?q=1");
  });

  it("accepts public IPv4 and IPv6 literals", () => {
    expect(parseTargetUrl("https://8.8.8.8/dns").hostname).toBe("8.8.8.8");
    expect(parseTargetUrl("https://[2606:4700:4700::1111]/dns").hostname).toBe(
      "[2606:4700:4700::1111]",
    );
  });

  it.each(["ftp://example.com/file", "file:///etc/passwd"])(
    "rejects unsupported URL format %s",
    (rawUrl) => {
      expect(() => parseTargetUrl(rawUrl)).toThrow(UrlFormatError);
    },
  );

  it.each([
    "https://user:secret@example.com/",
    "https://example.com:3000/",
    "https://localhost/",
    "https://service.internal/",
    "https://printer/",
    "https://127.0.0.1/",
    "https://10.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[fc00::1]/",
  ])("rejects unsafe target %s", (rawUrl) => {
    expect(() => parseTargetUrl(rawUrl)).toThrow(TargetPolicyError);
  });

  it.each([
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://127.1/",
  ])("rejects alternate IPv4 spelling %s after URL normalization", (rawUrl) => {
    expect(() => parseTargetUrl(rawUrl)).toThrow(TargetPolicyError);
  });

  it("rejects empty, malformed, and oversized inputs", () => {
    expect(() => parseTargetUrl("")).toThrow(UrlFormatError);
    expect(() => parseTargetUrl("not a URL")).toThrow(UrlFormatError);
    expect(() => parseTargetUrl(`https://example.com/${"a".repeat(2050)}`)).toThrow(
      UrlFormatError,
    );
  });
});

describe("resolvePublicTarget", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the first address only when every DNS answer is public", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);

    await expect(resolvePublicTarget("https://example.com/page#fragment")).resolves.toEqual({
      url: new URL("https://example.com/page"),
      address: "93.184.216.34",
      family: 4,
    });
    expect(lookupMock).toHaveBeenCalledWith("example.com", { all: true, verbatim: true });
  });

  it("fails closed when DNS returns a private address among public answers", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ]);

    await expect(resolvePublicTarget("https://example.com/")).rejects.toMatchObject({
      code: "BLOCKED_TARGET",
    });
  });

  it("fails closed for empty and failed DNS resolution", async () => {
    lookupMock.mockResolvedValueOnce([]);
    await expect(resolvePublicTarget("https://example.com/")).rejects.toBeInstanceOf(
      TargetPolicyError,
    );

    lookupMock.mockRejectedValueOnce(new Error("DNS details must not leak"));
    await expect(resolvePublicTarget("https://example.net/")).rejects.toMatchObject({
      code: "BLOCKED_TARGET",
      message: "Host名を安全に解決できませんでした。",
    });
  });

  it("does not perform DNS lookup for an already validated public IP literal", async () => {
    await expect(resolvePublicTarget("https://8.8.8.8/")).resolves.toMatchObject({
      address: "8.8.8.8",
      family: 4,
    });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("enforces the DNS portion of the audit deadline without leaking late rejection", async () => {
    vi.useFakeTimers();
    let rejectLookup: ((error: Error) => void) | undefined;
    lookupMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLookup = reject;
      }),
    );

    const resolution = resolvePublicTarget("https://example.com/", {
      deadlineAt: Date.now() + 100,
    });
    const rejected = expect(resolution).rejects.toBeInstanceOf(AuditDeadlineError);
    await vi.advanceTimersByTimeAsync(101);
    await rejected;

    rejectLookup?.(new Error("late DNS failure"));
    await Promise.resolve();
  });
});
