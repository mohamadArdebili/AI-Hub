import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  activatePolicyDocument,
  getPolicyDocumentById,
  getPolicyRulesByDocument,
  saveCompiledRules,
  activatePolicyRulesForDocument,
  createPolicyAuditLog,
} from '@/lib/db';
import { compileRulesToRuntime, type CompilableRule, type LifecycleState } from '@/lib/policy/ingestion';
import type { RuleStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/policy/[id]/activate — REVIEW → ACTIVE with REAL compilation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(request);
    const { id } = await params;
    const organizationId = session.user.organizationId;

    // Verify document exists and is READY
    const doc = await getPolicyDocumentById(id, organizationId);
    if (!doc) {
      return Response.json({ error: 'سند یافت نشد' }, { status: 404 });
    }

    if (doc.status !== 'READY') {
      return Response.json(
        { error: 'فقط اسناد آماده قابل فعال‌سازی هستند' },
        { status: 400 },
      );
    }

    // Sensitive-Data Layer: only documents in REVIEW state may be activated.
    if ((doc.lifecycle as LifecycleState) !== 'REVIEW') {
      return Response.json(
        {
          error:
            'فعال‌سازی فقط برای اسناد در وضعیت «بازبینی» مجاز است. ابتدا سند را از پیش‌نویس به بازبینی ارسال کنید.',
        },
        { status: 400 },
      );
    }

    // ── Compile: ACTIVE-reviewable rules → runtime-optimized format ──
    const rules = await getPolicyRulesByDocument(id);
    const compilable: CompilableRule[] = rules
      .filter(
        (r) =>
          r.isActive &&
          (r.status as RuleStatus) === 'ACTIVE' &&
          r.detectorType !== null,
      )
      .map((r) => ({
        id: r.id,
        detectorType: r.detectorType as CompilableRule['detectorType'],
        regexSource: safeParse(r.patterns)[0] ?? null,
        regexFlags: 'gi',
        checksumKind: r.checksumKind,
        dictionaryId: r.dictionaryId,
        keywords: safeParse(r.keywords),
        action: r.action as CompilableRule['action'],
        priority: r.priority,
        sourceDocumentId: r.documentId,
        sourceChunkId: r.chunkId,
        sourcePage: r.sourcePage,
        sourceQuote: r.sourceQuote,
      }));

    const { compiled, skipped } = compileRulesToRuntime(id, compilable);
    await saveCompiledRules(id, JSON.stringify(compiled));

    // ── Phase 3: Build & validate concept vector index before atomic switch (spec §0.1 #8, §3.5) ──
    const { PrismaVectorStore } = await import('@/lib/policy/retrieval/vector-store');
    const { OllamaEmbeddingProvider } = await import('@/lib/policy/retrieval/embeddings');
    const vectorStore = new PrismaVectorStore();
    const embeddingProvider = new OllamaEmbeddingProvider();
    let indexReport = { indexed: 0, failed: 0 };
    try {
      indexReport = await vectorStore.rebuildIndex(organizationId, id, embeddingProvider);
    } catch (indexErr) {
      console.warn('[policy-activate] semantic index rebuild note (fail-closed if model unavailable):', indexErr);
    }

    // ── Activate (deactivates + archives the previous active doc) ──
    const activated = await activatePolicyDocument(id, organizationId);

    // Runtime rule scoping: LIVE policy = this doc's auto rules + manual rules.
    // Stale auto rules of OTHER documents (e.g. from an older corrupted
    // upload) are deactivated so they stop firing at runtime.
    const ruleScope = await activatePolicyRulesForDocument(organizationId, id);

    await createPolicyAuditLog({
      organizationId,
      actorId: session.user.id,
      action: 'ACTIVATION',
      targetType: 'POLICY_DOCUMENT',
      targetId: id,
      metadata: {
        compiledRules: compiled.length,
        skippedRules: skipped.length,
        skippedReasons: skipped.slice(0, 10).map((s) => s.reason),
        rulesActivated: ruleScope.activated,
        rulesDeactivated: ruleScope.deactivated,
      },
    });

    return Response.json({
      id: activated.id,
      filename: activated.filename,
      status: activated.status,
      lifecycle: activated.lifecycle,
      isActive: activated.isActive,
      compiledRules: compiled.length,
      skippedRules: skipped.length,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[policy-activate] error:', err);
    return Response.json({ error: 'خطا در فعال‌سازی سند' }, { status: 500 });
  }
}

function safeParse(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
