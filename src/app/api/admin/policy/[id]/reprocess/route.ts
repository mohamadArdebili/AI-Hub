import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getPolicyDocumentById,
  updatePolicyDocumentStatus,
  updatePolicyDocumentLifecycle,
  resetPolicyDocumentExtraction,
  createPolicyAuditLog,
} from '@/lib/db';
import { processPolicyDocument } from '@/lib/policy/pdf-processor';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'policy-docs');

/**
 * POST /api/admin/policy/[id]/reprocess
 *
 * Re-runs the full extraction pipeline on a previously uploaded policy
 * document with the LATEST processing logic (Persian text repair +
 * structured «قاعده XXX-NNN» rule extraction + Local-LLM proposals).
 *
 * Use cases:
 *  - the first upload ran an older/buggier pipeline (corrupted rule text)
 *  - the Local-LLM was unavailable at upload time (rules stuck PENDING_LLM)
 *  - the engine was upgraded and the admin wants a fresh extraction
 *
 * Semantics:
 *  - deletes the document's chunks + AUTO-extracted rules (manual rules kept)
 *  - document goes to PROCESSING → READY and lifecycle resets to DRAFT so
 *    the admin re-reviews and re-activates (compilation happens on activate)
 *  - compiled rules of an ACTIVE document keep serving until re-activation
 */
export async function POST(
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

    if (doc.status === 'PROCESSING') {
      return Response.json(
        { error: 'سند در حال پردازش است؛ کمی بعد تلاش کنید' },
        { status: 409 },
      );
    }

    // The source file must exist for re-extraction.
    const ext = doc.sourceType === 'PDF' ? '.pdf' : doc.sourceType === 'TXT' ? '.txt' : '.md';
    const expectedPath = path.join(UPLOADS_DIR, `${doc.id}${ext}`);
    const storedOk = Boolean(doc.storagePath && fs.existsSync(doc.storagePath));
    if (!storedOk && !fs.existsSync(expectedPath)) {
      return Response.json(
        { error: 'فایل منبع سند روی سرور یافت نشد؛ سند را دوباره آپلود کنید' },
        { status: 409 },
      );
    }

    // Reset artifacts: chunks + auto rules of THIS document.
    const { deletedChunks, deletedRules } = await resetPolicyDocumentExtraction(doc.id);

    // Lifecycle back to DRAFT (admin re-reviews + re-activates afterwards).
    await updatePolicyDocumentLifecycle(doc.id, session.user.organizationId, 'DRAFT').catch(
      () => undefined,
    );
    await updatePolicyDocumentStatus(doc.id, 'PROCESSING');

    await createPolicyAuditLog({
      organizationId: session.user.organizationId,
      actorId: session.user.id,
      action: 'REPROCESS',
      targetType: 'POLICY_DOCUMENT',
      targetId: doc.id,
      metadata: { deletedChunks, deletedRules, sourceType: doc.sourceType },
    });

    // Fire-and-forget processing (errors handled inside the processor).
    const rawTextOverride =
      doc.sourceType === 'PDF'
        ? undefined
        : fs.readFileSync(storedOk ? (doc.storagePath as string) : expectedPath, 'utf8');
    processPolicyDocument(
      doc.id,
      session.user.organizationId,
      doc.sourceType as 'PDF' | 'TXT' | 'MD',
      rawTextOverride,
    ).catch(() => {
      // Errors handled inside processPolicyDocument
    });

    return Response.json({
      message: 'پردازش مجدد آغاز شد',
      id: doc.id,
      deletedChunks,
      deletedRules,
      status: 'PROCESSING',
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[policy-reprocess] error:', err);
    return Response.json({ error: 'خطا در پردازش مجدد سند' }, { status: 500 });
  }
}
