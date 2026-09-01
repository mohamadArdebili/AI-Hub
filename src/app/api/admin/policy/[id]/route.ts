import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { deletePolicyDocument, getPolicyDocumentById } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'policy-docs');

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

    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: 'خطا در حذف سند' }, { status: 500 });
  }
}
