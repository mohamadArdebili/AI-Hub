import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  deletePolicyDocument,
  getPolicyDocumentById,
  getPolicyChunks,
  getPolicyRulesByDocument,
  updatePolicyDocumentLifecycle,
  createPolicyAuditLog,
} from '@/lib/db';
import { canTransitionLifecycle, type LifecycleState } from '@/lib/policy/ingestion';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'policy-docs');

// GET /api/admin/policy/[id] — document detail: chunks + rules with provenance
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(request);
    const { id } = await params;

    const doc = await getPolicyDocumentById(id, session.user.organizationId);
    if (!doc) {
      return Response.json({ error: 'سند یافت نشد' }, { status: 404 });
    }

    const [chunks, rules] = await Promise.all([
      getPolicyChunks(id),
      getPolicyRulesByDocument(id),
    ]);

    return Response.json({
      document: {
        id: doc.id,
        filename: doc.filename,
        sourceType: doc.sourceType,
        status: doc.status,
        lifecycle: doc.lifecycle,
        isActive: doc.isActive,
        version: doc.version,
        extractedCharCount: doc.extractedCharCount,
        errorMessage: doc.errorMessage,
        reviewedAt: doc.reviewedAt,
        activatedAt: doc.activatedAt,
        createdAt: doc.createdAt,
        hasCompiledRules: Boolean(doc.compiledRules),
      },
      chunks: chunks.map((c) => ({
        id: c.id,
        index: c.index,
        pageIndex: c.pageIndex,
        textHash: c.textHash,
        spanStart: c.spanStart,
        spanEnd: c.spanEnd,
        isCandidate: c.isCandidate,
        isRestricted: c.isRestricted,
        content: c.content,
      })),
      rules: rules.map((r) => ({
        id: r.id,
        code: r.code,
        title: r.title,
        body: r.body,
        status: r.status,
        detectorType: r.detectorType,
        checksumKind: r.checksumKind,
        action: r.action,
        priority: r.priority,
        severity: r.severity,
        category: r.category,
        keywords: safeParse(r.keywords),
        patterns: safeParse(r.patterns),
        sourceQuote: r.sourceQuote,
        sourcePage: r.sourcePage,
        textHash: r.textHash,
        conflictGroup: r.conflictGroup,
        reviewNote: r.reviewNote,
        chunkId: r.chunkId,
        isManual: r.isManual,
        isActive: r.isActive,
      })),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[policy-detail] error:', err);
    return Response.json({ error: 'خطا در دریافت جزئیات سند' }, { status: 500 });
  }
}

// PATCH /api/admin/policy/[id] — lifecycle transitions (DRAFT → REVIEW → ACTIVE …)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(request);
    const { id } = await params;

    let body: { lifecycle?: unknown };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'بدنه درخواست معتبر نیست' }, { status: 400 });
    }

    const target = String(body.lifecycle ?? '');
    if (!['DRAFT', 'REVIEW', 'ACTIVE', 'ARCHIVED'].includes(target)) {
      return Response.json({ error: 'وضعیت مقصد معتبر نیست' }, { status: 400 });
    }

    const doc = await getPolicyDocumentById(id, session.user.organizationId);
    if (!doc) {
      return Response.json({ error: 'سند یافت نشد' }, { status: 404 });
    }
    if (doc.status !== 'READY') {
      return Response.json(
        { error: 'تغییر وضعیت فقط برای اسناد آماده مجاز است' },
        { status: 400 },
      );
    }

    const from = doc.lifecycle as LifecycleState;
    const to = target as LifecycleState;
    if (!canTransitionLifecycle(from, to)) {
      return Response.json(
        { error: `گذار از وضعیت ${from} به ${to} مجاز نیست` },
        { status: 400 },
      );
    }

    // ACTIVE transition goes through the dedicated activate endpoint
    // (which compiles the rules). Here we only allow non-compiling moves.
    if (to === 'ACTIVE') {
      return Response.json(
        { error: 'برای فعال‌سازی از endpoint فعال‌سازی استفاده کنید' },
        { status: 400 },
      );
    }

    const updated = await updatePolicyDocumentLifecycle(id, session.user.organizationId, to);

    await createPolicyAuditLog({
      organizationId: session.user.organizationId,
      actorId: session.user.id,
      action: 'LIFECYCLE',
      targetType: 'POLICY_DOCUMENT',
      targetId: id,
      metadata: { from, to },
    });

    return Response.json({
      id: updated.id,
      lifecycle: updated.lifecycle,
      isActive: updated.isActive,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[policy-lifecycle] error:', err);
    return Response.json({ error: 'خطا در تغییر وضعیت سند' }, { status: 500 });
  }
}

// DELETE /api/admin/policy/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(request);
    const { id } = await params;

    // Verify document exists in this org
    const doc = await getPolicyDocumentById(id, session.user.organizationId);
    if (!doc) {
      return Response.json({ error: 'سند یافت نشد' }, { status: 404 });
    }

    // Delete file from disk
    const filePath = path.join(UPLOADS_DIR, `${id}.pdf`);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // File may not exist, that's ok
    }

    // Delete from DB (cascades to chunks, rules keep documentId=null)
    await deletePolicyDocument(id, session.user.organizationId);

    await createPolicyAuditLog({
      organizationId: session.user.organizationId,
      actorId: session.user.id,
      action: 'DELETE_DRAFT',
      targetType: 'POLICY_DOCUMENT',
      targetId: id,
      metadata: { filename: doc.filename },
    });

    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: 'خطا در حذف سند' }, { status: 500 });
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
