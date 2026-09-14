import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getPolicyDocumentById } from '@/lib/db';
import { listConcepts, getPolicyUnitsByDocument } from '@/lib/policy/concepts/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/policy/[id]/concepts — Fetch all concepts and units for a document
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

    const [concepts, units] = await Promise.all([
      listConcepts(session.user.organizationId, { documentId: id }),
      getPolicyUnitsByDocument(id),
    ]);

    const stats = {
      total: concepts.length,
      active: concepts.filter((c) => c.reviewStatus === 'ACTIVE').length,
      review: concepts.filter((c) => c.reviewStatus === 'REVIEW').length,
      rejected: concepts.filter((c) => c.reviewStatus === 'REJECTED').length,
      archived: concepts.filter((c) => c.reviewStatus === 'ARCHIVED').length,
      unitsTotal: units.length,
      candidateUnits: units.filter((u) => u.isCandidate).length,
    };

    return Response.json({
      documentId: id,
      stats,
      concepts,
      units,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[admin/policy/concepts] GET error:', error);
    return Response.json({ error: 'خطای داخلی سرور' }, { status: 500 });
  }
}
