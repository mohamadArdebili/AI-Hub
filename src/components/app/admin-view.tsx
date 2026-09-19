"use client";

import { useState, useEffect, useRef, useCallback, Fragment, useMemo } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { authFetch } from "@/lib/api-client";
import { ThemeToggle } from "@/components/chat/theme-toggle";
import { format } from "date-fns";
import { faIR } from "date-fns/locale";

import {
  ArrowRight,
  LogOut,
  ShieldCheck,
  Upload,
  FileText,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  Pencil,
  Search,
  FlaskConical,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
  Clock,
  ShieldAlert,
  RefreshCw,
  BookKey,
  EyeOff,
  Server,
  Globe,
  ScanSearch,
  Send,
  Undo2,
  Archive,
  Cpu,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// ─── Types ──────────────────────────────────────────────────────────────

type DocLifecycle = "DRAFT" | "REVIEW" | "ACTIVE" | "ARCHIVED";

type RuleReviewStatus =
  | "DRAFT"
  | "REVIEW"
  | "ACTIVE"
  | "ARCHIVED"
  | "REJECTED"
  | "PENDING_LLM";

interface PolicyDoc {
  id: string;
  filename: string;
  size: number;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  version: number;
  isActive: boolean;
  sourceType: "PDF" | "TXT" | "MD";
  lifecycle: DocLifecycle;
  hasCompiledRules: boolean;
  reviewedAt: string | null;
  activatedAt: string | null;
  extractedCharCount: number | null;
  errorMessage: string | null;
  createdAt: string;
}

interface PolicyDetailChunk {
  id: string;
  index: number;
  pageIndex: number | null;
  textHash: string | null;
  spanStart: number | null;
  spanEnd: number | null;
  isCandidate: boolean;
  isRestricted: boolean;
  content: string;
}

interface PolicyDetailRule {
  id: string;
  code: string;
  title: string;
  status: RuleReviewStatus;
  detectorType: "REGEX" | "CHECKSUM" | "DICTIONARY" | "SEMANTIC";
  checksumKind: string | null;
  action: "BLOCK_EXTERNAL" | "MASK" | "FLAG_REVIEW";
  priority: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category: string | null;
  keywords: string[];
  patterns: string[];
  sourceQuote: string | null;
  sourcePage: number | null;
  textHash: string | null;
  conflictGroup: string | null;
  reviewNote: string | null;
  chunkId: string | null;
  isManual: boolean;
  isActive: boolean;
}

interface PolicyDetail {
  document: {
    id: string;
    filename: string;
    sourceType: "PDF" | "TXT" | "MD";
    status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
    lifecycle: DocLifecycle;
    isActive: boolean;
    version: number;
    extractedCharCount: number | null;
    errorMessage: string | null;
    reviewedAt: string | null;
    activatedAt: string | null;
    createdAt: string;
    hasCompiledRules: boolean;
  };
  chunks: PolicyDetailChunk[];
  rules: PolicyDetailRule[];
}

interface LlmStatus {
  enabled: boolean;
  available: boolean;
  reason?: "DISABLED_BY_ENV" | "UNREACHABLE" | "MODEL_NOT_FOUND" | "UNKNOWN";
  model?: string;
  baseUrl?: string;
}

interface PolicyRule {
  id: string;
  documentId?: string | null;
  code: string;
  title: string;
  body?: string | null;
  keywords: string[];
  patterns: string[];
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category?: string | null;
  isActive: boolean;
  isManual: boolean;
  createdAt: string;
}

interface DecisionLog {
  id: string;
  userId: string;
  userEmail: string | null;
  action: "ALLOW" | "BLOCK";
  score: number;
  reasons: string[];
  matchedRuleIds: string[];
  promptPreview: string;
  promptLength: number;
  latencyMs: number;
  engineVersion: string;
  // Phase 3 audit fields
  route?: "EXTERNAL" | "LOCAL" | "BLOCKED" | null;
  maskCount?: number;
  maskLabels?: Array<{ label: string; count: number }>;
  isSensitive?: boolean | null;
  classifierCategory?: string | null;
  classifierRisk?: string | null;
  classifierReason?: string | null;
  sourceIp?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  createdAt: string;
}

interface MaskDictEntry {
  id: string;
  kind: "SENIOR_OFFICER" | "TELCO_HUB_NODE" | "PROPRIETARY_SERVICE";
  term: string;
  isActive: boolean;
  createdAt: string;
}

interface PolicyTestResult {
  pipelineVersion: string;
  latencyMs: number;
  finalRoute?: "EXTERNAL_DIRECT" | "EXTERNAL_MASKED" | "LOCAL" | "BLOCKED" | "EXTERNAL";
  route: "EXTERNAL_DIRECT" | "EXTERNAL_MASKED" | "LOCAL" | "BLOCKED" | "EXTERNAL";
  routeFa: string;
  pipelineHealth?: "HEALTHY" | "DEGRADED" | "FAILED";
  policyVersion?: number;
  sanitize: {
    maskedText: string;
    maskCount: number;
    findings: Array<{ label: string; count: number; labelFa: string }>;
  };
  deterministicHits?: Array<{
    detectorType: string;
    category: string;
    categoryFa: string;
    matchedSpan: { start: number; end: number; text: string };
    confidence: number;
    ruleLabel?: string;
  }>;
  retrieval?: Array<{
    conceptId: string;
    conceptKey: string;
    name: string;
    category?: string | null;
    sensitivity: string;
    action: string;
    score: number;
    denseScore?: number;
    lexicalScore?: number;
    rrfScore?: number;
  }>;
  classifier?: {
    decision?: string;
    scope?: string;
    confidence: number;
    reasonFa: string;
    method: string;
    modelUsed?: string;
    matchedConcepts?: string[];
  } | null;
  stageLatencies?: {
    normalizationMs: number;
    dlpMs: number;
    retrievalMs: number;
    classifierMs: number;
    fusionMs: number;
    decisionMs: number;
    totalMs: number;
  };
  engine: {
    action: "ALLOW" | "BLOCK";
    score: number;
    reasons: string[];
    matchedRules: { code: string; title: string; severity: string }[];
    latencyMs: number;
    engineVersion: string;
    hasActiveDocument: boolean;
  };
  detection: {
    decision: "SAFE" | "SENSITIVE" | "UNCERTAIN" | string;
    decisionFa?: string;
    action: "EXTERNAL_ALLOWED" | "LOCAL_ONLY" | string;
    reason: string | null;
    hitLabels: string[];
    hitCount: number;
    durationMs: number;
    externalLlmInvoked?: false;
  } | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "۰ بایت";
  const units = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(dateStr: string): string {
  try {
    return format(new Date(dateStr), "yyyy/MM/dd HH:mm", { locale: faIR });
  } catch {
    return "—";
  }
}

function truncate(str: string, max: number): string {
  if (!str) return "—";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function getStatusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    PENDING: {
      label: "در انتظار",
      className:
        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    },
    PROCESSING: {
      label: "در حال پردازش",
      className:
        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    },
    READY: {
      label: "آماده",
      className:
        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    },
    FAILED: {
      label: "ناموفق",
      className:
        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
  };
  const info = map[status] || { label: status, className: "" };
  return <Badge variant="secondary" className={info.className}>{info.label}</Badge>;
}

function getSeverityBadge(severity: string) {
  const map: Record<string, { label: string; className: string }> = {
    CRITICAL: {
      label: "بحرانی",
      className:
        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
    HIGH: {
      label: "بالا",
      className:
        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    },
    MEDIUM: {
      label: "متوسط",
      className:
        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    },
    LOW: {
      label: "پایین",
      className:
        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    },
  };
  const info = map[severity] || { label: severity, className: "" };
  return <Badge variant="secondary" className={info.className}>{info.label}</Badge>;
}

function getRouteBadge(route?: string | null) {
  if (!route) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const map: Record<string, { label: string; className: string }> = {
    EXTERNAL: {
      label: "خارجی",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    LOCAL: {
      label: "محلی",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    },
    BLOCKED: {
      label: "متوقف",
      className:
        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
  };
  const info = map[route] || { label: route, className: "" };
  return <Badge variant="secondary" className={info.className}>{info.label}</Badge>;
}

function getRiskBadge(risk?: string | null) {
  if (!risk) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return getSeverityBadge(risk.toUpperCase());
}

function getLifecycleBadge(lifecycle: string) {
  const map: Record<string, { label: string; className: string }> = {
    DRAFT: {
      label: "پیش‌نویس",
      className:
        "bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-300",
    },
    REVIEW: {
      label: "بازبینی",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    },
    ACTIVE: {
      label: "فعال",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    ARCHIVED: {
      label: "بایگانی",
      className: "bg-muted text-muted-foreground",
    },
  };
  if (!lifecycle) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const info = map[lifecycle] || { label: lifecycle, className: "" };
  return <Badge variant="secondary" className={info.className}>{info.label}</Badge>;
}

function getRuleStatusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    DRAFT: {
      label: "پیش‌نویس",
      className:
        "bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-300",
    },
    REVIEW: {
      label: "بازبینی",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    },
    ACTIVE: {
      label: "فعال",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    ARCHIVED: {
      label: "بایگانی",
      className: "bg-muted text-muted-foreground",
    },
    REJECTED: {
      label: "ردشده",
      className:
        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
    PENDING_LLM: {
      label: "در انتظار LLM",
      className:
        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    },
  };
  if (!status) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const info = map[status] || { label: status, className: "" };
  return <Badge variant="secondary" className={info.className}>{info.label}</Badge>;
}

function getRuleActionBadge(action: string) {
  const map: Record<string, { label: string; className: string }> = {
    BLOCK_EXTERNAL: {
      label: "مسدودسازی",
      className:
        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
    MASK: {
      label: "ماسک",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    },
    FLAG_REVIEW: {
      label: "برای بازبینی",
      className:
        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    },
  };
  if (!action) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const info = map[action] || { label: action, className: "" };
  return <Badge variant="secondary" className={info.className}>{info.label}</Badge>;
}

function getDetectionDecisionBadge(decision: string) {
  const map: Record<string, { label: string; className: string }> = {
    SAFE: {
      label: "ایمن",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    SENSITIVE: {
      label: "حساس",
      className:
        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
    UNCERTAIN: {
      label: "مبهم (fail-closed)",
      className:
        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    },
  };
  const info = map[decision] || { label: decision, className: "" };
  return <Badge variant="secondary" className={info.className}>{info.label}</Badge>;
}

function getSourceTypeBadge(sourceType: string) {
  return (
    <Badge variant="outline" className="font-mono text-[10px] px-1.5">
      {sourceType}
    </Badge>
  );
}

function getDetectorTypeBadge(detectorType: string, checksumKind?: string | null) {
  return (
    <Badge
      variant="outline"
      className="font-mono text-[10px] px-1.5"
      title={
        detectorType === "CHECKSUM" && checksumKind
          ? `checksum: ${checksumKind}`
          : undefined
      }
    >
      {detectorType}
    </Badge>
  );
}

function translateLlmReason(reason?: LlmStatus["reason"]): string {
  switch (reason) {
    case "UNREACHABLE":
      return "در دسترس نیست";
    case "MODEL_NOT_FOUND":
      return "مدل یافت نشد";
    case "UNKNOWN":
      return "نامشخص";
    case "DISABLED_BY_ENV":
    default:
      return "غیرفعال (پیش‌فرض)";
  }
}

const MASK_KIND_LABELS: Record<MaskDictEntry["kind"], string> = {
  SENIOR_OFFICER: "مدیران ارشد",
  TELCO_HUB_NODE: "مراکز سوئیچ و هاب",
  PROPRIETARY_SERVICE: "سرویس‌های انحصاری",
};

const MASK_KIND_CLASSES: Record<MaskDictEntry["kind"], string> = {
  SENIOR_OFFICER:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  TELCO_HUB_NODE:
    "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  PROPRIETARY_SERVICE:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

// ─── Inline Toast ───────────────────────────────────────────────────────

function ToastMessage({
  message,
  type,
  onDismiss,
}: {
  message: string;
  type: "error" | "success";
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 animate-in slide-in-from-bottom-4">
      <Alert
        variant={type === "error" ? "destructive" : "default"}
        className={
          type === "success"
            ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/50 dark:text-green-300"
            : ""
        }
      >
        {type === "error" ? (
          <AlertCircle className="size-4" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        <AlertDescription className="flex items-center gap-2 text-sm">
          <span>{message}</span>
          <button onClick={onDismiss} className="opacity-70 hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </AlertDescription>
      </Alert>
    </div>
  );
}

// ─── Spinner ────────────────────────────────────────────────────────────

function Spinner({ className }: { className?: string }) {
  return <Loader2 className={`size-4 animate-spin ${className ?? ""}`} />;
}

// ─── Admin Header ───────────────────────────────────────────────────────

function AdminHeader() {
  const { setView, logout } = useAuthStore();

  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <ShieldCheck className="size-[1.15rem]" />
            <span className="absolute -bottom-0.5 -left-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500" />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold tracking-tight">
              Demora AI Hub
            </h1>
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              پنل مدیریت
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => setView("chat")}
            title="بازگشت به گفت‌وگو"
          >
            <ArrowRight className="size-4" />
            <span className="hidden sm:inline">بازگشت به گفت‌وگو</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={logout}
            title="خروج از حساب"
          >
            <LogOut className="size-4" />
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 1: Policy Documents
// ═══════════════════════════════════════════════════════════════════════════

// ─── Local LLM Status Chip ──────────────────────────────────────────────

function LlmStatusChip() {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch("/api/admin/policy/llm-status");
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      // Status chip is informational — never surface an error toast.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Server className="size-3.5" />
        مدل محلی:
      </span>
      {!status ? (
        <Badge
          variant="outline"
          className="gap-1 bg-muted text-muted-foreground"
        >
          {loading ? "در حال بررسی…" : "نامشخص"}
        </Badge>
      ) : status.enabled && status.available ? (
        <Badge
          variant="secondary"
          className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
        >
          <Cpu className="size-3" />
          فعال{status.model ? ` — ${status.model}` : ""}
        </Badge>
      ) : status.enabled ? (
        <Badge
          variant="secondary"
          className="gap-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
        >
          <AlertCircle className="size-3" />
          {translateLlmReason(status.reason)}
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="gap-1 bg-muted text-muted-foreground"
        >
          <Cpu className="size-3" />
          غیرفعال (پیش‌فرض)
        </Badge>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-6 text-muted-foreground"
        onClick={fetchStatus}
        disabled={loading}
        title="بررسی مجدد وضعیت مدل محلی"
      >
        <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}

function PolicyDocsTab() {
  const [docs, setDocs] = useState<PolicyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await authFetch("/api/admin/policy");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در دریافت اسناد");
      }
      const data = await res.json();
      setDocs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // Auto-refresh processing docs every 3s
  useEffect(() => {
    const hasProcessing = docs.some(
      (d) => d.status === "PENDING" || d.status === "PROCESSING"
    );
    if (!hasProcessing) return;
    const interval = setInterval(fetchDocs, 3000);
    return () => clearInterval(interval);
  }, [docs, fetchDocs]);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError(null);
      const formData = new FormData();
      formData.append("file", file);
      const res = await authFetch("/api/admin/policy", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در آپلود");
      }
      setSuccess("سند با موفقیت آپلود شد");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setUploading(false);
    }
  }

  async function handleActivate(id: string) {
    try {
      setError(null);
      setTransitioningId(id);
      const res = await authFetch(`/api/admin/policy/${id}/activate`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در فعال‌سازی");
      }
      const data = await res.json();
      setSuccess(
        `سند فعال شد — ${data.compiledRules} قاعده کامپایل شد`
      );
      await fetchDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setTransitioningId(null);
    }
  }

  async function handleSetLifecycle(
    id: string,
    lifecycle: Exclude<DocLifecycle, "ACTIVE">
  ) {
    try {
      setError(null);
      setTransitioningId(id);
      const res = await authFetch(`/api/admin/policy/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در تغییر وضعیت سند");
      }
      setSuccess(
        lifecycle === "REVIEW"
          ? "سند به بازبینی ارسال شد"
          : lifecycle === "DRAFT"
            ? "سند به پیش‌نویس بازگشت"
            : "سند بایگانی شد"
      );
      await fetchDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setTransitioningId(null);
    }
  }

  function toggleExpand(id: string) {
    setExpandedDocId((prev) => (prev === id ? null : id));
  }

  async function handleDelete(id: string) {
    try {
      setError(null);
      const res = await authFetch(`/api/admin/policy/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در حذف");
      }
      setSuccess("سند حذف شد");
      setExpandedDocId((prev) => (prev === id ? null : prev));
      await fetchDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    }
  }

  async function handleReprocess(id: string) {
    try {
      setError(null);
      setTransitioningId(id);
      const res = await authFetch(`/api/admin/policy/${id}/reprocess`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در پردازش مجدد");
      }
      const data = await res.json();
      setSuccess(
        `پردازش مجدد آغاز شد — ${data.deletedRules ?? 0} قاعده قدیمی حذف و سند با جدیدترین پایپ‌لاین دوباره استخراج می‌شود`
      );
      await fetchDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setTransitioningId(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <ToastMessage
          message={error}
          type="error"
          onDismiss={() => setError(null)}
        />
      )}
      {success && (
        <ToastMessage
          message={success}
          type="success"
          onDismiss={() => setSuccess(null)}
        />
      )}

      {/* Local LLM availability */}
      <LlmStatusChip />

      {/* Upload Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="size-4" />
            آپلود سند سیاست
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="pdf-upload" className="mb-1.5 block text-sm">
                فایل سند سیاست
              </Label>
              <Input
                id="pdf-upload"
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md"
                className="dark:file:text-foreground"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                PDF، TXT یا Markdown (حداکثر 10 مگابایت)
              </p>
            </div>
            <Button
              onClick={handleUpload}
              disabled={uploading}
              className="gap-2"
            >
              {uploading ? <Spinner /> : <Upload className="size-4" />}
              آپلود
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Documents Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" />
            لیست اسناد
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : docs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <FileText className="mx-auto mb-3 size-10 opacity-30" />
              <p className="text-sm">هنوز سندی آپلود نشده است</p>
            </div>
          ) : (
            <ScrollArea className="-mx-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>نام فایل</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      حجم
                    </TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead>چرخه عمر</TableHead>
                    <TableHead className="hidden md:table-cell">
                      نسخه
                    </TableHead>
                    <TableHead>فعال</TableHead>
                    <TableHead className="hidden lg:table-cell">
                      تاریخ آپلود
                    </TableHead>
                    <TableHead>عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map((doc) => (
                    <Fragment key={doc.id}>
                      <TableRow className="align-top">
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-2">
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                            <span className="max-w-[180px] truncate">
                              {doc.filename}
                            </span>
                            {getSourceTypeBadge(doc.sourceType)}
                          </div>
                          {doc.status === "FAILED" && doc.errorMessage && (
                            <p className="mt-1 text-xs text-red-500 dark:text-red-400">
                              {doc.errorMessage}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {formatFileSize(doc.size)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {getStatusBadge(doc.status)}
                            {(doc.status === "PENDING" ||
                              doc.status === "PROCESSING") && (
                              <Spinner className="size-3" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {getLifecycleBadge(doc.lifecycle)}
                            {doc.hasCompiledRules && (
                              <Badge
                                variant="outline"
                                className="font-mono text-[10px] px-1.5 text-muted-foreground"
                              >
                                کامپایل‌شده
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          v{doc.version}
                        </TableCell>
                        <TableCell>
                          {doc.isActive ? (
                            <CheckCircle2 className="size-4 text-green-500" />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {formatDate(doc.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-xs"
                              onClick={() => toggleExpand(doc.id)}
                              title="جزئیات سند، تکه‌ها و قواعد"
                            >
                              {expandedDocId === doc.id ? (
                                <ChevronUp className="size-3" />
                              ) : (
                                <ChevronDown className="size-3" />
                              )}
                              جزئیات
                            </Button>
                            {doc.status === "READY" &&
                              doc.lifecycle === "DRAFT" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1 text-xs"
                                  disabled={transitioningId === doc.id}
                                  onClick={() =>
                                    handleSetLifecycle(doc.id, "REVIEW")
                                  }
                                >
                                  {transitioningId === doc.id ? (
                                    <Spinner className="size-3" />
                                  ) : (
                                    <Send className="size-3" />
                                  )}
                                  ارسال به بازبینی
                                </Button>
                              )}
                            {doc.lifecycle === "REVIEW" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 text-xs text-muted-foreground"
                                  disabled={transitioningId === doc.id}
                                  onClick={() =>
                                    handleSetLifecycle(doc.id, "DRAFT")
                                  }
                                >
                                  <Undo2 className="size-3" />
                                  بازگشت به پیش‌نویس
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      size="sm"
                                      className="h-7 gap-1 text-xs"
                                      disabled={transitioningId === doc.id}
                                    >
                                      {transitioningId === doc.id ? (
                                        <Spinner className="size-3" />
                                      ) : (
                                        <CheckCircle2 className="size-3" />
                                      )}
                                      فعال‌سازی
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>
                                        فعال‌سازی سند
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                        با فعال‌سازی، سند فعال قبلی بایگانی
                                        می‌شود و قواعد این سند کامپایل و وارد
                                        موتور سیاست می‌شوند. ادامه می‌دهید؟
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>انصراف</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => handleActivate(doc.id)}
                                      >
                                        فعال‌سازی
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </>
                            )}
                            {doc.lifecycle === "ACTIVE" && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1 text-xs"
                                    disabled={transitioningId === doc.id}
                                  >
                                    {transitioningId === doc.id ? (
                                      <Spinner className="size-3" />
                                    ) : (
                                      <Archive className="size-3" />
                                    )}
                                    بایگانی
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      بایگانی سند
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      آیا از بایگانی سند «{doc.filename}»
                                      مطمئن هستید؟ سند از چرخه فعال خارج
                                      می‌شود.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>انصراف</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() =>
                                        handleSetLifecycle(doc.id, "ARCHIVED")
                                      }
                                    >
                                      بایگانی
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                            {doc.status === "READY" && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 gap-1 text-xs text-muted-foreground"
                                    disabled={transitioningId === doc.id}
                                    title="استخراج مجدد متن و قواعد با جدیدترین پایپ‌لاین (تعمیر متن فارسی + قواعد ساختارآگوی + مدل محلی)"
                                  >
                                    {transitioningId === doc.id ? (
                                      <Spinner className="size-3" />
                                    ) : (
                                      <RotateCcw className="size-3" />
                                    )}
                                    پردازش مجدد
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      پردازش مجدد سند
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      متن و قواعد «{doc.filename}» با
                                      جدیدترین پایپ‌لاین (تعمیر متن فارسی،
                                      استخراج قواعد بر اساس سرصفحه‌های
                                      «قاعده»، مدل محلی) از نو استخراج
                                      می‌شوند. تکه‌ها و قواعد خودکار فعلیِ
                                      این سند حذف و بازسازی می‌شوند؛ سند به
                                      وضعیت پیش‌نویس بازمی‌گردد تا پس از
                                      بازبینی دوباره فعال شود.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>
                                      انصراف
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleReprocess(doc.id)}
                                    >
                                      پردازش مجدد
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="size-3" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    حذف سند
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    آیا از حذف سند «{doc.filename}» مطمئن هستید؟
                                    این عمل غیرقابل بازگشت است.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>
                                    انصراف
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() => handleDelete(doc.id)}
                                  >
                                    حذف
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedDocId === doc.id && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={8} className="bg-muted/20 p-0">
                            <div className="border-b border-border/60 p-4">
                              <DocumentDetail
                                docId={doc.id}
                                onChanged={fetchDocs}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Expandable Document Detail (chunks + rule provenance review) ───────

function DocumentDetail({
  docId,
  onChanged,
}: {
  docId: string;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<PolicyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await authFetch(`/api/admin/policy/${docId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در دریافت جزئیات سند");
      }
      setDetail(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  async function handleReviewRule(ruleId: string, action: "ACCEPT" | "REJECT") {
    try {
      setBusyRuleId(ruleId);
      setError(null);
      const res = await authFetch(`/api/admin/rules/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewAction: action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در بررسی قاعده");
      }
      await fetchDetail();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setBusyRuleId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-3 py-2">
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1 text-xs"
              onClick={fetchDetail}
            >
              <RefreshCw className="size-3" />
              تلاش مجدد
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!detail) return null;

  const docInfo = detail.document;

  return (
    <div className="space-y-4">
      {/* Document summary */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{docInfo.filename}</span>
        {getSourceTypeBadge(docInfo.sourceType)}
        {getLifecycleBadge(docInfo.lifecycle)}
        <span>نسخه v{docInfo.version}</span>
        {docInfo.extractedCharCount != null && (
          <span>
            {docInfo.extractedCharCount.toLocaleString("fa-IR")} کاراکتر
            استخراج‌شده
          </span>
        )}
        {docInfo.reviewedAt && (
          <span>بازبینی: {formatDate(docInfo.reviewedAt)}</span>
        )}
        {docInfo.activatedAt && (
          <span>فعال‌سازی: {formatDate(docInfo.activatedAt)}</span>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Chunks */}
      <div>
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <FileText className="size-3.5 text-muted-foreground" />
          تکه‌های سند ({detail.chunks.length})
        </h4>
        {detail.chunks.length === 0 ? (
          <p className="rounded-md border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            تکه‌ای برای این سند ثبت نشده است
          </p>
        ) : (
          <ScrollArea className="max-h-[360px] rounded-md border">
            <div className="divide-y">
              {detail.chunks.map((chunk) => (
                <div key={chunk.id} className="space-y-1.5 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium">
                      تکه #{chunk.index + 1}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {chunk.pageIndex != null
                        ? `صفحهٔ ${chunk.pageIndex}`
                        : "—"}
                    </span>
                    {chunk.isCandidate && (
                      <Badge
                        variant="secondary"
                        className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      >
                        کاندید قاعده
                      </Badge>
                    )}
                    {chunk.isRestricted && (
                      <Badge
                        variant="secondary"
                        className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      >
                        محدود
                      </Badge>
                    )}
                    {chunk.textHash && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {chunk.textHash.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <p
                    className="line-clamp-2 text-xs leading-relaxed text-muted-foreground"
                    title={chunk.content}
                  >
                    {chunk.content}
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Rules with provenance + review actions */}
      <div>
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="size-3.5 text-muted-foreground" />
          قواعد استخراج‌شده ({detail.rules.length})
        </h4>
        {detail.rules.length === 0 ? (
          <p className="rounded-md border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            قاعده‌ای برای این سند استخراج نشده است
          </p>
        ) : (
          <ScrollArea className="max-h-[420px] rounded-md border">
            <div className="divide-y">
              {detail.rules.map((rule) => (
                <div key={rule.id} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-medium">
                      {rule.code}
                    </span>
                    <span className="text-sm font-medium">{rule.title}</span>
                    {getRuleStatusBadge(rule.status)}
                    {getSeverityBadge(rule.severity)}
                    {getDetectorTypeBadge(rule.detectorType, rule.checksumKind)}
                    {getRuleActionBadge(rule.action)}
                    <span className="text-xs text-muted-foreground">
                      اولویت: {rule.priority}
                    </span>
                    {rule.sourcePage != null && (
                      <span className="text-xs text-muted-foreground">
                        ص {rule.sourcePage}
                      </span>
                    )}
                    {rule.conflictGroup && (
                      <Badge
                        variant="secondary"
                        className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      >
                        تعارض
                      </Badge>
                    )}
                  </div>
                  {rule.category && (
                    <p className="text-xs text-muted-foreground">
                      دسته‌بندی: {rule.category}
                    </p>
                  )}
                  {rule.reviewNote && (
                    <p className="text-xs text-muted-foreground">
                      یادداشت بازبینی: {rule.reviewNote}
                    </p>
                  )}
                  {rule.sourceQuote && (
                    <div className="rounded-md border bg-muted/40 p-2">
                      <p className="mb-1 text-[11px] text-muted-foreground">
                        متن مبدأ:
                      </p>
                      <p className="text-xs leading-relaxed">
                        «{rule.sourceQuote}»
                      </p>
                    </div>
                  )}
                  {(rule.status === "DRAFT" ||
                    rule.status === "PENDING_LLM") && (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 gap-1 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                        disabled={busyRuleId === rule.id}
                        onClick={() => handleReviewRule(rule.id, "ACCEPT")}
                      >
                        {busyRuleId === rule.id ? (
                          <Spinner className="size-3" />
                        ) : (
                          <CheckCircle2 className="size-3" />
                        )}
                        تأیید
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 border-red-300 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
                        disabled={busyRuleId === rule.id}
                        onClick={() => handleReviewRule(rule.id, "REJECT")}
                      >
                        <X className="size-3" />
                        رد
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Tab 2: Rules Editor
// ═══════════════════════════════════════════════════════════════════════

interface RuleFormData {
  code: string;
  title: string;
  body: string;
  keywords: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category: string;
}

const emptyRuleForm: RuleFormData = {
  code: "",
  title: "",
  body: "",
  keywords: "",
  severity: "MEDIUM",
  category: "",
};

function RulesEditorTab() {
  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PolicyRule | null>(null);
  const [form, setForm] = useState<RuleFormData>(emptyRuleForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await authFetch("/api/admin/rules");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در دریافت قواعد");
      }
      const data = await res.json();
      setRules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  function openAddDialog() {
    setEditingRule(null);
    setForm(emptyRuleForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEditDialog(rule: PolicyRule) {
    setEditingRule(rule);
    setForm({
      code: rule.code,
      title: rule.title,
      body: rule.body ?? "",
      keywords: rule.keywords.join("، "),
      severity: rule.severity,
      category: rule.category ?? "",
    });
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSaveRule() {
    if (!form.code.trim() || !form.title.trim()) {
      setFormError("کد و عنوان قاعده الزامی است");
      return;
    }
    const keywordsArray = form.keywords
      .split(/[،,]/)
      .map((k) => k.trim())
      .filter(Boolean);
    if (keywordsArray.length === 0) {
      setFormError("حداقل یک کلیدواژه وارد کنید");
      return;
    }

    try {
      setSaving(true);
      setFormError(null);
      const body = {
        code: form.code.trim(),
        title: form.title.trim(),
        body: form.body.trim() || undefined,
        keywords: keywordsArray,
        severity: form.severity,
        category: form.category.trim() || undefined,
      };

      let res: Response;
      if (editingRule) {
        res = await authFetch(`/api/admin/rules/${editingRule.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await authFetch("/api/admin/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در ذخیره قاعده");
      }

      setSuccess(editingRule ? "قاعده بروزرسانی شد" : "قاعده جدید ایجاد شد");
      setDialogOpen(false);
      await fetchRules();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(rule: PolicyRule) {
    try {
      setError(null);
      const res = await authFetch(`/api/admin/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در تغییر وضعیت");
      }
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    }
  }

  async function handleDeleteRule(id: string) {
    try {
      setError(null);
      const res = await authFetch(`/api/admin/rules/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در حذف قاعده");
      }
      setSuccess("قاعده حذف شد");
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <ToastMessage
          message={error}
          type="error"
          onDismiss={() => setError(null)}
        />
      )}
      {success && (
        <ToastMessage
          message={success}
          type="success"
          onDismiss={() => setSuccess(null)}
        />
      )}

      {/* Header + Add button */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">قواعد سیاست امنیتی</h3>
        <Button onClick={openAddDialog} size="sm" className="gap-1.5">
          <Plus className="size-4" />
          افزودن قاعده
        </Button>
      </div>

      {/* Rules Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rules.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <ShieldCheck className="mx-auto mb-3 size-10 opacity-30" />
              <p className="text-sm">هنوز قاعده‌ای ایجاد نشده است</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>کد</TableHead>
                    <TableHead>عنوان</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      شدت
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      دسته‌بندی
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">
                      کلیدواژه‌ها
                    </TableHead>
                    <TableHead>فعال</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      نوع
                    </TableHead>
                    <TableHead>عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-mono text-xs">
                        {rule.code}
                      </TableCell>
                      <TableCell className="font-medium max-w-[200px]">
                        {truncate(rule.title, 30)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {getSeverityBadge(rule.severity)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {rule.category || "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {rule.keywords.slice(0, 3).map((kw) => (
                            <Badge
                              key={kw}
                              variant="outline"
                              className="text-[10px] px-1.5 py-0"
                            >
                              {truncate(kw, 12)}
                            </Badge>
                          ))}
                          {rule.keywords.length > 3 && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0"
                            >
                              +{rule.keywords.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={rule.isActive}
                          onCheckedChange={() => handleToggleActive(rule)}
                        />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {rule.isManual ? (
                          <Badge
                            variant="secondary"
                            className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                          >
                            دستی
                          </Badge>
                        ) : (
                          <Badge variant="outline">خودکار</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-xs"
                            onClick={() => openEditDialog(rule)}
                          >
                            <Pencil className="size-3" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  حذف قاعده
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  آیا از حذف قاعده «{rule.title}» مطمئن
                                  هستید؟ این عمل غیرقابل بازگشت است.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>
                                  انصراف
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => handleDeleteRule(rule.id)}
                                >
                                  حذف
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Rule Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? "ویرایش قاعده" : "افزودن قاعده جدید"}
            </DialogTitle>
            <DialogDescription>
              {editingRule
                ? "تغییرات قاعده را ویرایش کنید"
                : "اطلاعات قاعده جدید را وارد کنید"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {formError && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-2">
              <Label htmlFor="rule-code">کد قاعده *</Label>
              <Input
                id="rule-code"
                placeholder="مثلاً: R-001"
                value={form.code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, code: e.target.value }))
                }
                disabled={!!editingRule}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="rule-title">عنوان *</Label>
              <Input
                id="rule-title"
                placeholder="عنوان قاعده"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="rule-body">توضیحات</Label>
              <Textarea
                id="rule-body"
                placeholder="توضیحات قاعده (اختیاری)"
                value={form.body}
                onChange={(e) =>
                  setForm((f) => ({ ...f, body: e.target.value }))
                }
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="rule-keywords">کلیدواژه‌ها * (با کاما جدا کنید)</Label>
              <Input
                id="rule-keywords"
                placeholder="کلمه اول، کلمه دوم، کلمه سوم"
                value={form.keywords}
                onChange={(e) =>
                  setForm((f) => ({ ...f, keywords: e.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>سطح شدت</Label>
                <Select
                  value={form.severity}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      severity: v as RuleFormData["severity"],
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">پایین (LOW)</SelectItem>
                    <SelectItem value="MEDIUM">متوسط (MEDIUM)</SelectItem>
                    <SelectItem value="HIGH">بالا (HIGH)</SelectItem>
                    <SelectItem value="CRITICAL">
                      بحرانی (CRITICAL)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="rule-category">دسته‌بندی</Label>
                <Input
                  id="rule-category"
                  placeholder="مثلاً: امنیت"
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              انصراف
            </Button>
            <Button onClick={handleSaveRule} disabled={saving} className="gap-2">
              {saving && <Spinner />}
              {editingRule ? "بروزرسانی" : "ایجاد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 3: Decision Logs
// ═══════════════════════════════════════════════════════════════════════════

function DecisionLogsTab() {
  const [logs, setLogs] = useState<DecisionLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [routeFilter, setRouteFilter] = useState<string>("ALL");
  const [riskFilter, setRiskFilter] = useState<string>("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (actionFilter !== "ALL") params.set("action", actionFilter);
      if (routeFilter !== "ALL") params.set("route", routeFilter);
      if (riskFilter !== "ALL") params.set("risk", riskFilter);
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);

      const res = await authFetch(`/api/admin/logs?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در دریافت لاگ‌ها");
      }
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, routeFilter, riskFilter, fromDate, toDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [actionFilter, routeFilter, riskFilter, fromDate, toDate]);

  const totalPages = Math.ceil(total / pageSize);

  function getPageNumbers(): (number | "...")[] {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("...");
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  }

  function clearFilters() {
    setActionFilter("ALL");
    setRouteFilter("ALL");
    setRiskFilter("ALL");
    setFromDate("");
    setToDate("");
  }

  return (
    <div className="space-y-6">
      {error && (
        <ToastMessage
          message={error}
          type="error"
          onDismiss={() => setError(null)}
        />
      )}

      {/* Filter Bar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex items-center gap-2">
              <Filter className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">فیلتر:</span>
            </div>
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  نوع تصمیم
                </Label>
                <Select
                  value={actionFilter}
                  onValueChange={setActionFilter}
                >
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">همه</SelectItem>
                    <SelectItem value="ALLOW">مجاز</SelectItem>
                    <SelectItem value="BLOCK">مسدود</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  مسیر
                </Label>
                <Select
                  value={routeFilter}
                  onValueChange={setRouteFilter}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">همه</SelectItem>
                    <SelectItem value="EXTERNAL">خارجی</SelectItem>
                    <SelectItem value="LOCAL">محلی</SelectItem>
                    <SelectItem value="BLOCKED">متوقف</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  سطح ریسک
                </Label>
                <Select
                  value={riskFilter}
                  onValueChange={setRiskFilter}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">همه</SelectItem>
                    <SelectItem value="critical">بحرانی</SelectItem>
                    <SelectItem value="high">بالا</SelectItem>
                    <SelectItem value="medium">متوسط</SelectItem>
                    <SelectItem value="low">پایین</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  از تاریخ
                </Label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-[160px]"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  تا تاریخ
                </Label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-[160px]"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="gap-1.5 text-xs"
              >
                <X className="size-3" />
                پاک‌سازی
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Search className="mx-auto mb-3 size-10 opacity-30" />
              <p className="text-sm">
                {total === 0
                  ? "هنوز لاگی ثبت نشده است"
                  : "نتیجه‌ای یافت نشد"}
              </p>
            </div>
          ) : (
            <ScrollArea className="max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden sm:table-cell">
                      تاریخ/ساعت
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      کاربر
                    </TableHead>
                    <TableHead>تصمیم</TableHead>
                    <TableHead>مسیر</TableHead>
                    <TableHead className="hidden md:table-cell">
                      ماسک/ریسک
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      امتیاز
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">
                      دلایل
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">
                      پیش‌نمایش پرامپت
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      تأخیر
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="hidden sm:table-cell text-muted-foreground text-xs">
                        {formatDate(log.createdAt)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        {log.userEmail || "—"}
                      </TableCell>
                      <TableCell>
                        {log.action === "ALLOW" ? (
                          <Badge
                            variant="secondary"
                            className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          >
                            مجاز
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          >
                            مسدود
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{getRouteBadge(log.route)}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-col items-start gap-1">
                          {getRiskBadge(log.classifierRisk)}
                          {log.classifierCategory && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 font-normal border-border/80"
                            >
                              {log.classifierCategory}
                            </Badge>
                          )}
                          {Boolean(log.maskCount) && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                              <EyeOff className="size-3" />
                              {log.maskCount} مورد ماسک
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell font-mono text-xs">
                        {log.score.toFixed(2)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell max-w-[200px]">
                        {log.reasons.length > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {truncate(log.reasons.join(" | "), 40)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell max-w-[150px] text-xs text-muted-foreground">
                        {truncate(log.promptPreview, 25)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {log.latencyMs}ms
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-xs text-muted-foreground">
              نمایش {((page - 1) * pageSize) + 1} تا {Math.min(page * pageSize, total)} از {total} مورد
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
              {getPageNumbers().map((p, i) =>
                p === "..." ? (
                  <span key={`dots-${i}`} className="px-1 text-muted-foreground">
                    …
                  </span>
                ) : (
                  <Button
                    key={p}
                    variant={page === p ? "default" : "outline"}
                    size="icon"
                    className="size-8"
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </Button>
                )
              )}
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 4: Policy Tester
// ═══════════════════════════════════════════════════════════════════════════

function PolicyTesterTab() {
  const [prompt, setPrompt] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<PolicyTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleTest() {
    if (!prompt.trim()) return;
    try {
      setTesting(true);
      setError(null);
      setResult(null);
      const res = await authFetch("/api/admin/policy/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در آزمایش");
      }
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="size-4" />
            آزمایش سیاست امنیتی
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="test-prompt">متن آزمایشی</Label>
            <Textarea
              id="test-prompt"
              placeholder="یک پرامپت آزمایشی وارد کنید..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
            />
          </div>
          <Button
            onClick={handleTest}
            disabled={testing || !prompt.trim()}
            className="gap-2"
          >
            {testing ? <Spinner /> : <FlaskConical className="size-4" />}
            آزمایش
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Final route */}
          <Card
            className={
              result.route === "EXTERNAL" || result.route === "EXTERNAL_DIRECT"
                ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                : result.route === "EXTERNAL_MASKED"
                  ? "border-sky-200 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20"
                  : result.route === "LOCAL"
                    ? "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
                    : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20"
            }
          >
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                {result.route === "EXTERNAL" || result.route === "EXTERNAL_DIRECT" ? (
                  <>
                    <Globe className="size-8 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                        مسیر: مدل خارجی (مستقیم)
                      </p>
                      <p className="text-sm text-emerald-600/80 dark:text-emerald-500/80">
                        پرامپت عمومی و ایمن ارزیابی شد — بدون داده حساس سازمانی به سرویس بیرونی ارسال می‌شود
                      </p>
                    </div>
                  </>
                ) : result.route === "EXTERNAL_MASKED" ? (
                  <>
                    <ShieldCheck className="size-8 text-sky-600 dark:text-sky-400" />
                    <div>
                      <p className="text-lg font-bold text-sky-700 dark:text-sky-400">
                        مسیر: مدل خارجی (ماسک‌شده)
                      </p>
                      <p className="text-sm text-sky-600/80 dark:text-sky-500/80">
                        طبق سیاست سازمان، پس از ماسک‌گذاری کامل هویت‌ها و داده‌های حساس، نسخهٔ امن به سرویس بیرونی ارسال می‌شود
                      </p>
                    </div>
                  </>
                ) : result.route === "LOCAL" ? (
                  <>
                    <Server className="size-8 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="text-lg font-bold text-amber-700 dark:text-amber-400">
                        مسیر: مدل محلی / امن داخل سازمان
                      </p>
                      <p className="text-sm text-amber-600/80 dark:text-amber-500/80">
                        داده حساس سازمانی یا عدم قطعیت در پایپ‌لاین تشخیص — بدون خروج از مرز سازمان (Fail-Closed)
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="size-8 text-red-600 dark:text-red-400" />
                    <div>
                      <p className="text-lg font-bold text-red-700 dark:text-red-400">
                        مسدودسازی امنیتی (BLOCKED)
                      </p>
                      <p className="text-sm text-red-600/80 dark:text-red-500/80">
                        تخلف بحرانی از خطوط قرمز امنیت اطلاعات — درخواست بلافاصله متوقف گردید
                      </p>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Latency breakdown */}
          {result.stageLatencies && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Clock className="size-4" />
                  زمان‌سنجی تفکیکی مراحل پایپ‌لاین تشخیص
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
                  <div className="rounded border bg-muted/30 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">نرمال‌سازی</div>
                    <div className="font-mono font-bold">{result.stageLatencies.normalizationMs}ms</div>
                  </div>
                  <div className="rounded border bg-muted/30 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">تشخیص DLP</div>
                    <div className="font-mono font-bold">{result.stageLatencies.dlpMs}ms</div>
                  </div>
                  <div className="rounded border bg-muted/30 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">بازیابی هیبریدی</div>
                    <div className="font-mono font-bold">{result.stageLatencies.retrievalMs}ms</div>
                  </div>
                  <div className="rounded border bg-muted/30 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">قاضی معنایی</div>
                    <div className="font-mono font-bold">{result.stageLatencies.classifierMs}ms</div>
                  </div>
                  <div className="rounded border bg-muted/30 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">تصمیم و ادغام</div>
                    <div className="font-mono font-bold">{result.stageLatencies.decisionMs}ms</div>
                  </div>
                  <div className="rounded border bg-primary/10 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">مجموع کل</div>
                    <div className="font-mono font-bold text-primary">{result.stageLatencies.totalMs}ms</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pipeline layer 1: Sanitizer */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <EyeOff className="size-4" />
                لایه ۱ — ماسک‌گذاری (Sanitizer)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.sanitize.maskCount === 0 ? (
                <p className="text-sm text-muted-foreground">
                  موردی برای ماسک‌گذاری یافت نشد
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {result.sanitize.findings.map((f) => (
                    <Badge
                      key={f.label}
                      variant="secondary"
                      className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    >
                      {f.labelFa} ×{f.count}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-1 text-[11px] text-muted-foreground">
                  متن ماسک‌شده (همین نسخه به مدل بیرونی ارسال می‌شود):
                </p>
                <p
                  className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed"
                  dir="rtl"
                >
                  {result.sanitize.maskedText}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Pipeline layer 2: Deterministic sensitive-data detection */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ScanSearch className="size-4" />
                لایه ۲ — تشخیص قطعی و الگوهای DLP
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {result.deterministicHits && result.deterministicHits.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {result.deterministicHits.map((h, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
                    >
                      {h.categoryFa}: {h.matchedSpan.text} (اطمینان {Math.round(h.confidence * 100)}٪)
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  هیچ تخلف یا دیتکتور قطعی (کارت بانکی، کد ملی، کلید خصوصی، regex) کشف نشد.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Pipeline layer 3: Hybrid Concept Retrieval */}
          {result.retrieval && result.retrieval.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Cpu className="size-4" />
                  لایه ۳ — مفاهیم مرتبط بازیابی‌شده (Hybrid Retrieval)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="space-y-1.5">
                  {result.retrieval.map((c, i) => (
                    <div
                      key={i}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border bg-muted/20 p-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{c.name}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {c.conceptKey}
                        </Badge>
                        {c.category && (
                          <Badge variant="outline" className="text-[10px]">
                            {c.category}
                          </Badge>
                        )}
                        <Badge
                          variant="secondary"
                          className={
                            c.sensitivity === "HIGHLY_CONFIDENTIAL"
                              ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                              : c.sensitivity === "CONFIDENTIAL"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                                : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                          }
                        >
                          {c.sensitivity}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {c.action}
                        </Badge>
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {c.denseScore !== undefined && `Dense: ${c.denseScore.toFixed(3)} | `}
                        {c.lexicalScore !== undefined && `BM25: ${c.lexicalScore.toFixed(2)} | `}
                        امتیاز: {c.score.toFixed(3)}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pipeline layer 4: Local LLM Semantic Classifier */}
          {result.classifier && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="size-4" />
                  لایه ۴ — قضاوت معنایی هوش مصنوعی محلی (Semantic Judge)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={
                      result.classifier.decision === "SAFE"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : result.classifier.decision === "SENSITIVE"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                          : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
                    }
                  >
                    تصمیم: {result.classifier.decision}
                  </Badge>
                  {result.classifier.scope && (
                    <Badge variant="outline" className="text-[10px]">
                      دامنه: {result.classifier.scope}
                    </Badge>
                  )}
                  <Badge variant="outline" className="font-mono text-[10px]">
                    اطمینان: {Math.round(result.classifier.confidence * 100)}٪
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    روش: {result.classifier.method}
                  </Badge>
                  {result.classifier.modelUsed && (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      مدل: {result.classifier.modelUsed}
                    </Badge>
                  )}
                </div>
                {result.classifier.reasonFa && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    استدلال: {result.classifier.reasonFa}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <p className="text-center text-xs text-muted-foreground">
            زمان کل پایپ‌لاین: {result.latencyMs}ms · نسخه: {result.pipelineVersion}
          </p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 5: Mask Dictionary (Phase 3)
// ═══════════════════════════════════════════════════════════════════════════

function MaskDictionaryTab() {
  const [entries, setEntries] = useState<MaskDictEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<MaskDictEntry["kind"]>("SENIOR_OFFICER");
  const [newTerm, setNewTerm] = useState("");
  const [adding, setAdding] = useState(false);
  const [kindFilter, setKindFilter] = useState<string>("ALL");

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await authFetch("/api/admin/mask-dictionary");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در دریافت دیکشنری");
      }
      setEntries(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  async function handleAdd() {
    if (!newTerm.trim()) return;
    try {
      setAdding(true);
      setError(null);
      const res = await authFetch("/api/admin/mask-dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: newKind, term: newTerm.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "خطا در افزودن عبارت");
      setEntries((prev) =>
        [...prev, data].sort(
          (a, b) => a.kind.localeCompare(b.kind) || a.term.localeCompare(b.term)
        )
      );
      setNewTerm("");
      setSuccess("عبارت با موفقیت اضافه شد");
      setTimeout(() => setSuccess(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(entry: MaskDictEntry) {
    try {
      setError(null);
      const res = await authFetch(`/api/admin/mask-dictionary/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !entry.isActive }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در تغییر وضعیت");
      }
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, isActive: !e.isActive } : e))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    }
  }

  async function handleDelete(id: string) {
    try {
      setError(null);
      const res = await authFetch(`/api/admin/mask-dictionary/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در حذف عبارت");
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    }
  }

  const filtered =
    kindFilter === "ALL" ? entries : entries.filter((e) => e.kind === kindFilter);

  return (
    <div className="space-y-6">
      {error && (
        <ToastMessage message={error} type="error" onDismiss={() => setError(null)} />
      )}
      {success && (
        <ToastMessage message={success} type="success" onDismiss={() => setSuccess(null)} />
      )}

      <Alert>
        <BookKey className="size-4" />
        <AlertTitle>دیکشنری ماسک‌گذاری</AlertTitle>
        <AlertDescription>
          عبارت‌های این فهرست پیش از ارسال هر پرامپت به مدل، با برچسب امن جایگزین
          می‌شوند (نظیر [SENIOR_OFFICER]). الگوهای قطعی مثل شماره تلفن، کد ملی و IP
          داخلی به‌صورت خودکار ماسک می‌شوند و نیازی به ثبت در این فهرست ندارند.
        </AlertDescription>
      </Alert>

      {/* Add form */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="mask-kind">نوع دیکشنری</Label>
              <Select
                value={newKind}
                onValueChange={(v) => setNewKind(v as MaskDictEntry["kind"])}
              >
                <SelectTrigger id="mask-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MASK_KIND_LABELS) as Array<MaskDictEntry["kind"]>).map(
                    (k) => (
                      <SelectItem key={k} value={k}>
                        {MASK_KIND_LABELS[k]}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid flex-[2] gap-1.5">
              <Label htmlFor="mask-term">عبارت</Label>
              <Input
                id="mask-term"
                placeholder="مثلاً: مرکز تلفن بین‌الملل"
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
              />
            </div>
            <Button
              onClick={handleAdd}
              disabled={adding || newTerm.trim().length < 2}
              className="gap-1.5"
            >
              {adding ? <Spinner /> : <Plus className="size-4" />}
              افزودن
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Kind filter */}
      <div className="flex items-center gap-2">
        <Filter className="size-4 text-muted-foreground" />
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">همهٔ دیکشنری‌ها</SelectItem>
            {(Object.keys(MASK_KIND_LABELS) as Array<MaskDictEntry["kind"]>).map((k) => (
              <SelectItem key={k} value={k}>
                {MASK_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} عبارت</span>
      </div>

      {/* Terms table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <BookKey className="mx-auto mb-3 size-10 opacity-30" />
              <p className="text-sm">هنوز عبارتی در این دیکشنری ثبت نشده است</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[480px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>عبارت</TableHead>
                    <TableHead className="hidden sm:table-cell">دیکشنری</TableHead>
                    <TableHead>فعال</TableHead>
                    <TableHead>عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="max-w-[280px] font-medium">
                        {entry.term}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge
                          variant="secondary"
                          className={MASK_KIND_CLASSES[entry.kind]}
                        >
                          {MASK_KIND_LABELS[entry.kind]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={entry.isActive}
                          onCheckedChange={() => handleToggle(entry)}
                        />
                      </TableCell>
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent dir="rtl">
                            <AlertDialogHeader>
                              <AlertDialogTitle>حذف عبارت</AlertDialogTitle>
                              <AlertDialogDescription>
                                آیا از حذف «{entry.term}» مطمئن هستید؟ این عمل قابل
                                بازگشت نیست.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>انصراف</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(entry.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                حذف
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Policy Concepts Tab (Phase 2: Semantic Governance & Provenance Review)
// ═══════════════════════════════════════════════════════════════════════════

interface ConceptItem {
  id: string;
  conceptKey: string;
  name: string;
  nameFa?: string | null;
  descriptionFa: string;
  category?: string | null;
  sectionTitle?: string | null;
  sensitivity: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "HIGHLY_CONFIDENTIAL";
  action: "ALLOW_EXTERNAL" | "ROUTE_LOCAL" | "MASK_AND_ALLOW_EXTERNAL" | "BLOCK";
  reviewStatus: "DRAFT" | "REVIEW" | "ACTIVE" | "ARCHIVED" | "REJECTED";
  sourceQuote: string;
  sourcePage?: number | null;
  positiveExamples: string[];
  negativeExamples: string[];
  conditions: string[];
  keywords: string[];
  detectorHints?: { regex?: string[]; checksum?: string[]; dictionary?: string[]; flags?: string[] } | null;
  flags?: string[];
  confidence?: number;
  reviewNote?: string | null;
  extractedByModel?: string | null;
  createdAt?: string;
}

function PolicyConceptsTab() {
  const [concepts, setConcepts] = useState<ConceptItem[]>([]);
  const [stats, setStats] = useState({ total: 0, active: 0, review: 0, rejected: 0, archived: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [sortOrder, setSortOrder] = useState<"risk_first" | "newest" | "highest_confidence">("risk_first");
  const [expandedQuotes, setExpandedQuotes] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Concept Rejection Dialog State (spec §2.5)
  const [rejectingConcept, setRejectingConcept] = useState<ConceptItem | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>("ادغام چند قاعده در یک مفهوم");
  const [customRejectionNote, setCustomRejectionNote] = useState<string>("");

  // Concept Edit State (AGENT_TASK §12, §13)
  const [editingConcept, setEditingConcept] = useState<ConceptItem | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    nameFa: string;
    descriptionFa: string;
    category: string;
    sensitivity: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "HIGHLY_CONFIDENTIAL";
    action: "ALLOW_EXTERNAL" | "ROUTE_LOCAL" | "MASK_AND_ALLOW_EXTERNAL" | "BLOCK";
    positiveExamples: string[];
    negativeExamples: string[];
    conditions: string[];
  }>({
    name: "",
    nameFa: "",
    descriptionFa: "",
    category: "",
    sensitivity: "INTERNAL",
    action: "ROUTE_LOCAL",
    positiveExamples: [],
    negativeExamples: [],
    conditions: [],
  });
  const [newPositiveExample, setNewPositiveExample] = useState("");
  const [newNegativeExample, setNewNegativeExample] = useState("");
  const [newCondition, setNewCondition] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const handleOpenEdit = (concept: ConceptItem) => {
    setEditingConcept(concept);
    setEditForm({
      name: concept.name || "",
      nameFa: concept.nameFa || "",
      descriptionFa: concept.descriptionFa || "",
      category: concept.category || "",
      sensitivity: concept.sensitivity,
      action: concept.action,
      positiveExamples: [...(concept.positiveExamples || [])],
      negativeExamples: [...(concept.negativeExamples || [])],
      conditions: [...(concept.conditions || [])],
    });
    setNewPositiveExample("");
    setNewNegativeExample("");
    setNewCondition("");
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingConcept) return;
    if (!editForm.name.trim()) {
      setEditError("نام مفهوم نمی‌تواند خالی باشد.");
      return;
    }
    if (!editForm.descriptionFa.trim()) {
      setEditError("شرح مفهوم نمی‌تواند خالی باشد.");
      return;
    }

    try {
      setSaveLoading(true);
      setEditError(null);
      const res = await authFetch(`/api/admin/concepts/${editingConcept.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          nameFa: editForm.nameFa.trim() || null,
          descriptionFa: editForm.descriptionFa.trim(),
          category: editForm.category.trim() || null,
          sensitivity: editForm.sensitivity,
          action: editForm.action,
          positiveExamples: editForm.positiveExamples,
          negativeExamples: editForm.negativeExamples,
          conditions: editForm.conditions,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "خطا در ذخیره تغییرات مفهوم سیاست");
      }

      setSuccess("تغییرات مفهوم سیاست با موفقیت ذخیره و ایندکس برداری معنایی همگام‌سازی شد.");
      setEditingConcept(null);
      await fetchConcepts();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error("Failed to update concept:", err);
      setEditError(err instanceof Error ? err.message : "خطای ناشناخته در ذخیره مفهوم");
    } finally {
      setSaveLoading(false);
    }
  };

  const fetchConcepts = useCallback(async () => {
    try {
      setLoading(true);
      const url = statusFilter !== "ALL" ? `/api/admin/concepts?reviewStatus=${statusFilter}` : "/api/admin/concepts";
      const res = await authFetch(url);
      if (res.ok) {
        const data = await res.json();
        setConcepts(data.concepts || []);
        if (data.stats) setStats(data.stats);
      }
    } catch (err) {
      console.error("Failed to load concepts:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchConcepts();
  }, [fetchConcepts]);

  const handleReviewAction = async (id: string, reviewAction: "approve" | "reject" | "archive", reviewNote?: string) => {
    try {
      setError(null);
      setActionLoading(id);
      const res = await authFetch(`/api/admin/concepts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewAction, reviewNote }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `خطا در عملیات ${reviewAction}`);
      }
      await fetchConcepts();
    } catch (err) {
      console.error(`Failed to ${reviewAction} concept:`, err);
      setError(err instanceof Error ? err.message : `خطا در اجرای عملیات`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingConcept) return;
    const finalNote =
      rejectionReason === "other"
        ? customRejectionNote.trim()
        : rejectionReason + (customRejectionNote.trim() ? ` — ${customRejectionNote.trim()}` : "");
    await handleReviewAction(rejectingConcept.id, "reject", finalNote || "رد شده توسط ادمین");
    setRejectingConcept(null);
    setCustomRejectionNote("");
  };

  const handleDeleteConcept = async (id: string) => {
    try {
      setError(null);
      setActionLoading(id);
      const res = await authFetch(`/api/admin/concepts/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در حذف مفهوم سیاست");
      }
      setSuccess("مفهوم سیاست با موفقیت به‌صورت کامل و دائمی حذف گردید.");
      // Remove immediately from UI (requirement 6)
      setConcepts((prev) => prev.filter((c) => c.id !== id));
      // Refresh list and statistics from server (requirement 6)
      await fetchConcepts();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error("Failed to delete concept:", err);
      setError(err instanceof Error ? err.message : "خطای ناشناخته در حذف مفهوم سیاست");
    } finally {
      setActionLoading(null);
    }
  };

  const sortedConcepts = useMemo(() => {
    const list = [...concepts];
    if (sortOrder === "risk_first") {
      return list.sort((a, b) => {
        const aFlagsCount = (a.flags?.length || a.detectorHints?.flags?.length || 0);
        const bFlagsCount = (b.flags?.length || b.detectorHints?.flags?.length || 0);
        if (bFlagsCount !== aFlagsCount) return bFlagsCount - aFlagsCount;

        const aConf = a.confidence ?? 0.8;
        const bConf = b.confidence ?? 0.8;
        if (aConf !== bConf) return aConf - bConf;

        const aLen = a.sourceQuote?.length || 0;
        const bLen = b.sourceQuote?.length || 0;
        return bLen - aLen;
      });
    } else if (sortOrder === "highest_confidence") {
      return list.sort((a, b) => (b.confidence ?? 0.8) - (a.confidence ?? 0.8));
    } else {
      return list.sort((a, b) => {
        const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bDate - aDate;
      });
    }
  }, [concepts, sortOrder]);

  const getSensitivityBadge = (s: string, action?: string) => {
    if (action === "ROUTE_LOCAL") {
      return <Badge className="bg-sky-600 hover:bg-sky-700 text-white">حساس</Badge>;
    }
    switch (s) {
      case "HIGHLY_CONFIDENTIAL":
        return <Badge variant="destructive">بسیار محرمانه</Badge>;
      case "CONFIDENTIAL":
        return <Badge className="bg-amber-600 hover:bg-amber-700 text-white">محرمانه</Badge>;
      case "INTERNAL":
        return <Badge variant="secondary">داخلی</Badge>;
      default:
        return <Badge variant="outline">عمومی</Badge>;
    }
  };

  const getActionBadge = (a: string) => {
    switch (a) {
      case "BLOCK":
        return <Badge variant="destructive">مسدودسازی کامل</Badge>;
      case "ROUTE_LOCAL":
        return <Badge className="bg-blue-600 hover:bg-blue-700 text-white">مسیر محلی (LOCAL)</Badge>;
      case "MASK_AND_ALLOW_EXTERNAL":
        return <Badge className="bg-purple-600 hover:bg-purple-700 text-white">ماسک + خروج</Badge>;
      default:
        return <Badge variant="outline">مجاز خارجی</Badge>;
    }
  };

  const getStatusBadge = (st: string) => {
    switch (st) {
      case "ACTIVE":
        return <Badge className="bg-emerald-600 hover:bg-emerald-700">فعال در رانتایم</Badge>;
      case "REVIEW":
        return <Badge variant="secondary" className="border border-amber-500 text-amber-600 dark:text-amber-400">در انتظار بررسی</Badge>;
      case "REJECTED":
        return <Badge variant="destructive">رد شده</Badge>;
      case "ARCHIVED":
        return <Badge variant="outline">آرشیو</Badge>;
      default:
        return <Badge variant="outline">{st}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <ToastMessage message={error} type="error" onDismiss={() => setError(null)} />
      )}
      {success && (
        <ToastMessage message={success} type="success" onDismiss={() => setSuccess(null)} />
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">کل مفاهیم استخراج‌شده</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-amber-600">{stats.review}</div>
            <div className="text-xs text-muted-foreground">در انتظار تأیید ادمین</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-emerald-600">{stats.active}</div>
            <div className="text-xs text-muted-foreground">فعال در رانتایم</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-destructive">{stats.rejected}</div>
            <div className="text-xs text-muted-foreground">رد شده</div>
          </CardContent>
        </Card>
      </div>

      {/* Concept List & Controls */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-medium">مفاهیم معنایی سیاست (Policy Concepts)</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              مفاهیم استخراج‌شده توسط مدل محلی؛ هیچ مفهومی بدون تأیید صریح ادمین فعال نمی‌شود (spec §13).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={sortOrder} onValueChange={(val: any) => setSortOrder(val)}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="ترتیب نمایش" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="risk_first">ریسک / پرچم‌ها</SelectItem>
                <SelectItem value="highest_confidence">بیشترین اطمینان</SelectItem>
                <SelectItem value="newest">جدیدترین</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="فیلتر وضعیت" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">همه وضعیت‌ها</SelectItem>
                <SelectItem value="REVIEW">در انتظار بررسی</SelectItem>
                <SelectItem value="ACTIVE">فعال</SelectItem>
                <SelectItem value="REJECTED">رد شده</SelectItem>
                <SelectItem value="ARCHIVED">آرشیو</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchConcepts} disabled={loading} className="h-8">
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3 py-6">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : concepts.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              هیچ مفهوم سیاستی یافت نشد. اسناد سیاست را آپلود کنید تا مفاهیم به‌صورت ساختارآگاه استخراج شوند.
            </div>
          ) : (
            <div className="space-y-4">
              {sortedConcepts.map((concept) => {
                const isQuoteExpanded = expandedQuotes[concept.id] ?? false;
                const quote = concept.sourceQuote || "";
                const isLongQuote = quote.length > 200;
                const displayQuote = (!isQuoteExpanded && isLongQuote) ? quote.slice(0, 200) + "..." : quote;
                const conceptFlags: string[] = concept.flags || concept.detectorHints?.flags || [];

                return (
                <div
                  key={concept.id}
                  className="rounded-lg border bg-card p-4 text-card-foreground shadow-xs transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{concept.nameFa || concept.name}</span>
                        <code dir="ltr" className="text-xs text-muted-foreground font-mono inline-block" style={{ unicodeBidi: "isolate" }}>
                          ({concept.conceptKey})
                        </code>
                        {concept.sectionTitle && (
                          <Badge variant="outline" className="text-[11px] border-blue-400/50 text-blue-600 dark:text-blue-400 font-normal">
                            بخش: {concept.sectionTitle}
                          </Badge>
                        )}
                        {conceptFlags.includes("LOOKS_TOO_BROAD") && (
                          <Badge className="bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1 text-[10px]">
                            <AlertTriangle className="size-3" />
                            احتمال ادغام چند قاعده
                          </Badge>
                        )}
                        {conceptFlags.includes("SENSITIVITY_ACTION_MISMATCH") && (
                          <Badge className="bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1 text-[10px]">
                            <AlertTriangle className="size-3" />
                            عدم تطابق حساسیت و اقدام
                          </Badge>
                        )}
                      </div>
                      {concept.category && (
                        <span className="text-xs text-muted-foreground mt-1 inline-block">دسته: {concept.category}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {concept.confidence !== undefined && (
                        <Badge variant="secondary" className="text-[10px] font-mono">
                          اطمینان: {Math.round(concept.confidence * 100)}%
                        </Badge>
                      )}
                      {getSensitivityBadge(concept.sensitivity, concept.action)}
                      {getActionBadge(concept.action)}
                      {getStatusBadge(concept.reviewStatus)}
                    </div>
                  </div>

                  <div className="mt-3 space-y-2 text-xs">
                    <p className="text-muted-foreground leading-relaxed">{concept.descriptionFa}</p>

                    {/* Rejection Note (if rejected) */}
                    {concept.reviewStatus === "REJECTED" && concept.reviewNote && (
                      <div className="rounded bg-rose-500/10 border border-rose-500/30 p-2 text-rose-700 dark:text-rose-400 text-xs">
                        <span className="font-semibold">علت رد توسط ادمین: </span>
                        {concept.reviewNote}
                      </div>
                    )}

                    {/* Provenance Quotation */}
                    <div className="rounded border-r-4 border-blue-500 bg-muted/60 p-2 text-xs">
                      <div className="flex items-center justify-between text-muted-foreground mb-1">
                        <span className="font-semibold text-blue-600 dark:text-blue-400">سند و نقل‌قول مبنا (Provenance):</span>
                        {concept.sourcePage && <span>صفحه: {concept.sourcePage}</span>}
                      </div>
                      <blockquote className="italic text-foreground leading-relaxed">
                        «{displayQuote}»
                      </blockquote>
                      {isLongQuote && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-1 h-6 px-2 text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400"
                          onClick={() =>
                            setExpandedQuotes((prev) => ({
                              ...prev,
                              [concept.id]: !isQuoteExpanded,
                            }))
                          }
                        >
                          {isQuoteExpanded ? "نمایش کمتر" : `نمایش کامل نقل‌قول (${quote.length} کاراکتر)`}
                        </Button>
                      )}
                    </div>

                    {/* Examples Preview */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-1">
                      {concept.positiveExamples?.length > 0 && (
                        <div className="rounded bg-destructive/10 p-2 text-destructive">
                          <span className="font-semibold block mb-1">نمونه‌های حساس (Positive):</span>
                          <ul className="list-inside list-disc space-y-0.5">
                            {concept.positiveExamples.slice(0, 2).map((ex, i) => (
                              <li key={i}>{ex}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {concept.negativeExamples?.length > 0 && (
                        <div className="rounded bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-400">
                          <span className="font-semibold block mb-1">نمونه‌های مجاز مشابه (Negative):</span>
                          <ul className="list-inside list-disc space-y-0.5">
                            {concept.negativeExamples.slice(0, 2).map((ex, i) => (
                              <li key={i}>{ex}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionLoading === concept.id}
                      onClick={() => handleOpenEdit(concept)}
                      className="h-7 text-xs"
                    >
                      <Pencil className="mr-1 size-3" />
                      ویرایش
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={actionLoading === concept.id}
                          className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          {actionLoading === concept.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Trash2 className="mr-1 size-3" />
                          )}
                          حذف
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            حذف دائمی مفهوم سیاست
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            آیا از حذف دائمی این مفهوم سیاست اطمینان دارید؟
                            <br />
                            این اقدام غیرقابل بازگشت است. این مفهوم همراه با تمام نمونه‌ها (مثبت و منفی)، منابع و نقل‌قول‌های مبنا (Provenance Sources)، و بردار امبدینگ معنایی مرتبط با آن به‌صورت کامل و دائمی از سامانه حذف خواهند شد.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>انصراف</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteConcept(concept.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            حذف قطعی
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>

                    {concept.reviewStatus !== "ACTIVE" && (
                      <Button
                        size="sm"
                        variant="default"
                        disabled={actionLoading === concept.id}
                        onClick={() => handleReviewAction(concept.id, "approve")}
                        className="h-7 bg-emerald-600 text-xs hover:bg-emerald-700 text-white"
                      >
                        {actionLoading === concept.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-1 size-3" />
                        )}
                        تأیید و فعال‌سازی
                      </Button>
                    )}
                    {concept.reviewStatus !== "REJECTED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionLoading === concept.id}
                        onClick={() => {
                          setRejectingConcept(concept);
                          setRejectionReason("ادغام چند قاعده در یک مفهوم");
                          setCustomRejectionNote("");
                        }}
                        className="h-7 text-xs text-destructive hover:bg-destructive/10"
                      >
                        {actionLoading === concept.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <X className="mr-1 size-3" />
                        )}
                        رد مفهوم
                      </Button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Concept Edit Dialog (AGENT_TASK §12, §13) */}
      <Dialog open={!!editingConcept} onOpenChange={(open) => { if (!open) setEditingConcept(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>ویرایش مفهوم معنایی سیاست</span>
              {editingConcept && (
                <code className="text-xs text-muted-foreground font-mono">
                  {editingConcept.conceptKey}
                </code>
              )}
            </DialogTitle>
            <DialogDescription>
              اصلاح و تدقیق تفسیر معنایی سیاست توسط مدیر. پس از ذخیره، امبدینگ بردار معنایی همگام‌سازی می‌شود.
            </DialogDescription>
          </DialogHeader>

          {editError && (
            <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>{editError}</span>
            </div>
          )}

          {editingConcept && (
            <div className="space-y-4 py-2 text-sm">
              {/* Status & Indexing Notice */}
              <div className="rounded-lg border p-3 bg-muted/40 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-muted-foreground">وضعیت بررسی:</span>
                  {getStatusBadge(editingConcept.reviewStatus)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {editingConcept.reviewStatus === "ACTIVE"
                    ? "این مفهوم در رانتایم فعال است. با ذخیره هرگونه تغییر معنایی، بردار امبدینگ قدیمی نامعتبر شده و فوراً بازتولید می‌گردد تا در بازیابی معنایی اعمال شود."
                    : "این مفهوم هنوز در وضعیت بررسی است. بردار امبدینگ هنگام تأیید و فعال‌سازی ساخته خواهد شد."}
                </p>
              </div>

              {/* Name & NameFa */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="concept-name" className="text-xs font-medium">
                    نام فنی / انگلیسی <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="concept-name"
                    value={editForm.name}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. customer_confidential_records"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="concept-name-fa" className="text-xs font-medium">
                    نام فارسی
                  </Label>
                  <Input
                    id="concept-name-fa"
                    value={editForm.nameFa}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, nameFa: e.target.value }))}
                    placeholder="مثال: سوابق محرمانه مشتریان"
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label htmlFor="concept-desc" className="text-xs font-medium">
                  شرح دقیق معنایی <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="concept-desc"
                  rows={3}
                  value={editForm.descriptionFa}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, descriptionFa: e.target.value }))}
                  placeholder="شرح مفهوم، دامنه شمول و حدود حساسیت..."
                  className="text-xs leading-relaxed"
                />
              </div>

              {/* Sensitivity & Action */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">سطح حساسیت</Label>
                  <Select
                    value={editForm.sensitivity}
                    onValueChange={(val: any) => setEditForm((prev) => ({ ...prev, sensitivity: val }))}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PUBLIC">عمومی (PUBLIC)</SelectItem>
                      <SelectItem value="INTERNAL">داخلی (INTERNAL)</SelectItem>
                      <SelectItem value="CONFIDENTIAL">محرمانه (CONFIDENTIAL)</SelectItem>
                      <SelectItem value="HIGHLY_CONFIDENTIAL">بسیار محرمانه (HIGHLY_CONFIDENTIAL)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">اقدام رانتایم (Action)</Label>
                  <Select
                    value={editForm.action}
                    onValueChange={(val: any) => setEditForm((prev) => ({ ...prev, action: val }))}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALLOW_EXTERNAL">مجاز خارجی (ALLOW_EXTERNAL)</SelectItem>
                      <SelectItem value="MASK_AND_ALLOW_EXTERNAL">ماسک + مجاز خارجی (MASK_AND_ALLOW_EXTERNAL)</SelectItem>
                      <SelectItem value="ROUTE_LOCAL">مسیر محلی (ROUTE_LOCAL)</SelectItem>
                      <SelectItem value="BLOCK">مسدودسازی کامل (BLOCK)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <Label htmlFor="concept-category" className="text-xs font-medium">
                  دسته‌بندی (اختیاری)
                </Label>
                <Input
                  id="concept-category"
                  value={editForm.category}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, category: e.target.value }))}
                  placeholder="مثال: اطلاعات هویتی، مالی، فنی..."
                  className="text-xs"
                />
              </div>

              {/* Positive Examples */}
              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-destructive">
                    نمونه‌های شمول / حساس (Positive Examples)
                  </Label>
                  <span className="text-[11px] text-muted-foreground">
                    ({editForm.positiveExamples.length} نمونه)
                  </span>
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {editForm.positiveExamples.map((ex, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 rounded bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
                    >
                      <span className="flex-1 leading-normal">{ex}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditForm((prev) => ({
                            ...prev,
                            positiveExamples: prev.positiveExamples.filter((_, i) => i !== idx),
                          }))
                        }
                        className="hover:opacity-75"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newPositiveExample}
                    onChange={(e) => setNewPositiveExample(e.target.value)}
                    placeholder="افزودن نمونه مثبت جدید..."
                    className="text-xs h-8"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newPositiveExample.trim()) {
                        e.preventDefault();
                        setEditForm((prev) => ({
                          ...prev,
                          positiveExamples: [...prev.positiveExamples, newPositiveExample.trim()],
                        }));
                        setNewPositiveExample("");
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs shrink-0"
                    disabled={!newPositiveExample.trim()}
                    onClick={() => {
                      if (newPositiveExample.trim()) {
                        setEditForm((prev) => ({
                          ...prev,
                          positiveExamples: [...prev.positiveExamples, newPositiveExample.trim()],
                        }));
                        setNewPositiveExample("");
                      }
                    }}
                  >
                    <Plus className="size-3.5 ml-1" />
                    افزودن
                  </Button>
                </div>
              </div>

              {/* Negative Examples */}
              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    نمونه‌های مجاز مشابه (Negative Examples)
                  </Label>
                  <span className="text-[11px] text-muted-foreground">
                    ({editForm.negativeExamples.length} نمونه — صرفاً برای قاضی معنایی محلی)
                  </span>
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {editForm.negativeExamples.map((ex, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 rounded bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-700 dark:text-emerald-400"
                    >
                      <span className="flex-1 leading-normal">{ex}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditForm((prev) => ({
                            ...prev,
                            negativeExamples: prev.negativeExamples.filter((_, i) => i !== idx),
                          }))
                        }
                        className="hover:opacity-75"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newNegativeExample}
                    onChange={(e) => setNewNegativeExample(e.target.value)}
                    placeholder="افزودن نمونه منفی جدید..."
                    className="text-xs h-8"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newNegativeExample.trim()) {
                        e.preventDefault();
                        setEditForm((prev) => ({
                          ...prev,
                          negativeExamples: [...prev.negativeExamples, newNegativeExample.trim()],
                        }));
                        setNewNegativeExample("");
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs shrink-0"
                    disabled={!newNegativeExample.trim()}
                    onClick={() => {
                      if (newNegativeExample.trim()) {
                        setEditForm((prev) => ({
                          ...prev,
                          negativeExamples: [...prev.negativeExamples, newNegativeExample.trim()],
                        }));
                        setNewNegativeExample("");
                      }
                    }}
                  >
                    <Plus className="size-3.5 ml-1" />
                    افزودن
                  </Button>
                </div>
              </div>

              {/* Conditions / Exceptions */}
              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-blue-600 dark:text-blue-400">
                    شروط و استثناها (Conditions & Exceptions)
                  </Label>
                  <span className="text-[11px] text-muted-foreground">
                    ({editForm.conditions.length} شرط)
                  </span>
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {editForm.conditions.map((c, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 rounded bg-blue-500/10 px-2.5 py-1.5 text-xs text-blue-700 dark:text-blue-400"
                    >
                      <span className="flex-1 leading-normal">{c}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditForm((prev) => ({
                            ...prev,
                            conditions: prev.conditions.filter((_, i) => i !== idx),
                          }))
                        }
                        className="hover:opacity-75"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newCondition}
                    onChange={(e) => setNewCondition(e.target.value)}
                    placeholder="افزودن شرط یا استثنا..."
                    className="text-xs h-8"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newCondition.trim()) {
                        e.preventDefault();
                        setEditForm((prev) => ({
                          ...prev,
                          conditions: [...prev.conditions, newCondition.trim()],
                        }));
                        setNewCondition("");
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs shrink-0"
                    disabled={!newCondition.trim()}
                    onClick={() => {
                      if (newCondition.trim()) {
                        setEditForm((prev) => ({
                          ...prev,
                          conditions: [...prev.conditions, newCondition.trim()],
                        }));
                        setNewCondition("");
                      }
                    }}
                  >
                    <Plus className="size-3.5 ml-1" />
                    افزودن
                  </Button>
                </div>
              </div>

              {/* Read-Only Provenance Section */}
              <div className="rounded-lg border bg-muted/40 p-3 space-y-2 border-t pt-3 text-xs">
                <div className="flex items-center justify-between font-semibold text-muted-foreground">
                  <span>نقل‌قول و اصالت مبنا (Provenance — غیرقابل تغییر دستی):</span>
                  {editingConcept.sourcePage && <span>صفحه: {editingConcept.sourcePage}</span>}
                </div>
                <blockquote className="italic text-foreground border-r-2 border-blue-500 pr-2">
                  «{editingConcept.sourceQuote}»
                </blockquote>
                {editingConcept.extractedByModel && (
                  <div className="text-[11px] text-muted-foreground pt-1">
                    استخراج اولیه توسط مدل: <code>{editingConcept.extractedByModel}</code>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingConcept(null)}
              disabled={saveLoading}
              className="text-xs"
            >
              انصراف
            </Button>
            <Button
              type="button"
              onClick={handleSaveEdit}
              disabled={saveLoading}
              className="text-xs bg-blue-600 hover:bg-blue-700"
            >
              {saveLoading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin ml-1.5" />
                  در حال ذخیره و به‌روزرسانی ایندکس...
                </>
              ) : (
                "ذخیره تغییرات"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Concept Rejection Dialog (spec §2.5) */}
      <Dialog open={!!rejectingConcept} onOpenChange={(open) => { if (!open) setRejectingConcept(null); }}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>رد مفهوم سیاست</DialogTitle>
            <DialogDescription>
              لطفاً دلیل رد مفهوم «{rejectingConcept?.nameFa || rejectingConcept?.name}» را مشخص کنید. این بازخورد به بهبود استخراج‌های بعدی مدل کمک می‌کند.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <label className="font-semibold block">دلیل رد:</label>
              <Select value={rejectionReason} onValueChange={setRejectionReason}>
                <SelectTrigger className="w-full text-xs">
                  <SelectValue placeholder="انتخاب دلیل رد" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ادغام چند قاعده در یک مفهوم">ادغام چند قاعده در یک مفهوم</SelectItem>
                  <SelectItem value="دسته‌بندی نادرست">دسته‌بندی نادرست</SelectItem>
                  <SelectItem value="سطح حساسیت اشتباه">سطح حساسیت اشتباه</SelectItem>
                  <SelectItem value="تکراری">تکراری با مفهوم دیگر</SelectItem>
                  <SelectItem value="نامرتبط">نامرتبط به سیاست امنیتی</SelectItem>
                  <SelectItem value="other">سایر دلایل (توضیح در کادر زیر)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold block">توضیح تکمیلی یا بازخورد (اختیاری):</label>
              <Textarea
                value={customRejectionNote}
                onChange={(e) => setCustomRejectionNote(e.target.value)}
                placeholder="توضیح بیشتری بنویسید..."
                className="text-xs min-h-[70px]"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setRejectingConcept(null)}>
              انصراف
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={actionLoading === rejectingConcept?.id}
              onClick={handleConfirmReject}
            >
              {actionLoading === rejectingConcept?.id ? <Loader2 className="size-3 animate-spin ml-1" /> : null}
              تأیید رد مفهوم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Admin View
// ═══════════════════════════════════════════════════════════════════════════

export function AdminView() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <AdminHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Tabs defaultValue="policy" dir="rtl" className="w-full">
          <TabsList className="mb-6 w-full flex-wrap justify-start">
            <TabsTrigger value="policy" className="gap-1.5">
              <FileText className="size-4" />
              <span className="hidden sm:inline">مدیریت سند</span>
              <span className="sm:hidden">سند</span>
            </TabsTrigger>
            <TabsTrigger value="concepts" className="gap-1.5">
              <ShieldCheck className="size-4" />
              <span className="hidden sm:inline">مفاهیم معنایی</span>
              <span className="sm:hidden">مفاهیم</span>
            </TabsTrigger>
            <TabsTrigger value="rules" className="gap-1.5">
              <Pencil className="size-4" />
              <span className="hidden sm:inline">ویرایشگر قواعد</span>
              <span className="sm:hidden">قواعد</span>
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-1.5">
              <Clock className="size-4" />
              <span className="hidden sm:inline">لاگ تصمیم‌ها</span>
              <span className="sm:hidden">لاگ</span>
            </TabsTrigger>
            <TabsTrigger value="tester" className="gap-1.5">
              <FlaskConical className="size-4" />
              <span className="hidden sm:inline">آزمایشگاه سیاست</span>
              <span className="sm:hidden">آزمایش</span>
            </TabsTrigger>
            <TabsTrigger value="dictionary" className="gap-1.5">
              <BookKey className="size-4" />
              <span className="hidden sm:inline">دیکشنری ماسک</span>
              <span className="sm:hidden">دیکشنری</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="policy">
            <PolicyDocsTab />
          </TabsContent>
          <TabsContent value="concepts">
            <PolicyConceptsTab />
          </TabsContent>
          <TabsContent value="rules">
            <RulesEditorTab />
          </TabsContent>
          <TabsContent value="logs">
            <DecisionLogsTab />
          </TabsContent>
          <TabsContent value="tester">
            <PolicyTesterTab />
          </TabsContent>
          <TabsContent value="dictionary">
            <MaskDictionaryTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
