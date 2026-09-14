import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listConcepts } from '@/lib/policy/concepts/repository';
import type { ConceptReviewStatus } from '@/lib/policy/concepts/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('documentId') || undefined;
    const reviewStatus = (searchParams.get('reviewStatus') as ConceptReviewStatus) || undefined;

    const concepts = await listConcepts(session.user.organizationId, {
      documentId,
      reviewStatus,
    });

    const stats = {
      total: concepts.length,
      active: concepts.filter((c) => c.reviewStatus === 'ACTIVE').length,
      review: concepts.filter((c) => c.reviewStatus === 'REVIEW').length,
      rejected: concepts.filter((c) => c.reviewStatus === 'REJECTED').length,
      archived: concepts.filter((c) => c.reviewStatus === 'ARCHIVED').length,
    };

    return Response.json({ concepts, stats });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[admin/concepts] GET all error:', error);
    return Response.json({ error: 'خطای سرور' }, { status: 500 });
  }
}
