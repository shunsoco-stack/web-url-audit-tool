"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleCheck,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileText,
  FileWarning,
  Gauge,
  Globe2,
  Link2,
  Link2Off,
  ListChecks,
  Network,
  Play,
  RefreshCw,
  Route,
  Search,
  ServerCrash,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import { downloadAuditCsv, downloadAuditXlsx } from "@/lib/export-report";
import {
  demoUrls,
  extractUrlsFromCsv,
  firstHttpOrigin,
  parsePastedUrls,
  urlScopeForOrigin,
} from "@/lib/input";
import {
  compareRuns,
  duplicateTitleIds,
  hasMissingMetadata,
  shouldRecheck,
  summarizeResults,
} from "@/lib/results";
import type {
  AuditResult,
  AuditRunSnapshot,
  AuditSource,
} from "@/lib/types";

const MAX_INPUT_URLS = 100;
const CLIENT_CONCURRENCY = 3;
const SNAPSHOT_KEY = "web-url-audit-tool:latest-run:v1";

type InputMode = "manual" | "paste" | "csv" | "crawl";
type ResultView = "all" | "broken";
type StatusFilter = "all" | "2xx" | "3xx" | "4xx" | "5xx" | "blocked";
type QuickFilter =
  | "all"
  | "broken"
  | "redirect"
  | "slow"
  | "missing-title"
  | "missing-metadata"
  | "internal"
  | "external";

interface AuditJob {
  url: string;
  source: AuditSource;
  depth: number;
  baseOrigin?: string;
  respectRobots: boolean;
  replaceId?: string;
}

interface AuditProgress {
  checked: number;
  total: number;
  currentUrl: string;
  label: string;
}

interface ToastState {
  kind: "success" | "info" | "error";
  message: string;
}

const INPUT_MODES: Array<{
  id: InputMode;
  label: string;
  caption: string;
  icon: typeof Link2;
}> = [
  { id: "manual", label: "URL入力", caption: "1件をすぐ確認", icon: Link2 },
  { id: "paste", label: "複数Paste", caption: "改行区切り", icon: ListChecks },
  { id: "csv", label: "CSV Import", caption: "URL列を自動検出", icon: Upload },
  { id: "crawl", label: "内部Link Crawl", caption: "起点URLから収集", icon: Network },
];

