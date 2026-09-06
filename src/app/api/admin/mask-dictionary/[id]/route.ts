import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  updateMaskDictionary,
  deleteMaskDictionary,
  isUniqueConstraintViolation,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PATCH /api/admin/mask-dictionary/[id] — toggle active / rename
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(request);
    const { id } = await params;
    const body = await request.json();

    const update: Partial<{ term: string; isActive: boolean }> = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.term === 'string' && body.term.trim().length >= 2) {
      update.term = body.term.trim();
    }
    if (Object.keys(update).length === 0) {
      return Response.json({ error: 'فیلدی برای به‌روزرسانی ارسال نشده است' }, { status: 400 });
    }

    const entry = await updateMaskDictionary(id, session.user.organizationId, update);
    return Response.json({
      id: entry.id,
      kind: entry.kind,
      term: entry.term,
      isActive: entry.isActive,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    if (isUniqueConstraintViolation(err)) {
      return Response.json({ error: 'این عبارت قبلاً ثبت شده است' }, { status: 409 });
    }
    return Response.json({ error: 'خطا در به‌روزرسانی عبارت' }, { status: 500 });
  }
}

// DELETE /api/admin/mask-dictionary/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(request);
    const { id } = await params;
    await deleteMaskDictionary(id, session.user.organizationId);
    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: 'خطا در حذف عبارت' }, { status: 500 });
  }
}
