import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { CATEGORIES } from '@/lib/policy/classifier';
import { detectConversation } from '@/lib/policy/conversation';
import { sanitizePrompt, MASK_LABELS } from '@/lib/policy/sanitizer';
import {
  getActiveMaskTerms,
} from '@/lib/db';
import type { DetectionOutcome } from '@/lib/policy/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PIPELINE_VERSION = 'semantic-policy-pipeline-2.0';

const ROUTE_FA: Record<string, string> = {
  EXTERNAL: 'مدل خارجی',
  EXTERNAL_DIRECT: 'مدل خارجی (مستقیم)',
  EXTERNAL_MASKED: 'مدل خارجی (ماسک‌شده)',
  LOCAL: 'مسیر امن محلی',
  BLOCKED: 'مسدودسازی امنیتی',
};

const HIT_CATEGORY_FA: Record<string, string> = {
  national_id: 'کد ملی',
  ir_bank_card: 'شماره کارت بانکی',
  iban: 'شماره شبا',
  api_key: 'کلید API',
  private_key: 'کلید خصوصی',
  credential: 'اعتبارنامه اتصال',
  connection_string: 'رشته اتصال پایگاه داده',
  bulk_email: 'آدرس ایمیل انبوه',
  bulk_mobile: 'شماره موبایل انبوه',
  jailbreak_injection: 'تلاش دور زدن فیلتر',
  senior_officer: 'مدیر ارشد (دیکشنری)',
  telco_hub_node: 'مرکز مخابراتی (دیکشنری)',
  proprietary_service: 'سرویس انحصاری (دیکشنری)',
  policy_regex: 'قاعدهٔ سیاست سازمانی',
  policy_semantic: 'مفهوم سیاست سازمانی',
};

function hitLabel(hit: { category: string; ruleLabel?: string }): string {
  return hit.ruleLabel ?? HIT_CATEGORY_FA[hit.category] ?? hit.category;
}

export interface PolicyTestResult {
  pipelineVersion: string;
  latencyMs: number;
  finalRoute: 'EXTERNAL_DIRECT' | 'EXTERNAL_MASKED' | 'LOCAL' | 'BLOCKED' | 'EXTERNAL';
  route: 'EXTERNAL_DIRECT' | 'EXTERNAL_MASKED' | 'LOCAL' | 'BLOCKED' | 'EXTERNAL';
  routeFa: string;
  pipelineHealth: 'HEALTHY' | 'DEGRADED' | 'FAILED';
  policyVersion?: number;
  sanitize: {
    maskedText: string;
    maskCount: number;
    findings: Array<{ label: string; count: number; labelFa: string }>;
  };
  deterministicHits: Array<{
    detectorType: string;
    category: string;
    categoryFa: string;
    matchedSpan: { start: number; end: number; text: string };
    confidence: number;
    ruleLabel?: string;
  }>;
  retrieval: Array<{
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
  classifier: {
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
  // Legacy backward-compatibility fields for UI
  engine: {
    action: 'ALLOW' | 'BLOCK';
    score: number;
    reasons: string[];
    matchedRules: { code: string; title: string; severity: string }[];
    latencyMs: number;
    engineVersion: string;
    hasActiveDocument: boolean;
  };
  detection: {
    decision: string;
    action: string;
    hitCount: number;
    hitLabels: string[];
    durationMs: number;
    reason: string;
  } | null;
}

// POST /api/admin/policy/test — آزمایشگاه کامل ارزیابی سیاست امنیتی (MIGRATION_PLAN_REVIEWED_v1.1 §6.3, spec §36)
// اجرای لایه‌های ماسک‌گذاری، تطبیق قطعی، بازیابی هیبریدی، قضاوت معنایی و مسیریابی چندمرحله‌ای
// بدون فراخوانی هیچ LLM خارجی در مسیر تشخیص و بدون اثرگذاری در تاریخچه چت کاربر.
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

    const outcome: DetectionOutcome = await detectConversation([{ role: 'user', content: prompt }], organizationId);
    const finalRoute: PolicyTestResult['finalRoute'] = outcome.route ?? 'LOCAL';

    const deterministicHits = outcome.hits.map((h) => ({
      detectorType: h.detectorType,
      category: h.category,
      categoryFa: HIT_CATEGORY_FA[h.category] ?? CATEGORIES[h.category]?.fa ?? h.category,
      matchedSpan: h.matchedSpan,
      confidence: h.confidence,
      ruleLabel: h.ruleLabel,
    }));

    const retrieval = (outcome.retrievedConcepts ?? outcome.matchedConcepts ?? []).map((c) => ({
      conceptId: c.conceptId,
      conceptKey: c.conceptKey,
      name: c.name,
      category: 'category' in c ? (c as { category?: string | null }).category ?? null : null,
      sensitivity: c.sensitivity,
      action: c.action,
      score: c.score,
      denseScore: 'denseScore' in c ? (c as { denseScore?: number }).denseScore : undefined,
      lexicalScore: 'lexicalScore' in c ? (c as { lexicalScore?: number }).lexicalScore : undefined,
      rrfScore: 'rrfScore' in c ? (c as { rrfScore?: number }).rrfScore : undefined,
    }));

    const classifier = outcome.classifier
      ? {
          decision: outcome.classifier.decision ?? outcome.decision,
          scope: outcome.classifier.scope ?? (outcome.decision === 'SAFE' ? 'GENERAL' : 'ORG_SPECIFIC'),
          confidence: outcome.classifier.confidence,
          reasonFa: outcome.classifier.reasonFa ?? outcome.classifier.reason ?? outcome.reason ?? '',
          method: outcome.classifier.method,
          modelUsed: outcome.classifier.modelUsed,
          matchedConcepts: outcome.matchedConcepts?.map((c) => c.name),
        }
      : null;

    const result: PolicyTestResult = {
      pipelineVersion: PIPELINE_VERSION,
      latencyMs: Date.now() - startedAt,
      finalRoute,
      route: finalRoute,
      routeFa: ROUTE_FA[finalRoute] ?? finalRoute,
      pipelineHealth: outcome.pipelineHealth ?? 'HEALTHY',
      policyVersion: outcome.policyVersion,
      sanitize: {
        maskedText: sanitized.maskedText,
        maskCount: sanitized.totalCount,
        findings: sanitized.findings.map((f) => ({
          label: f.label,
          count: f.count,
          labelFa: MASK_LABELS[f.label],
        })),
      },
      deterministicHits,
      retrieval,
      classifier,
      stageLatencies: outcome.stageLatencies,
      engine: {
        action: finalRoute === 'BLOCKED' ? 'BLOCK' : 'ALLOW',
        score: outcome.decision === 'SAFE' ? 0 : 1,
        reasons: outcome.reason ? [outcome.reason] : [],
        matchedRules: (outcome.matchedConcepts ?? []).map(c => ({
          code: c.conceptKey, title: c.name, severity: c.sensitivity,
        })),
        latencyMs: outcome.processing.durationMs,
        engineVersion: PIPELINE_VERSION,
        hasActiveDocument: Boolean(outcome.policyDocumentId),
      },
      detection: {
        decision: outcome.decision,
        action: outcome.action,
        hitCount: outcome.hits.length + (outcome.matchedConcepts?.length ?? 0),
        hitLabels: Array.from(new Set([
          ...outcome.hits.map(hitLabel),
          ...(outcome.matchedConcepts ?? []).map(c => ('category' in c && c.category ? c.category : c.name)),
        ].filter((x): x is string => Boolean(x && x.trim())))),
        durationMs: outcome.processing.durationMs,
        reason: outcome.reason ?? '',
      },
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