const EMPTY_PROGRESS: AuditProgress = {
  checked: 0,
  total: 0,
  currentUrl: "",
  label: "",
};

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeIdentity(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return rawUrl.trim().toLocaleLowerCase("en-US");
  }
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatResponseTime(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value} ms`;
}

function statusTone(result: AuditResult): string {
  if (result.broken) return "broken";
  return result.statusKind;
}

function canOpenResult(result: AuditResult): boolean {
  if (result.statusKind === "blocked" || result.statusKind === "failed") return false;
  try {
    const url = new URL(result.finalUrl || result.inputUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function statusSequence(result: AuditResult): string {
  const statuses = result.redirectChain.map((step) => step.status);
  if (statuses.length < 2) return result.status === null ? "ERR" : String(result.status);
  return statuses.join(" → ");
}

function isStoredResult(value: unknown): value is AuditResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<AuditResult>;
  return (
    typeof result.id === "string" &&
    typeof result.inputUrl === "string" &&
    typeof result.statusKind === "string" &&
    Boolean(result.metadata && typeof result.metadata.title === "string") &&
    Array.isArray(result.issues)
  );
}

function apiFailureResult(job: AuditJob, message: string): AuditResult {
  return {
    id: createId(),
    inputUrl: job.url,
    source: job.source,
    depth: job.depth,
    scope: urlScopeForOrigin(job.url, job.baseOrigin),
    status: null,
    statusKind: "failed",
    statusLabel: "確認失敗",
    finalUrl: job.url,
    redirectCount: 0,
    redirectChain: [],
    redirectLoop: false,
    responseTimeMs: null,
    contentType: "",
    metadata: { title: "", description: "", canonical: "", h1: "", h1Count: 0 },
    internalLinks: [],
    externalLinks: [],
    issues: [{ code: "REQUEST_FAILED", label: message, severity: "error" }],
    broken: false,
    slow: false,
    robotsAllowed: job.respectRobots ? false : null,
    checkedAt: new Date().toISOString(),
    errorCode: "REQUEST_FAILED",
    errorMessage: message,
  };
}

function readLatestSnapshot(): AuditRunSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const snapshot = parsed as AuditRunSnapshot;
    return Array.isArray(snapshot.results) &&
      snapshot.results.every(isStoredResult) &&
      typeof snapshot.createdAt === "string"
      ? snapshot
      : null;
  } catch {
    return null;
  }
}

function compactForStorage(results: AuditResult[]): AuditResult[] {
  return results.slice(0, MAX_INPUT_URLS).map((result) => ({
    ...result,
    internalLinks: [],
    externalLinks: [],
    redirectChain: result.redirectChain.slice(0, 10),
  }));
}

function storeSnapshot(results: AuditResult[], name: string): AuditRunSnapshot {
  const snapshot: AuditRunSnapshot = {
    id: createId(),
    name,
    createdAt: new Date().toISOString(),
    results: compactForStorage(results),
  };
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // The audit remains usable when storage is unavailable or full.
  }
  return snapshot;
}

async function requestAudit(
  job: AuditJob,
  slowThresholdMs: number,
  signal: AbortSignal,
): Promise<AuditResult> {
  const response = await fetch("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: job.url,
      baseOrigin: job.baseOrigin,
      slowThresholdMs,
      source: job.source,
      depth: job.depth,
      respectRobots: job.respectRobots,
    }),
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | { result?: AuditResult; error?: string }
    | null;
  if (!response.ok || !payload?.result) {
    throw new Error(payload?.error ?? `監査APIが ${response.status} を返しました。`);
  }
  return payload.result;
}

async function runConcurrent(
  jobs: AuditJob[],
  signal: AbortSignal,
  slowThresholdMs: number,
  onResult: (result: AuditResult, job: AuditJob) => void,
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const index = cursor;
      cursor += 1;
      const job = jobs[index];
      if (!job) return;
      let result: AuditResult;
      try {
        result = await requestAudit(job, slowThresholdMs, signal);
      } catch (error) {
        if (signal.aborted) return;
        result = apiFailureResult(
          job,
          error instanceof Error ? error.message : "監査APIへの接続に失敗しました。",
        );
      }
      if (!signal.aborted) onResult(result, job);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CLIENT_CONCURRENCY, jobs.length) }, () => worker()),
  );
}

function matchesStatus(result: AuditResult, filter: StatusFilter): boolean {
  switch (filter) {
    case "2xx":
      return result.statusKind === "ok";
    case "3xx":
      return result.statusKind === "redirect";
    case "4xx":
      return result.statusKind === "client-error";
    case "5xx":
      return result.statusKind === "server-error";
    case "blocked":
      return result.statusKind === "blocked" || result.statusKind === "failed";
    default:
      return true;
  }
}

function matchesQuickFilter(result: AuditResult, filter: QuickFilter): boolean {
  switch (filter) {
    case "broken":
      return result.broken;
    case "redirect":
      return result.statusKind === "redirect";
    case "slow":
      return result.slow;
    case "missing-title":
      return result.issues.some((issue) => issue.code === "MISSING_TITLE");
    case "missing-metadata":
      return hasMissingMetadata(result);
    case "internal":
      return result.scope === "internal";
    case "external":
      return result.scope === "external";
    default:
      return true;
  }
}

function StatusBadge({ result }: { result: AuditResult }) {
  return (
    <span className={`audit-status audit-status--${statusTone(result)}`}>
      <span className="audit-status__dot" aria-hidden="true" />
      <span>{statusSequence(result)}</span>
      <span className="audit-status__label">{result.statusLabel}</span>
    </span>
  );
}

export function AuditWorkbench() {
  const [inputMode, setInputMode] = useState<InputMode>("manual");
  const [manualUrl, setManualUrl] = useState("");
  const [pastedUrls, setPastedUrls] = useState("");
  const [csvUrls, setCsvUrls] = useState<string[]>([]);
  const [csvName, setCsvName] = useState("");
  const [crawlUrl, setCrawlUrl] = useState("");
  const [crawlDepth, setCrawlDepth] = useState(1);
  const [crawlLimit, setCrawlLimit] = useState(30);
  const [respectRobots, setRespectRobots] = useState(true);
  const [slowThreshold, setSlowThreshold] = useState(2000);
  const [results, setResults] = useState<AuditResult[]>([]);
  const [previousSnapshot, setPreviousSnapshot] = useState<AuditRunSnapshot | null>(null);
  const [progress, setProgress] = useState<AuditProgress>(EMPTY_PROGRESS);
  const [isRunning, setIsRunning] = useState(false);
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [selectedResult, setSelectedResult] = useState<AuditResult | null>(null);
  const [resultView, setResultView] = useState<ResultView>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [query, setQuery] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const isDrawerOpen = selectedResult !== null;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const background = Array.from(
      document.querySelectorAll<HTMLElement>(".audit-topbar, .audit-main"),
    );
    background.forEach((element) => {
      element.inert = true;
    });
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedResult(null);
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.inert);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      background.forEach((element) => {
        element.inert = false;
      });
      restoreFocusRef.current?.focus();
    };
  }, [isDrawerOpen]);

  const summary = useMemo(() => summarizeResults(results), [results]);
  const duplicates = useMemo(() => duplicateTitleIds(results), [results]);
  const comparison = useMemo(
    () => compareRuns(previousSnapshot, results),
    [previousSnapshot, results],
  );

  const filteredResults = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ja-JP");
    return results.filter((result) => {
      if (resultView === "broken" && !result.broken) return false;
      if (!matchesStatus(result, statusFilter)) return false;
      if (!matchesQuickFilter(result, quickFilter)) return false;
      if (!normalizedQuery) return true;
      return [
        result.inputUrl,
        result.finalUrl,
        result.metadata.title,
        result.metadata.description,
        result.metadata.h1,
        ...result.issues.map((issue) => issue.label),
      ]
        .join(" ")
        .toLocaleLowerCase("ja-JP")
        .includes(normalizedQuery);
    });
  }, [query, quickFilter, resultView, results, statusFilter]);

  const progressPercent =
    progress.total > 0 ? Math.min(100, (progress.checked / progress.total) * 100) : 0;

  const finishAudit = useCallback((completed: AuditResult[], label: string) => {
    if (completed.length > 0) storeSnapshot(completed, label);
    setProgress((current) => ({
      ...current,
      checked: completed.length,
      total: completed.length,
      currentUrl: "",
      label: "監査が完了しました",
    }));
    setIsRunning(false);
    abortControllerRef.current = null;
    setToast({ kind: "success", message: `${completed.length}件のURL監査が完了しました。` });
  }, []);

  const beginAudit = useCallback((total: number, label: string) => {
    const previous = readLatestSnapshot();
    setPreviousSnapshot(previous);
    setResults([]);
    setSelectedResult(null);
    setResultView("all");
    setStatusFilter("all");
    setQuickFilter("all");
    setQuery("");
    setFormError("");
    setProgress({ checked: 0, total, currentUrl: "", label });
    setIsRunning(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return controller;
  }, []);

  const runUrlList = useCallback(
    async (urls: string[], source: AuditSource, label: string) => {
      const unique = [...new Map(urls.map((url) => [normalizeIdentity(url), url])).values()].slice(
        0,
        MAX_INPUT_URLS,
      );
      if (unique.length === 0) {
        setFormError("監査するURLを1件以上入力してください。");
        return;
      }
      const controller = beginAudit(unique.length, label);
      const completed: AuditResult[] = [];
      const baseOrigin = firstHttpOrigin(unique);
      const jobs: AuditJob[] = unique.map((url) => ({
        url,
        source,
        depth: 0,
        baseOrigin,
        respectRobots: false,
      }));
      await runConcurrent(jobs, controller.signal, slowThreshold, (result, job) => {
        completed.push(result);
        setResults([...completed]);
        setProgress((current) => ({
          ...current,
          checked: completed.length,
          currentUrl: job.url,
        }));
      });
      if (controller.signal.aborted) {
        setIsRunning(false);
        setProgress((current) => ({ ...current, currentUrl: "", label: "監査を停止しました" }));
        setToast({ kind: "info", message: "監査を停止しました。完了済みの結果は保持されています。" });
        abortControllerRef.current = null;
        return;
      }
      finishAudit(completed, label);
    },
    [beginAudit, finishAudit, slowThreshold],
  );

  const runCrawl = useCallback(async () => {
    const parsed = parsePastedUrls(crawlUrl, 1);
    if (parsed.length === 0) {
      setFormError("Crawlの起点URLを入力してください。");
      return;
    }
    let baseOrigin: string;
    try {
      baseOrigin = new URL(parsed[0]).origin;
    } catch {
      await runUrlList(parsed, "crawl", "内部Link Crawl");
      return;
    }

    const controller = beginAudit(1, "内部Linkを探索中");
    const completed: AuditResult[] = [];
    const visited = new Set<string>([normalizeIdentity(parsed[0])]);
    let frontier = [parsed[0]];

    for (
      let depth = 0;
      depth <= crawlDepth && frontier.length > 0 && completed.length < crawlLimit;
      depth += 1
    ) {
      if (controller.signal.aborted) break;
      const remaining = crawlLimit - completed.length;
      const currentFrontier = frontier.slice(0, remaining);
      const nextCandidates: string[] = [];
      setProgress((current) => ({
        ...current,
        total: Math.max(current.total, completed.length + currentFrontier.length),
        label: `Depth ${depth} を監査中`,
      }));

      const jobs: AuditJob[] = currentFrontier.map((url) => ({
        url,
        source: "crawl",
        depth,
        baseOrigin,
        respectRobots,
      }));
      await runConcurrent(jobs, controller.signal, slowThreshold, (result, job) => {
        completed.push(result);
        if (depth < crawlDepth) {
          for (const link of result.internalLinks) nextCandidates.push(link.url);
        }
        setResults([...completed]);
        setProgress((current) => ({
          ...current,
          checked: completed.length,
          currentUrl: job.url,
        }));
      });

      const next: string[] = [];
      for (const candidate of nextCandidates) {
        if (completed.length + next.length >= crawlLimit) break;
        const identity = normalizeIdentity(candidate);
        if (visited.has(identity)) continue;
        try {
          if (new URL(candidate).origin !== baseOrigin) continue;
        } catch {
          continue;
        }
        visited.add(identity);
        next.push(candidate);
      }
      frontier = next;
      setProgress((current) => ({
        ...current,
        total: Math.max(current.total, completed.length + frontier.length),
      }));
    }

    if (controller.signal.aborted) {
      setIsRunning(false);
      setProgress((current) => ({ ...current, currentUrl: "", label: "Crawlを停止しました" }));
      setToast({ kind: "info", message: "Crawlを停止しました。発見済みの結果は保持されています。" });
      abortControllerRef.current = null;
      return;
    }
    finishAudit(completed, "内部Link Crawl");
  }, [beginAudit, crawlDepth, crawlLimit, crawlUrl, finishAudit, respectRobots, runUrlList, slowThreshold]);

  const startAudit = useCallback(() => {
    if (isRunning) return;
    if (inputMode === "crawl") {
      void runCrawl();
      return;
    }
    if (inputMode === "csv") {
      void runUrlList(csvUrls, "csv", "CSV Import監査");
      return;
    }
    const values = parsePastedUrls(inputMode === "manual" ? manualUrl : pastedUrls, MAX_INPUT_URLS);
    void runUrlList(values, "direct", inputMode === "manual" ? "URL監査" : "一括URL監査");
  }, [csvUrls, inputMode, isRunning, manualUrl, pastedUrls, runCrawl, runUrlList]);

  const runDemo = useCallback(() => {
    if (isRunning) return;
    setFormError("");
    void runUrlList(demoUrls(window.location.origin), "demo", "安全なDemo Dataset");
  }, [isRunning, runUrlList]);

  const stopAudit = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const recheckResults = useCallback(
    async (targets: AuditResult[]) => {
      if (isRunning || targets.length === 0) return;
      const before = results;
      const previous: AuditRunSnapshot = {
        id: createId(),
        name: "再チェック前",
        createdAt: new Date().toISOString(),
        results: compactForStorage(before),
      };
      setPreviousSnapshot(previous);
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsRunning(true);
      setProgress({
        checked: 0,
        total: targets.length,
        currentUrl: "",
        label: targets.length === 1 ? "URLを再チェック中" : "Error URLを再チェック中",
      });
      const replacements = new Map<string, AuditResult>();
      const recheckBaseOrigin =
        firstHttpOrigin(
          before.filter((result) => result.scope === "internal").map((result) => result.inputUrl),
        ) ?? firstHttpOrigin(before.map((result) => result.inputUrl));
      const jobs: AuditJob[] = targets.map((result) => ({
        url: result.inputUrl,
        source: result.source,
        depth: result.depth,
        baseOrigin: recheckBaseOrigin,
        respectRobots: result.robotsAllowed !== null,
        replaceId: result.id,
      }));
      await runConcurrent(jobs, controller.signal, slowThreshold, (result, job) => {
        if (job.replaceId) replacements.set(job.replaceId, result);
        setResults((current) =>
          current.map((item) => (item.id === job.replaceId ? result : item)),
        );
        setSelectedResult((current) => (current?.id === job.replaceId ? result : current));
        setProgress((current) => ({
          ...current,
          checked: replacements.size,
          currentUrl: job.url,
        }));
      });
      const updated = before.map((item) => replacements.get(item.id) ?? item);
      setResults(updated);
      if (controller.signal.aborted) {
        setIsRunning(false);
        setProgress((current) => ({ ...current, currentUrl: "", label: "再チェックを停止しました" }));
        abortControllerRef.current = null;
        return;
      }
      storeSnapshot(updated, "再チェック済み監査");
      setProgress({
        checked: targets.length,
        total: targets.length,
        currentUrl: "",
        label: "再チェックが完了しました",
      });
      setIsRunning(false);
      abortControllerRef.current = null;
      setToast({ kind: "success", message: `${targets.length}件を再チェックしました。` });
    },
    [isRunning, results, slowThreshold],
  );

  const handleCsvFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setFormError("CSVは2MB以下のファイルを選択してください。");
      return;
    }
    try {
      const text = await file.text();
      const urls = extractUrlsFromCsv(text, MAX_INPUT_URLS);
      setCsvUrls(urls);
      setCsvName(file.name);
      setFormError(urls.length === 0 ? "CSVからURLを検出できませんでした。" : "");
    } catch {
      setFormError("CSVを読み込めませんでした。UTF-8形式をお試しください。");
    }
  }, []);

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void handleCsvFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    void handleCsvFile(event.dataTransfer.files?.[0]);
  };

  const errorTargets = results.filter(shouldRecheck);
  const hasComparison = previousSnapshot !== null && results.length > 0 && !isRunning;
  const hasComparisonChanges =
    comparison.newBroken.length + comparison.fixed.length + comparison.newRedirects.length > 0;

  const summaryCards = [
    { label: "Total", value: summary.total, icon: Activity, tone: "neutral", resultView: "all", statusFilter: "all", quickFilter: "all" },
    { label: "OK", value: summary.ok, icon: CircleCheck, tone: "ok", resultView: "all", statusFilter: "2xx", quickFilter: "all" },
    { label: "Redirect", value: summary.redirects, icon: Route, tone: "redirect", resultView: "all", statusFilter: "3xx", quickFilter: "all" },
    { label: "Broken", value: summary.broken, icon: Link2Off, tone: "broken", resultView: "broken", statusFilter: "all", quickFilter: "broken" },
    { label: "Server Error", value: summary.serverErrors, icon: ServerCrash, tone: "server", resultView: "all", statusFilter: "5xx", quickFilter: "all" },
    { label: "Slow", value: summary.slow, icon: Gauge, tone: "slow", resultView: "all", statusFilter: "all", quickFilter: "slow" },
    { label: "Missing Metadata", value: summary.missingMetadata, icon: FileWarning, tone: "metadata", resultView: "all", statusFilter: "all", quickFilter: "missing-metadata" },
  ] satisfies Array<{
    label: string;
    value: number;
    icon: typeof Activity;
    tone: string;
    resultView: ResultView;
    statusFilter: StatusFilter;
    quickFilter: QuickFilter;
  }>;

  return (
    <div className="audit-app">
      <div className="audit-ambient audit-ambient--one" aria-hidden="true" />
      <div className="audit-ambient audit-ambient--two" aria-hidden="true" />

      <header className="audit-topbar">
        <a className="audit-brand" href="#top" aria-label="監査ツールの先頭へ">
          <span className="audit-brand__mark" aria-hidden="true">
            <Globe2 size={19} />
            <Link2 size={10} className="audit-brand__link" />
            <Check size={11} className="audit-brand__check" />
          </span>
          <span className="audit-brand__text">
            <strong>SiteScope</strong>
            <small>URL Audit Workspace</small>
          </span>
        </a>
        <div className="audit-topbar__status">
          <span className="audit-live-dot" aria-hidden="true" />
          <span>Server-side inspection</span>
          <span className="audit-topbar__divider" aria-hidden="true" />
          <ShieldCheck size={15} aria-hidden="true" />
          <span>SSRF Protected</span>
        </div>
        <button className="audit-button audit-button--ghost audit-topbar__demo" type="button" onClick={runDemo} disabled={isRunning}>
          <Database size={16} aria-hidden="true" />
          Demoを実行
        </button>
      </header>

      <main id="top" className="audit-main">
        <section className="audit-hero" aria-labelledby="app-title">
          <div className="audit-hero__copy">
            <p className="audit-eyebrow"><span /> WEB QUALITY CONTROL</p>
            <h1 id="app-title">WebサイトURL一括チェック<br className="audit-desktop-break" />・リンク監査ツール</h1>
            <p>
              HTTP・Redirect・Metadata・内部リンクをひと続きのワークフローで検査。
              公開前確認とサイト移行後の品質点検を、短く、確実に。
            </p>
          </div>
          <div className="audit-hero__assurance" aria-label="安全な監査設計">
            <div className="audit-assurance__icon"><ShieldCheck aria-hidden="true" /></div>
            <div>
              <span>Safe by design</span>
              <strong>Backend経由の安全なURL検査</strong>
              <small>Private IP・localhost・metadata endpointを遮断</small>
            </div>
          </div>
        </section>

        <section className="audit-console" aria-labelledby="audit-setup-title">
          <div className="audit-console__header">
            <div>
              <p className="audit-section-kicker">NEW AUDIT</p>
              <h2 id="audit-setup-title">監査対象を指定</h2>
            </div>
            <div className="audit-limit-note">
              <Zap size={15} aria-hidden="true" />
              同時実行 {CLIENT_CONCURRENCY}件・最大 {MAX_INPUT_URLS} URL
            </div>
          </div>

          <div className="audit-mode-tabs" role="group" aria-label="URLの入力方法">
            {INPUT_MODES.map(({ id, label, caption, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={inputMode === id}
                className={`audit-mode-tab${inputMode === id ? " is-active" : ""}`}
                onClick={() => {
                  setInputMode(id);
                  setFormError("");
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <span><strong>{label}</strong><small>{caption}</small></span>
              </button>
            ))}
          </div>

          <div className="audit-console__body">
            <div className="audit-input-panel">
              {inputMode === "manual" && (
                <div className="audit-field-group">
                  <label htmlFor="manual-url">検査するURL</label>
                  <div className="audit-url-input">
                    <Globe2 size={18} aria-hidden="true" />
                    <input
                      id="manual-url"
                      type="url"
                      value={manualUrl}
                      onChange={(event) => setManualUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") startAudit();
                      }}
                      placeholder="https://example.com/page"
                      autoComplete="url"
                      spellCheck={false}
                    />
                  </div>
                  <p className="audit-field-help">Protocol省略時は https:// を補完します。</p>
                </div>
              )}

              {inputMode === "paste" && (
                <div className="audit-field-group">
                  <label htmlFor="paste-urls">URL一覧</label>
                  <textarea
                    id="paste-urls"
                    value={pastedUrls}
                    onChange={(event) => setPastedUrls(event.target.value)}
                    placeholder={"https://example.com/\nhttps://example.com/about\nhttps://example.com/contact"}
                    rows={6}
                    spellCheck={false}
                  />
                  <p className="audit-field-help">
                    改行・空白・タブ区切りに対応。重複URLは自動で除外します。
                    <span>{parsePastedUrls(pastedUrls, MAX_INPUT_URLS).length} URL</span>
                  </p>
                </div>
              )}

              {inputMode === "csv" && (
                <div className="audit-field-group">
                  <label
                    className={`audit-dropzone${csvUrls.length > 0 ? " has-file" : ""}`}
                    htmlFor="csv-file"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleDrop}
                  >
                    <input id="csv-file" type="file" accept=".csv,text/csv" onChange={handleFileInput} />
                    <span className="audit-dropzone__icon"><Upload size={22} aria-hidden="true" /></span>
                    {csvUrls.length > 0 ? (
                      <>
                        <strong>{csvName}</strong>
                        <span>{csvUrls.length}件のURLを検出しました</span>
                        <small>クリックして別のCSVに差し替え</small>
                      </>
                    ) : (
                      <>
                        <strong>CSVをドロップ、または選択</strong>
                        <span>url / link / href 列を自動検出</span>
                        <small>UTF-8・最大2MB</small>
                      </>
                    )}
                  </label>
                </div>
              )}

              {inputMode === "crawl" && (
                <div className="audit-field-group">
                  <label htmlFor="crawl-url">起点URL</label>
                  <div className="audit-url-input">
                    <Network size={18} aria-hidden="true" />
                    <input
                      id="crawl-url"
                      type="url"
                      value={crawlUrl}
                      onChange={(event) => setCrawlUrl(event.target.value)}
                      placeholder="https://example.com/"
                      autoComplete="url"
                      spellCheck={false}
                    />
                  </div>
                  <div className="audit-crawl-settings">
                    <label>
                      <span>最大Depth</span>
                      <select value={crawlDepth} onChange={(event) => setCrawlDepth(Number(event.target.value))}>
                        <option value={0}>0 — 起点のみ</option>
                        <option value={1}>1 — 直下まで</option>
                        <option value={2}>2 — 2階層まで</option>
                        <option value={3}>3 — 3階層まで</option>
                      </select>
                    </label>
                    <label>
                      <span>最大URL数</span>
                      <input
                        type="number"
                        min={5}
                        max={100}
                        step={5}
                        value={crawlLimit}
                        onChange={(event) => setCrawlLimit(Math.min(100, Math.max(5, Number(event.target.value) || 5)))}
                      />
                    </label>
                    <label className="audit-toggle-row">
                      <input
                        type="checkbox"
                        checked={respectRobots}
                        onChange={(event) => setRespectRobots(event.target.checked)}
                      />
                      <span className="audit-toggle" aria-hidden="true"><span /></span>
                      <span><strong>robots.txtを尊重</strong><small>推奨・Crawl対象ごとに確認</small></span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            <aside className="audit-options" aria-label="監査設定">
              <div className="audit-options__title">
                <SlidersHorizontal size={17} aria-hidden="true" />
                <strong>Quality settings</strong>
              </div>
              <label htmlFor="slow-threshold">
                <span>Slow判定の閾値</span>
                <strong>{slowThreshold.toLocaleString()} ms</strong>
              </label>
              <input
                id="slow-threshold"
                className="audit-range"
                type="range"
                min={500}
                max={5000}
                step={250}
                value={slowThreshold}
                onChange={(event) => setSlowThreshold(Number(event.target.value))}
              />
              <div className="audit-range-labels"><span>500ms</span><span>5,000ms</span></div>
              <div className="audit-options__checks">
                <span><Check size={13} /> Redirect Chain</span>
                <span><Check size={13} /> SEO Metadata</span>
                <span><Check size={13} /> Link Scope</span>
              </div>
            </aside>
          </div>

          {formError && (
            <p className="audit-form-error" role="alert"><AlertTriangle size={16} />{formError}</p>
          )}

          <div className="audit-console__footer">
            <p><ShieldCheck size={15} aria-hidden="true" /> localhost・private IP・link-localをBackendで遮断します。</p>
            <div>
              <button className="audit-button audit-button--secondary" type="button" onClick={runDemo} disabled={isRunning}>
                <Database size={16} aria-hidden="true" /> 安全なDemo
              </button>
              {isRunning ? (
                <button className="audit-button audit-button--danger" type="button" onClick={stopAudit}>
                  <X size={17} aria-hidden="true" /> 停止
                </button>
              ) : (
                <button className="audit-button audit-button--primary" type="button" onClick={startAudit}>
                  <Play size={17} fill="currentColor" aria-hidden="true" /> 監査を開始
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </section>

        {(isRunning || results.length > 0 || progress.label) && (
          <section className={`audit-progress-card${isRunning ? " is-running" : ""}`} aria-label="監査進捗">
            <div className="audit-progress-card__top">
              <div className="audit-progress-card__state">
                <span className="audit-progress-orbit" aria-hidden="true"><Globe2 size={17} /></span>
                <div>
                  <strong>{progress.label || "監査結果"}</strong>
                  <span title={progress.currentUrl}>{progress.currentUrl || (results.length > 0 ? "全URLの確認が完了しました" : "準備中")}</span>
                </div>
              </div>
              <div className="audit-progress-card__count" aria-live="polite" aria-atomic="true">
                <strong>{progress.checked}</strong><span> / {progress.total} URLs checked</span>
              </div>
            </div>
            <div
              className="audit-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={Math.max(1, progress.total)}
              aria-valuenow={progress.checked}
              aria-label={`${progress.checked} / ${progress.total} URLを確認済み`}
            >
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="audit-progress-card__meta">
              <span><span className="audit-live-dot" /> Concurrency {CLIENT_CONCURRENCY}</span>
              <span>{inputMode === "crawl" && isRunning ? `Depth上限 ${crawlDepth}・最大 ${crawlLimit} URL` : `Slow ≥ ${slowThreshold.toLocaleString()}ms`}</span>
            </div>
          </section>
        )}

        {results.length > 0 && (
          <>
            <section className="audit-results-heading" aria-labelledby="dashboard-title">
              <div>
                <p className="audit-section-kicker">AUDIT OVERVIEW</p>
                <h2 id="dashboard-title">Audit Dashboard</h2>
                <p>{isRunning ? "取得できた結果からリアルタイム集計しています。" : `${formatDate(results[0].checkedAt)} の監査結果`}</p>
              </div>
              <div className="audit-results-heading__actions">
                <button
                  type="button"
                  className="audit-button audit-button--secondary"
                  onClick={() => void recheckResults(errorTargets)}
                  disabled={isRunning || errorTargets.length === 0}
                >
                  <RefreshCw size={16} aria-hidden="true" /> Errorのみ再チェック
                  {errorTargets.length > 0 && <span className="audit-button__count">{errorTargets.length}</span>}
                </button>
                <div className="audit-export-group" aria-label="監査結果を書き出す">
                  <button type="button" onClick={() => downloadAuditCsv(results)} disabled={isRunning}>
                    <Download size={15} aria-hidden="true" /> CSV
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setIsExportingXlsx(true);
                      try {
                        await downloadAuditXlsx(results);
                        setToast({ kind: "success", message: "XLSXを書き出しました。" });
                      } catch {
                        setToast({ kind: "error", message: "XLSXの書き出しに失敗しました。" });
                      } finally {
                        setIsExportingXlsx(false);
                      }
                    }}
                    disabled={isRunning || isExportingXlsx}
                  >
                    <Download size={15} aria-hidden="true" /> {isExportingXlsx ? "作成中…" : "XLSX"}
                  </button>
                </div>
              </div>
            </section>

            <section className="audit-summary-grid" aria-label="監査結果サマリー">
              {summaryCards.map(({ label, value, icon: Icon, tone, resultView: nextView, statusFilter: nextStatus, quickFilter: nextQuick }) => (
                <button
                  key={label}
                  type="button"
                  className={`audit-summary-card audit-summary-card--${tone}`}
                  onClick={() => {
                    setResultView(nextView);
                    setStatusFilter(nextStatus);
                    setQuickFilter(nextQuick);
                    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                    document.getElementById("audit-results")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
                  }}
                >
                  <span className="audit-summary-card__icon"><Icon size={18} aria-hidden="true" /></span>
                  <span className="audit-summary-card__label">{label}</span>
                  <strong>{value}</strong>
                  <ChevronRight size={15} className="audit-summary-card__arrow" aria-hidden="true" />
                </button>
              ))}
            </section>

            {hasComparison && (
              <section className="audit-compare" aria-labelledby="compare-title">
                <div className="audit-compare__intro">
                  <span className="audit-compare__icon"><Activity size={18} aria-hidden="true" /></span>
                  <div>
                    <p className="audit-section-kicker">COMPARE RUNS</p>
                    <h2 id="compare-title">前回監査との差分</h2>
                    <small>{formatDate(previousSnapshot.createdAt)} と比較</small>
                  </div>
                </div>
                <div className="audit-compare__stats">
                  <div className="audit-compare-stat">
                    <span className="audit-change-dot audit-change-dot--bad" />
                    <span>新規404 / 410</span><strong>{comparison.newBroken.length}</strong>
                  </div>
                  <div className="audit-compare-stat">
                    <span className="audit-change-dot audit-change-dot--good" />
                    <span>修復済み</span><strong>{comparison.fixed.length}</strong>
                  </div>
                  <div className="audit-compare-stat">
                    <span className="audit-change-dot audit-change-dot--redirect" />
                    <span>新規Redirect</span><strong>{comparison.newRedirects.length}</strong>
                  </div>
                </div>
                {!hasComparisonChanges && <p className="audit-compare__stable"><CheckCircle2 size={15} /> 前回から重要な変化はありません</p>}
              </section>
            )}

            <section id="audit-results" className="audit-results" aria-label="URL監査結果">
              <div className="audit-results__topline">
                <div className="audit-view-tabs" role="group" aria-label="結果ビュー">
                  <button type="button" aria-pressed={resultView === "all"} className={resultView === "all" ? "is-active" : ""} onClick={() => setResultView("all")}>
                    すべてのURL <span>{results.length}</span>
                  </button>
                  <button type="button" aria-pressed={resultView === "broken"} className={resultView === "broken" ? "is-active" : ""} onClick={() => setResultView("broken")}>
                    <Link2Off size={15} aria-hidden="true" /> Broken Links <span>{summary.broken}</span>
                  </button>
                </div>
                <p>{resultView === "broken" ? "404 / 410を独立表示" : "HTTP・SEO・Linkを横断表示"}</p>
              </div>

              <div className="audit-filterbar">
                <label className="audit-search">
                  <Search size={17} aria-hidden="true" />
                  <span className="sr-only">URLまたはTitleで検索</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="URL・Title・Issueを検索" />
                  {query && <button type="button" onClick={() => setQuery("")} aria-label="検索をクリア"><X size={14} /></button>}
                </label>
                <label className="audit-select-wrap">
                  <span className="sr-only">HTTP Statusで絞り込み</span>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                    <option value="all">すべてのStatus</option>
                    <option value="2xx">2xx — 正常</option>
                    <option value="3xx">3xx — Redirect</option>
                    <option value="4xx">4xx — Client Error</option>
                    <option value="5xx">5xx — Server Error</option>
                    <option value="blocked">Blocked / Failed</option>
                  </select>
                </label>
                <label className="audit-select-wrap">
                  <span className="sr-only">IssueまたはLink種別で絞り込み</span>
                  <select value={quickFilter} onChange={(event) => setQuickFilter(event.target.value as QuickFilter)}>
                    <option value="all">すべてのIssue</option>
                    <option value="broken">Broken</option>
                    <option value="redirect">Redirect</option>
                    <option value="slow">Slow</option>
                    <option value="missing-title">Missing Title</option>
                    <option value="missing-metadata">Missing Metadata</option>
                    <option value="internal">Internal Link</option>
                    <option value="external">External Link</option>
                  </select>
                </label>
                <div className="audit-filterbar__count"><SlidersHorizontal size={15} /> {filteredResults.length} / {results.length}件</div>
              </div>

              <div className="audit-table-wrap">
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th scope="col">HTTP Status</th>
                      <th scope="col">URL / Title</th>
                      <th scope="col">Link</th>
                      <th scope="col">Redirect</th>
                      <th scope="col">Response</th>
                      <th scope="col">Issues</th>
                      <th scope="col"><span className="sr-only">詳細</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((result) => (
                      <tr key={result.id} className={result.broken ? "is-broken" : ""}>
                        <td><StatusBadge result={result} /></td>
                        <td className="audit-url-cell">
                          {canOpenResult(result) ? (
                            <a href={result.finalUrl || result.inputUrl} target="_blank" rel="noreferrer noopener" title={result.inputUrl}>
                              <span><small>Input</small>{result.inputUrl}</span><ExternalLink size={12} aria-hidden="true" />
                            </a>
                          ) : (
                            <span className="audit-url-blocked" title={result.inputUrl}>
                              <ShieldCheck size={12} aria-hidden="true" />
                              <span><small>Input</small>{result.inputUrl}</span>
                            </span>
                          )}
                          <p>{result.metadata.title || <span className="audit-muted">Titleなし</span>}</p>
                          <span className="audit-final-url" title={result.finalUrl}>
                            <small>Final</small>{result.finalUrl || "—"}
                          </span>
                          {duplicates.has(result.id) && <span className="audit-duplicate"><FileWarning size={11} /> Duplicate Title</span>}
                        </td>
                        <td>
                          <span className={`audit-scope audit-scope--${result.scope}`}>
                            {result.scope === "internal" ? "内部" : "外部"}
                          </span>
                          <small className="audit-link-counts">IN {result.internalLinks.length} · OUT {result.externalLinks.length}</small>
                        </td>
                        <td>
                          {result.redirectCount > 0 ? (
                            <button type="button" className="audit-redirect-count" onClick={() => setSelectedResult(result)}>
                              <Route size={14} /> {result.redirectCount} hop{result.redirectCount > 1 ? "s" : ""}
                            </button>
                          ) : <span className="audit-cell-empty">—</span>}
                        </td>
                        <td>
                          <span className={`audit-time${result.slow ? " is-slow" : ""}`}>
                            <Clock3 size={13} /> {formatResponseTime(result.responseTimeMs)}
                          </span>
                        </td>
                        <td>
                          <div className="audit-issue-list">
                            {result.issues.slice(0, 2).map((issue) => (
                              <span key={issue.code} className={`audit-issue audit-issue--${issue.severity}`}>{issue.label}</span>
                            ))}
                            {result.issues.length === 0 && <span className="audit-no-issue"><Check size={12} /> Issueなし</span>}
                            {result.issues.length > 2 && <span className="audit-more-issues">+{result.issues.length - 2}</span>}
                          </div>
                        </td>
                        <td>
                          <button type="button" className="audit-row-action" onClick={() => setSelectedResult(result)} aria-label={`${result.inputUrl}の詳細を表示`}>
                            <ChevronRight size={17} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredResults.length === 0 && (
                  <div className="audit-table-empty">
                    <Search size={24} aria-hidden="true" />
                    <strong>条件に一致するURLはありません</strong>
                    <p>検索語またはFilterを変更してください。</p>
                    <button type="button" onClick={() => { setQuery(""); setStatusFilter("all"); setQuickFilter("all"); setResultView("all"); }}>Filterを解除</button>
                  </div>
                )}
              </div>
              <footer className="audit-results__footer">
                <span>Checked {results.length} URLs</span>
                <span>Last response · {formatDate(results.at(-1)?.checkedAt ?? new Date().toISOString())}</span>
                <span><ShieldCheck size={13} /> Security policy applied</span>
              </footer>
            </section>
          </>
        )}

        {results.length === 0 && !isRunning && (
          <section className="audit-empty-preview" aria-label="監査ワークフロー">
            <div className="audit-empty-preview__flow" aria-hidden="true">
              {[{ icon: ListChecks, label: "URLs" }, { icon: Network, label: "Crawl" }, { icon: Activity, label: "HTTP Check" }, { icon: FileText, label: "Metadata" }, { icon: SlidersHorizontal, label: "Filter" }, { icon: Download, label: "Export" }].map(({ icon: Icon, label }, index, values) => (
                <span key={label} className="audit-flow-step">
                  <span><Icon size={18} /></span><small>{label}</small>
                  {index < values.length - 1 && <ChevronRight size={15} className="audit-flow-arrow" />}
                </span>
              ))}
            </div>
            <div className="audit-empty-preview__copy">
              <strong>入力からレポートまで、監査作業をひとつに。</strong>
              <p>安全な実HTTP endpointを使うDemo Datasetで、結果画面をすぐに体験できます。</p>
            </div>
            <button type="button" className="audit-button audit-button--secondary" onClick={runDemo}>
              <Play size={16} fill="currentColor" /> Demo監査を開始
            </button>
          </section>
        )}

        <footer className="audit-footer">
          <div><span className="audit-brand__mark audit-brand__mark--small"><Globe2 size={15} /><Link2 size={8} className="audit-brand__link" /><Check size={9} className="audit-brand__check" /></span><strong>SiteScope</strong></div>
          <p>Web制作・SEO・サイト移行後の品質確認を、より安全に、より速く。</p>
          <span>業務効率化ツール · Web監査・リンクチェック</span>
        </footer>
      </main>

      {selectedResult && (
        <div className="audit-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedResult(null); }}>
          <aside ref={drawerRef} className="audit-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <header className="audit-drawer__header">
              <div>
                <p className="audit-section-kicker">URL INSPECTION</p>
                <h2 id="detail-title">監査詳細</h2>
              </div>
              <button ref={closeButtonRef} type="button" onClick={() => setSelectedResult(null)} aria-label="詳細を閉じる"><X size={19} /></button>
            </header>
            <div className="audit-drawer__content">
              <section className="audit-detail-hero">
                <StatusBadge result={selectedResult} />
                <h3>{selectedResult.metadata.title || "Titleなし"}</h3>
                <div className="audit-detail-urls">
                  <div>
                    <small>Input URL</small>
                    {canOpenResult(selectedResult) ? (
                      <a href={selectedResult.inputUrl} target="_blank" rel="noreferrer noopener">
                        {selectedResult.inputUrl}<ExternalLink size={12} />
                      </a>
                    ) : <span>{selectedResult.inputUrl}</span>}
                  </div>
                  <div>
                    <small>Final URL</small>
                    {canOpenResult(selectedResult) ? (
                      <a href={selectedResult.finalUrl} target="_blank" rel="noreferrer noopener">
                        {selectedResult.finalUrl}<ExternalLink size={12} />
                      </a>
                    ) : <span>{selectedResult.finalUrl || "—"}</span>}
                  </div>
                </div>
                <div className="audit-detail-metrics">
                  <span><small>Response</small><strong>{formatResponseTime(selectedResult.responseTimeMs)}</strong></span>
                  <span><small>Redirect</small><strong>{selectedResult.redirectCount} hop{selectedResult.redirectCount === 1 ? "" : "s"}</strong></span>
                  <span><small>Link</small><strong>{selectedResult.scope === "internal" ? "内部" : "外部"}</strong></span>
                </div>
              </section>

              <section className="audit-detail-section">
                <div className="audit-detail-section__title"><Route size={16} /><h3>Redirect Chain</h3><span>{selectedResult.redirectCount} hops</span></div>
                {selectedResult.redirectCount > 0 || selectedResult.redirectLoop ? (
                  <ol className="audit-redirect-chain">
                    {selectedResult.redirectChain.map((step, index) => (
                      <li key={`${step.url}-${index}`}>
                        <span className={`audit-chain-code audit-chain-code--${Math.floor(step.status / 100)}xx`}>{step.status}</span>
                        <div><strong title={step.url}>{step.url}</strong><small>{formatResponseTime(step.responseTimeMs)}</small>{step.location && <p><ArrowRight size={12} /> {step.location}</p>}</div>
                      </li>
                    ))}
                  </ol>
                ) : <p className="audit-detail-empty"><CheckCircle2 size={16} /> Redirectはありません</p>}
                {selectedResult.redirectLoop && <p className="audit-detail-alert"><AlertTriangle size={15} /> Redirect Loopを検出しました。</p>}
              </section>

              <section className="audit-detail-section">
                <div className="audit-detail-section__title"><FileText size={16} /><h3>Metadata</h3></div>
                <dl className="audit-metadata-list">
                  <div><dt>Title</dt><dd>{selectedResult.metadata.title || <span>未設定</span>}</dd></div>
                  <div><dt>Description</dt><dd>{selectedResult.metadata.description || <span>未設定</span>}</dd></div>
                  <div><dt>Canonical</dt><dd>{selectedResult.metadata.canonical || <span>未設定</span>}</dd></div>
                  <div><dt>H1</dt><dd>{selectedResult.metadata.h1 || <span>未設定</span>}<small>{selectedResult.metadata.h1Count} element</small></dd></div>
                </dl>
              </section>

              <section className="audit-detail-section">
                <div className="audit-detail-section__title"><Link2 size={16} /><h3>Discovered Links</h3></div>
                <div className="audit-link-panels">
                  <div><strong>内部Link <span>{selectedResult.internalLinks.length}</span></strong>{selectedResult.internalLinks.slice(0, 4).map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer noopener" title={link.url}>{link.text || link.url}</a>)}{selectedResult.internalLinks.length === 0 && <small>検出なし</small>}</div>
                  <div><strong>外部Link <span>{selectedResult.externalLinks.length}</span></strong>{selectedResult.externalLinks.slice(0, 4).map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer noopener" title={link.url}>{link.text || link.url}</a>)}{selectedResult.externalLinks.length === 0 && <small>検出なし</small>}</div>
                </div>
              </section>

              <section className="audit-detail-section">
                <div className="audit-detail-section__title"><AlertTriangle size={16} /><h3>Quality Issues</h3><span>{selectedResult.issues.length + (duplicates.has(selectedResult.id) ? 1 : 0)}</span></div>
                <div className="audit-detail-issues">
                  {selectedResult.issues.map((issue) => <span key={issue.code} className={`audit-detail-issue audit-detail-issue--${issue.severity}`}><AlertTriangle size={14} /><span><strong>{issue.label}</strong><small>{issue.code}</small></span></span>)}
                  {duplicates.has(selectedResult.id) && <span className="audit-detail-issue audit-detail-issue--warning"><FileWarning size={14} /><span><strong>Duplicate Title</strong><small>DUPLICATE_TITLE</small></span></span>}
                  {selectedResult.issues.length === 0 && !duplicates.has(selectedResult.id) && <p className="audit-detail-empty"><CheckCircle2 size={16} /> Rule-basedのIssueはありません</p>}
                </div>
              </section>
            </div>
            <footer className="audit-drawer__footer">
              <span><Clock3 size={13} /> {formatDate(selectedResult.checkedAt)}</span>
              <button type="button" className="audit-button audit-button--primary" onClick={() => void recheckResults([selectedResult])} disabled={isRunning}>
                <RefreshCw size={15} /> このURLを再チェック
              </button>
            </footer>
          </aside>
        </div>
      )}

      <div
        className={`audit-toast audit-toast--${toast?.kind ?? "success"}${toast ? " is-visible" : ""}`}
        role={toast?.kind === "error" ? "alert" : "status"}
        aria-live={toast?.kind === "error" ? "assertive" : "polite"}
      >
        {toast?.kind === "error" ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
        {toast?.message ?? ""}
      </div>
    </div>
  );
}
