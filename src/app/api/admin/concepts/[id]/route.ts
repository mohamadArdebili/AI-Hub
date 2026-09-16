import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  getConceptById,
  approveConcept,
  rejectConcept,
  archiveConcept,
  updateConcept,
  deleteConcept,
} from '@/lib/policy/concepts/repository';
import { UpdateConceptSchema } from '@/lib/policy/concepts/validator';
import { PrismaVectorStore } from '@/lib/policy/retrieval/vector-store';
import { OllamaEmbeddingProvider } from '@/lib/policy/retrieval/embeddings';
import { createPolicyAuditLog } from '@/lib/db/audit-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(request);
    const { id } = await params;

    const concept = await getConceptById(id, session.user.organizationId);
    if (!concept) {
      return Response.json({ error: 'مفهوم سیاست یافت نشد' }, { status: 404 });
    }

    return Response.json({ concept });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[admin/concepts] GET error:', error);
    return Response.json({ error: 'خطای سرور' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    // Strict Tenant Isolation: concept must belong to admin's organization (AGENT_TASK §11)
    const existing = await getConceptById(id, session.user.organizationId);
    if (!existing) {
      return Response.json({ error: 'مفهوم سیاست یافت نشد' }, { status: 404 });
    }

    const { reviewAction, reviewNote, ...editData } = body;
    const vectorStore = new PrismaVectorStore();

    let updated = existing;

    if (reviewAction === 'approve') {
      updated = await approveConcept(id, session.user.organizationId, reviewNote);

      // Generate embedding vector upon concept approval
      const embeddingProvider = new OllamaEmbeddingProvider();
      try {
        await vectorStore.regenerateConceptEmbedding(id, session.user.organizationId, embeddingProvider);
      } catch (err) {
        console.warn('[admin/concepts] embedding generation warning on approve:', err);
      }

      await createPolicyAuditLog({
        organizationId: session.user.organizationId,
        actorId: session.user.id,
        action: 'CONCEPT_APPROVE',
        targetType: 'POLICY_CONCEPT',
        targetId: id,
        metadataJson: JSON.stringify({ conceptKey: existing.conceptKey, reviewNote }),
      });
    } else if (reviewAction === 'reject') {
      // Invalidate embedding upon rejection
      await vectorStore.deleteEmbedding(id);
      updated = await rejectConcept(id, session.user.organizationId, reviewNote);
      await createPolicyAuditLog({
        organizationId: session.user.organizationId,
        actorId: session.user.id,
        action: 'CONCEPT_REJECT',
        targetType: 'POLICY_CONCEPT',
        targetId: id,
        metadataJson: JSON.stringify({ conceptKey: existing.conceptKey, reviewNote }),
      });
    } else if (reviewAction === 'archive') {
      // Invalidate embedding upon archive
      await vectorStore.deleteEmbedding(id);
      updated = await archiveConcept(id, session.user.organizationId);
      await createPolicyAuditLog({
        organizationId: session.user.organizationId,
        actorId: session.user.id,
        action: 'CONCEPT_ARCHIVE',
        targetType: 'POLICY_CONCEPT',
        targetId: id,
        metadataJson: JSON.stringify({ conceptKey: existing.conceptKey }),
      });
    } else {
      // ── Server-Side Validation (AGENT_TASK §10) ──
      const parseResult = UpdateConceptSchema.safeParse(editData);
      if (!parseResult.success) {
        const errorMessages = parseResult.error.issues.map((i) => i.message).join('؛ ');
        return Response.json(
          {
            error: `اعتبارسنجی ورودی ناموفق بود: ${errorMessages}`,
            details: parseResult.error.issues,
          },
          { status: 400 },
        );
      }

      const validatedData = parseResult.data;
      const wasActive = existing.reviewStatus === 'ACTIVE';

      // ── Embedding Invalidation & Regeneration Lifecycle (AGENT_TASK §5, §6, §14) ──
      // Step 1: Invalidate / mark old embedding stale BEFORE saving to prevent race conditions
      // or serving stale semantic knowledge if regeneration fails mid-flight.
      if (wasActive) {
        await vectorStore.deleteEmbedding(id);
      }

      // Step 2: Save updated concept fields to database
      updated = await updateConcept(id, session.user.organizationId, validatedData);

      // Step 3: If concept is ACTIVE, regenerate embedding and update vector store
      if (updated.reviewStatus === 'ACTIVE') {
        const embeddingProvider = new OllamaEmbeddingProvider();
        try {
          await vectorStore.regenerateConceptEmbedding(id, session.user.organizationId, embeddingProvider);
        } catch (embedErr) {
          // Fail-closed invariant: do not claim success when embedding fails.
          // Stale embedding was already deleted in Step 1, preventing stale retrieval.
          console.error('[admin/concepts] embedding regeneration failed (fail-closed):', embedErr);

          await createPolicyAuditLog({
            organizationId: session.user.organizationId,
            actorId: session.user.id,
            action: 'CONCEPT_EDIT',
            targetType: 'POLICY_CONCEPT',
            targetId: id,
            metadataJson: JSON.stringify({
              conceptKey: existing.conceptKey,
              embeddingFailed: true,
              error: embedErr instanceof Error ? embedErr.message : String(embedErr),
            }),
          });

          return Response.json(
            {
              error: 'مفهوم در پایگاه داده ذخیره شد اما بازتولید بردار امبدینگ معنایی ناموفق بود (fail-closed). بردار قبلی حذف گردید تا دانش منسوخ در بازیابی استفاده نشود.',
              concept: updated,
            },
            { status: 500 },
          );
        }
      }

      // Record audit log for successful edit
      await createPolicyAuditLog({
        organizationId: session.user.organizationId,
        actorId: session.user.id,
        action: 'CONCEPT_EDIT',
        targetType: 'POLICY_CONCEPT',
        targetId: id,
        metadataJson: JSON.stringify({
          conceptKey: existing.conceptKey,
          wasActive,
          isActive: updated.reviewStatus === 'ACTIVE',
          embeddingRegenerated: updated.reviewStatus === 'ACTIVE',
        }),
      });
    }

    return Response.json({ success: true, concept: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[admin/concepts] PATCH error:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'خطای سرور' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(request);
    const { id } = await params;

    const vectorStore = new PrismaVectorStore();
    await vectorStore.deleteEmbedding(id);
    await deleteConcept(id, session.user.organizationId);
    await createPolicyAuditLog({
      organizationId: session.user.organizationId,
      actorId: session.user.id,
      action: 'CONCEPT_DELETE',
      targetType: 'POLICY_CONCEPT',
      targetId: id,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[admin/concepts] DELETE error:', error);
    const message = error instanceof Error ? error.message : 'خطای سرور';
    const status = message.includes('not found') ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
