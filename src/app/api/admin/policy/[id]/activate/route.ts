import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { activatePolicyDocument, getPolicyDocumentById } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/policy/[id]/activate
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(request);
    const { id } = await params;

    // Verify document exists and is READY
    const doc = await getPolicyDocumentById(id, session.user.organizationId);
    if (!doc) {
      return Response.json({ error: 'سند یافت نشد' }, { status: 404 });
    }

    if (doc.status !== 'READY') {
      return Response.json(
        { error: 'فقط اسناد آماده قابل فعال‌سازی هستند' },
        { status: 400 },
      );
    }

    const activated = await activatePolicyDocument(id, session.user.organizationId);

    return Response.json({
      id: activated.id,
      filename: activated.filename,
      status: activated.status,
      isActive: activated.isActive,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: 'خطا در فعال‌سازی سند' }, { status: 500 });
  }
}
