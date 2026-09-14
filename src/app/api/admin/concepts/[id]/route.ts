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

    const existing = await getConceptById(id, session.user.organizationId);
    if (!existing) {
      return Response.json({ error: 'مفهوم سیاست یافت نشد' }, { status: 404 });
    }

    const { reviewAction, reviewNote, ...editData } = body;

    let updated = existing;

    if (reviewAction === 'approve') {
      updated = await approveConcept(id, session.user.organizationId, reviewNote);
      await createPolicyAuditLog({
        organizationId: session.user.organizationId,
        actorId: session.user.id,
        action: 'CONCEPT_APPROVE',
        targetType: 'POLICY_CONCEPT',
        targetId: id,
        metadataJson: JSON.stringify({ conceptKey: existing.conceptKey, reviewNote }),
      });
    } else if (reviewAction === 'reject') {
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
      // General edit: if an ACTIVE concept is edited, its embedding must be invalidated
      // and its status transitioned back to REVIEW (spec §2.7)
      const wasActive = existing.reviewStatus === 'ACTIVE';
      if (wasActive) {
        await db.policyConceptEmbedding.deleteMany({ where: { conceptId: id } });
        editData.reviewStatus = 'REVIEW';
      }

      updated = await updateConcept(id, session.user.organizationId, editData);
      await createPolicyAuditLog({
        organizationId: session.user.organizationId,
        actorId: session.user.id,
        action: 'CONCEPT_EDIT',
        targetType: 'POLICY_CONCEPT',
        targetId: id,
        metadataJson: JSON.stringify({
          conceptKey: existing.conceptKey,
          wasActive,
          invalidatedEmbedding: wasActive,
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
    return Response.json({ error: 'خطای سرور' }, { status: 500 });
  }
}
