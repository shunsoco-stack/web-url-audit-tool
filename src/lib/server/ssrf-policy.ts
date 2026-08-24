import "server-only";

import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

export class TargetPolicyError extends Error {
  readonly code = "BLOCKED_TARGET" as const;

  constructor(message: string) {
    super(message);
    this.name = "TargetPolicyError";
  }
}

export class UrlFormatError extends Error {
  readonly code = "INVALID_URL" as const;

  constructor(message: string) {
    super(message);
    this.name = "UrlFormatError";
  }
}

export class AuditDeadlineError extends Error {
  constructor(message = "Audit deadline exceeded") {
    super(message);
    this.name = "AuditDeadlineError";
  }
}

export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

interface ResolveTargetOptions {
  deadlineAt?: number;
  signal?: AbortSignal;
}

const DNS_LOOKUP_TIMEOUT_MS = 5_000;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.aws.internal",
]);

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".lan",
  ".corp",
  ".test",
  ".invalid",
];

function ipv4Number(address: string): number | null {
  if (!isIPv4(address)) return null;
  return address
    .split(".")
    .map(Number)
    .reduce((value, octet) => value * 256 + octet, 0) >>> 0;
}

function inIpv4Range(address: number, base: string, prefix: number): boolean {
  const baseNumber = ipv4Number(base);
  if (baseNumber === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (baseNumber & mask);
}

export function isBlockedIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return true;
  const ranges: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["168.63.129.16", 32],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  return ranges.some(([base, prefix]) => inIpv4Range(value, base, prefix));
}

function ipv6Number(address: string): bigint | null {
  if (!isIPv6(address) || address.includes("%")) return null;
  let input = address.toLowerCase();
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    const embedded = input.slice(lastColon + 1);
    const ipv4 = ipv4Number(embedded);
    if (ipv4 === null) return null;
    input = `${input.slice(0, lastColon)}:${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/.test(group))) {
    return null;
  }
  return groups.reduce((value, group) => (value << 16n) + BigInt(`0x${group}`), 0n);
}

function ipv6Prefix(value: bigint, base: string, prefix: number): boolean {
  const baseValue = ipv6Number(base);
  if (baseValue === null) return false;
  const shift = BigInt(128 - prefix);
  return value >> shift === baseValue >> shift;
}

export function isBlockedIpv6(address: string): boolean {
  const value = ipv6Number(address);
  if (value === null) return true;

  if (ipv6Prefix(value, "::ffff:0:0", 96)) {
    // IPv4-mapped IPv6 literals are unnecessary here because native IPv4 is
    // supported. Rejecting the ambiguous representation keeps the policy
    // fail-closed across operating systems and translation layers.
    return true;
  }

  // IANA currently assigns global unicast addresses from 2000::/3. Everything
  // outside that range is treated as non-public, including deprecated
  // site-local (fec0::/10), translation, multicast, and reserved space.
  if (!ipv6Prefix(value, "2000::", 3)) return true;

  // Special-purpose ranges that sit inside 2000::/3 still require explicit
  // rejection. 2001::/23 contains IANA protocol assignments, 2002::/16 is
  // 6to4, and the remaining ranges are documentation-only.
  const ranges: Array<[string, number]> = [
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
  ];
  return ranges.some(([base, prefix]) => ipv6Prefix(value, base, prefix));
}

export function isPublicAddress(address: string): boolean {
  if (isIPv4(address)) return !isBlockedIpv4(address);
  if (isIPv6(address)) return !isBlockedIpv6(address);
  return false;
}

export function parseTargetUrl(rawUrl: string): URL {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 2048) {
    throw new UrlFormatError("URLの形式または長さが許容範囲外です。");
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new UrlFormatError("有効な http / https URLを入力してください。");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlFormatError("http / https URLのみ検査できます。");
  }
  if (url.username || url.password) {
    throw new TargetPolicyError("認証情報を含むURLは検査できません。");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new TargetPolicyError("安全のため80 / 443番ポートのみ検査できます。");
  }

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    !hostname ||
    BLOCKED_HOSTS.has(hostname) ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    (!hostname.includes(".") && !isIPv4(hostname) && !isIPv6(hostname))
  ) {
    throw new TargetPolicyError("ローカルまたは内部ネットワークの宛先は検査できません。");
  }

  if ((isIPv4(hostname) || isIPv6(hostname)) && !isPublicAddress(hostname)) {
    throw new TargetPolicyError("Private / reserved IPへのアクセスをブロックしました。");
  }

  url.hash = "";
  return url;
}

function deadlinePromise(
  deadlineAt: number | undefined,
  signal: AbortSignal | undefined,
): { promise: Promise<never>; cleanup: () => void } {
  const remainingMs = deadlineAt === undefined ? DNS_LOOKUP_TIMEOUT_MS : deadlineAt - Date.now();
  const timeoutMs = Math.max(0, Math.min(DNS_LOOKUP_TIMEOUT_MS, remainingMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const promise = new Promise<never>((_resolve, reject) => {
    const rejectDeadline = () => reject(new AuditDeadlineError());
    timer = setTimeout(rejectDeadline, timeoutMs);
    onAbort = rejectDeadline;
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) rejectDeadline();
  });

  return {
    promise,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    },
  };
}

export async function resolvePublicTarget(
  rawUrl: string,
  options: ResolveTargetOptions = {},
): Promise<ResolvedTarget> {
  const url = parseTargetUrl(rawUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (isIPv4(hostname) || isIPv6(hostname)) {
    return { url, address: hostname, family: isIPv4(hostname) ? 4 : 6 };
  }

  let answers: Array<{ address: string; family: number }>;
  const lookupDeadline = deadlinePromise(options.deadlineAt, options.signal);
  try {
    // Promise.race attaches rejection handlers to both promises. A DNS lookup
    // that settles after the deadline therefore cannot become unhandled.
    answers = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      lookupDeadline.promise,
    ]);
  } catch (error) {
    if (error instanceof AuditDeadlineError) throw error;
    throw new TargetPolicyError("Host名を安全に解決できませんでした。");
  } finally {
    lookupDeadline.cleanup();
  }

  if (answers.length === 0 || answers.some((answer) => !isPublicAddress(answer.address))) {
    throw new TargetPolicyError("公開Internet以外のIPへ解決されたためブロックしました。");
  }

  const selected = answers[0];
  if (selected.family !== 4 && selected.family !== 6) {
    throw new TargetPolicyError("Host名を安全に解決できませんでした。");
  }
  return { url, address: selected.address, family: selected.family };
}
