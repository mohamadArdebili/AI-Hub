"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
  X,
  Clock,
  Zap,
  ShieldAlert,
  ShieldCheck as ShieldOk,
  RefreshCw,
  BookKey,
  EyeOff,
  Server,
  Globe,
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// ─── Types ──────────────────────────────────────────────────────────────

interface PolicyDoc {
  id: string;
  filename: string;
  size: number;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  version: number;
  isActive: boolean;
  extractedCharCount?: number | null;
  errorMessage?: string | null;
  createdAt: string;
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
  sanitize: {
    maskedText: string;
    maskCount: number;
    findings: Array<{ label: string; count: number; labelFa: string }>;
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
  classifier: {
    isSensitive: boolean;
    category: string;
    categoryFa: string;
    riskLevel: string;
    reason: string;
    method: string;
    latencyMs: number;
  } | null;
  route: "EXTERNAL" | "LOCAL" | "BLOCKED";
  routeFa: string;
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

function PolicyDocsTab() {
  const [docs, setDocs] = useState<PolicyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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
      const res = await authFetch(`/api/admin/policy/${id}/activate`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "خطا در فعال‌سازی");
      }
      setSuccess("سند فعال شد");
      await fetchDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    }
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
      await fetchDocs();
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
                فایل PDF
              </Label>
              <Input
                id="pdf-upload"
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="dark:file:text-foreground"
              />
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
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <span className="max-w-[180px] truncate">
                            {doc.filename}
                          </span>
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
                        <div className="flex items-center gap-1">
                          {doc.status === "READY" && !doc.isActive && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-xs"
                              onClick={() => handleActivate(doc.id)}
                            >
                              <CheckCircle2 className="size-3" />
                              فعال‌سازی
                            </Button>
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
// Tab 2: Rules Editor
// ═══════════════════════════════════════════════════════════════════════════

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
              result.route === "EXTERNAL"
                ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                : result.route === "LOCAL"
                  ? "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
                  : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20"
            }
          >
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                {result.route === "EXTERNAL" ? (
                  <>
                    <Globe className="size-8 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                        مسیر: مدل خارجی
                      </p>
                      <p className="text-sm text-emerald-600/80 dark:text-emerald-500/80">
                        نسخه ماسک‌شدهٔ پرامپت به سرویس بیرونی ارسال می‌شود
                      </p>
                    </div>
                  </>
                ) : result.route === "LOCAL" ? (
                  <>
                    <Server className="size-8 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="text-lg font-bold text-amber-700 dark:text-amber-400">
                        مسیر: مدل محلی
                      </p>
                      <p className="text-sm text-amber-600/80 dark:text-amber-500/80">
                        داده حساس شناسایی شد — بدون ارسال به سرویس بیرونی
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="size-8 text-red-600 dark:text-red-400" />
                    <div>
                      <p className="text-lg font-bold text-red-700 dark:text-red-400">
                        متوقف شد
                      </p>
                      <p className="text-sm text-red-600/80 dark:text-red-500/80">
                        تخلف بحرانی از سیاست امنیتی — درخواست ارسال نشد
                      </p>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

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
                  متن ماسک‌شده (همین نسخه به مدل می‌رود):
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

          {/* Pipeline layer 2: Engine */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="size-4" />
                لایه ۲ — موتور قواعد (فاز ۲)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                {result.engine.action === "ALLOW" ? (
                  <Badge
                    variant="secondary"
                    className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  >
                    عبور
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  >
                    مسدود
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  امتیاز: {result.engine.score.toFixed(2)} · {result.engine.latencyMs}ms
                </span>
              </div>
              {!result.engine.hasActiveDocument && (
                <p className="text-xs text-orange-600 dark:text-orange-400">
                  هیچ سند سیاست فعالی وجود ندارد (حالت fail-closed)
                </p>
              )}
              {result.engine.reasons.length > 0 && (
                <ul className="space-y-1">
                  {result.engine.reasons.map((reason, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs text-muted-foreground"
                    >
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-red-400" />
                      {reason}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Pipeline layer 3: Classifier */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Zap className="size-4" />
                لایه ۳ — طبقه‌بند هوشمند
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {result.classifier ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {getRiskBadge(result.classifier.riskLevel)}
                    <Badge variant="outline">{result.classifier.categoryFa}</Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {result.classifier.method === "llm" ? "LLM" : "هیوریستیک"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {result.classifier.latencyMs}ms
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {result.classifier.reason}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  اجرا نشد (موتور قواعد پرامپت را مسدود کرد)
                </p>
              )}
            </CardContent>
          </Card>

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
