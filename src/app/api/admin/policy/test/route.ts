import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { evaluate } from '@/lib/policy';
import {
  classifyPrompt,
  decideRoute,
  CATEGORIES,
  type ClassifierResult,
} from '@/lib/policy/classifier';
import { sanitizePrompt, MASK_LABELS } from '@/lib/policy/sanitizer';
import { getPolicySnapshot, getActiveMaskTerms } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// نسخهٔ پایپ‌لاین آزمایشگاه — همگام با /api/chat
const PIPELINE_VERSION = 'phase3-dlp-router-1.0';

const ROUTE_FA: Record<string, string> = {
  EXTERNAL: 'مدل خارجی',
  LOCAL: 'مدل محلی',
  BLOCKED: 'متوقف شد',
};

interface PolicyTestResult {
  pipelineVersion: string;
  latencyMs: number;
  sanitize: {
    maskedText: string;
    maskCount: number;
    findings: Array<{ label: string; count: number; labelFa: string }>;
  };
  engine: {
    action: 'ALLOW' | 'BLOCK';
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
  route: 'EXTERNAL' | 'LOCAL' | 'BLOCKED';
  routeFa: string;
}

// POST /api/admin/policy/test — اجرای آزمایشیِ کامل پایپ‌لاین فاز ۳
// (ماسک‌گذاری → موتور قواعد → طبقه‌بند هوشمند → مسیریابی) بدون پاسخ‌دهی مدل
// و بدون نوشتن در لاگ ممیزی — صرفاً برای پیش‌نمایش رفتار گیت‌وی در پنل مدیریت.
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const organizationId = session.user.organizationId;

    let body: { prompt?: unknown };
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: 'بدنه درخواست معتبر نیست' },
        { status: 400 }
      );
    }

    const prompt =
      typeof body.prompt === 'string' ? body.prompt.trim() : '';

    if (prompt.length === 0) {
      return Response.json(
        { error: 'متن آزمایشی الزامی است' },
        { status: 400 }
      );
    }
    if (prompt.length > 8000) {
      return Response.json(
        { error: 'متن آزمایشی بیش از حد طولانی است (حداکثر ۸۰۰۰ کاراکتر)' },
        { status: 400 }
      );
    }

    const startedAt = Date.now();

    // ── لایه ۱: ماسک‌گذاری قطعی (Sanitizer) ──────────────────────────────
    const dictionaries = await getActiveMaskTerms(organizationId);
    const sanitized = sanitizePrompt(prompt, dictionaries);

    // ── لایه ۲: موتور قواعد فاز ۲ (روی متن اصلی — همانند /api/chat) ─────
    const policySnapshot = await getPolicySnapshot(organizationId);
    const decision = await evaluate({
      prompt,
      organizationId,
      policySnapshot,
    });

    const engineBlocked = decision.action === 'BLOCK';

    // ── لایه ۳: طبقه‌بند هوشمند (فقط وقتی موتور مسدود نکرده باشد) ────────
    let classifier: ClassifierResult | null = null;
    if (!engineBlocked) {
      classifier = await classifyPrompt(sanitized.maskedText);
    }

    // ── لایه ۴: تصمیم مسیریابی ──────────────────────────────────────────
    const route: PolicyTestResult['route'] = engineBlocked
      ? 'BLOCKED'
      : classifier
        ? decideRoute(classifier)
        : 'BLOCKED';

    const result: PolicyTestResult = {
      pipelineVersion: PIPELINE_VERSION,
      latencyMs: Date.now() - startedAt,
      sanitize: {
        maskedText: sanitized.maskedText,
        maskCount: sanitized.totalCount,
        findings: sanitized.findings.map((f) => ({
          label: f.label,
          count: f.count,
          labelFa: MASK_LABELS[f.label],
        })),
      },
      engine: {
        action: decision.action,
        score: decision.score,
        reasons: decision.reasons,
        matchedRules: decision.matchedRules.map((r) => ({
          code: r.code,
          title: r.title,
          severity: r.severity,
        })),
        latencyMs: Math.round(decision.latencyMs),
        engineVersion: decision.engineVersion,
        hasActiveDocument: policySnapshot !== null,
      },
      classifier:
        classifier === null
          ? null
          : {
              isSensitive: classifier.isSensitive,
              category: classifier.category,
              categoryFa:
                CATEGORIES[classifier.category]?.fa ?? classifier.category,
              riskLevel: classifier.riskLevel,
              reason: classifier.reason,
              method: classifier.method,
              latencyMs: classifier.latencyMs,
            },
      route,
      routeFa: ROUTE_FA[route] ?? route,
    };

    return Response.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[/api/admin/policy/test] error:', err);
    return Response.json(
      { error: 'خطا در اجرای آزمایش سیاست' },
      { status: 500 }
    );
  }
}
